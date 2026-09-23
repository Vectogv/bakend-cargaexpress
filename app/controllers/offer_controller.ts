import Oferta from '#models/oferta'
import Viaje from '#models/viaje'
import Conductor from '#models/conductor'
import User from '#models/user'
import db from '@adonisjs/lucid/services/db'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import { getIO, emitToClient, emitToDriver, emitTripStatusChanged } from '#start/socket'
import { sendToToken } from '#services/push_notification_service'
import { emitTripUpdateToModerators } from '#services/moderator_trip_events'
import TripConflictService from '#services/trip_conflict_service'
import AntifraudeService from '#services/antifraude_service'
import { distanciaKm } from '#services/geo_service'
import antifraudeConfig from '#config/antifraude'

export default class OfferController {
  async store({ auth, request, response, params }: HttpContext) {
    let user: User | null = null
    try {
      user = auth.user || await auth.authenticate()
    } catch {
      return response.status(401).send({ error: 'No autenticado' })
    }
    if (!user) {
      return response.status(401).send({ error: 'No autenticado' })
    }

    const datosConductor = {
      nombre: String(user.nombre || ''),
      apellido: String(user.apellido || ''),
      rol: String(user.rol || ''),
    }

    if (datosConductor.rol !== 'conductor') {
      return response.status(403).send({ error: 'Solo los conductores pueden hacer ofertas' })
    }

    const conductor = await user.related('conductor').query().first()
    if (!conductor) {
      return response.status(400).json({
        message: 'Debes completar tu registro como conductor primero',
      })
    }

    // Mismo control que el flujo antiguo de aceptación directa: solo conductores
    // activos y verificados pueden ofertar.
    if (user.suspendido) {
      return response.status(403).send({ error: 'Tu cuenta está suspendida. Contacta al administrador.' })
    }
    if (conductor.estadoVerificacion !== 'aprobado') {
      return response.status(403).send({ error: 'Tu cuenta de conductor no está verificada.' })
    }

    const viaje = await Viaje.find(params.id)

    if (!viaje) {
      return response.status(404).send({ error: 'Viaje no encontrado' })
    }
    if (!['buscando_conductor', 'pendiente'].includes(viaje.estado)) {
      return response.status(400).send({ error: 'El viaje ya no acepta ofertas' })
    }

    // H2: El conductor solo puede ofertar si su ubicación guardada/reciente está
    // dentro de radioOfertaKm del ORIGEN del viaje.
    try {
      const ubicacion = AntifraudeService.obtenerUbicacionReciente(conductor)
      const distOfertaKm = distanciaKm(
        ubicacion.lat,
        ubicacion.lng,
        Number(viaje.origenLat),
        Number(viaje.origenLng)
      )
      if (distOfertaKm > antifraudeConfig.radioOfertaKm) {
        const redondeada = Math.round(distOfertaKm * 100) / 100
        return response.status(422).send({
          error: `Estás a ${redondeada} km del origen del viaje. Solo puedes ofertar a ${antifraudeConfig.radioOfertaKm} km o menos.`,
          code: 'FUERA_DE_ZONA',
          distanciaKm: redondeada,
        })
      }
    } catch (e: any) {
      if (e.code === 'UBICACION_NO_RECIENTE') {
        return response.status(422).send({ error: e.message, code: e.code })
      }
      throw e
    }

    // Un conductor que ya atiende un servicio no puede ofertar en otro viaje
    // inmediato (en reservas se valida el choque de horario al aceptar).
    if (
      viaje.tipoProgramacion !== 'programada' &&
      (await TripConflictService.conductorOcupado(conductor.id, viaje.id))
    ) {
      return response.status(409).send({
        error: 'Ya estás atendiendo un servicio. Termínalo antes de ofertar en otro viaje.',
        code: 'CONDUCTOR_OCUPADO',
      })
    }

    const monto = Number.parseFloat(request.input('monto'))
    if (!monto || monto < 0) {
      return response.status(422).send({ error: 'Monto inválido' })
    }

    const ofertaAnterior = await Oferta.query()
      .where('viaje_id', viaje.id)
      .where('conductor_id', conductor.id)
      .where('estado', 'pendiente')
      .first()

    if (ofertaAnterior) {
      ofertaAnterior.estado = 'cancelada'
      await ofertaAnterior.save()

      emitToClient(viaje.clienteId, 'offer:cancelled', {
        viajeId: String(viaje.id),
        ofertaId: String(ofertaAnterior.id),
      })
    }

    // placa y mensaje vienen de F para que el cliente vea el vehículo y la nota.
    const placa = request.input('placa') ? String(request.input('placa')).trim() : null
    const mensaje = request.input('mensaje') ? String(request.input('mensaje')).trim() : null

    const oferta = await Oferta.create({
      viajeId: viaje.id,
      conductorId: conductor.id,
      monto,
      estado: 'pendiente',
      placa,
      mensaje,
      expiraAt: DateTime.now().plus({ seconds: 28 }),
    })

    // Si es la primera oferta, pasar a 'pendiente'
    if (viaje.estado === 'buscando_conductor') {
      viaje.estado = 'pendiente'
      await viaje.save()
      emitToClient(viaje.clienteId, 'trip:status_changed', {
        id: String(viaje.id),
        estado: 'pendiente',
      })
    }

    const conductorPayload = {
      id: String(conductor.id),
      nombre: `${datosConductor.nombre} ${datosConductor.apellido}`.trim() || 'Sin nombre',
      foto: conductor.fotoConductor,
      calificacion: conductor.calificacion,
      rating: conductor.calificacion,
      placa: conductor.placa,
      tipoVehiculo: conductor.tipoVehiculo,
    }
    const offerPayload = {
      id: String(oferta.id),
      _id: String(oferta.id),
      viajeId: String(oferta.viajeId),
      monto: oferta.monto,
      conductor: conductorPayload,
      placa: oferta.placa ?? conductor.placa,
      mensaje: oferta.mensaje ?? null,
      expiresAt: oferta.expiraAt ? oferta.expiraAt.toISO() : null,
      createdAt: oferta.createdAt ? oferta.createdAt.toISO() : new Date().toISOString(),
    }

    emitToClient(viaje.clienteId, 'new:offer', offerPayload)

    // Alias del documento
    emitToClient(viaje.clienteId, 'trip:offer_received', offerPayload)

    try {
      const cliente = await User.find(viaje.clienteId)
      if (cliente?.fcmToken) {
        await sendToToken(
          cliente.fcmToken,
          'Nueva oferta recibida',
          `Conductor ofrece $${oferta.monto} para tu viaje`
        )
      }
    } catch (e) {
      console.error('Push notification error (no crítico):', e)
    }

    return response.status(201).send({
      id: String(oferta.id),
      viajeId: String(oferta.viajeId),
      monto: oferta.monto,
      estado: oferta.estado,
      createdAt: oferta.createdAt ? oferta.createdAt.toISO() : new Date().toISOString(),
    })
  }

  async index({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const viaje = await Viaje.find(params.id)

    if (!viaje) {
      return response.status(404).send({ error: 'Viaje no encontrado' })
    }
    if (viaje.clienteId !== user.id) {
      return response.status(403).send({ error: 'Este viaje no te pertenece' })
    }

    const ofertas = await Oferta.query()
      .where('viaje_id', viaje.id)
      .where('estado', 'pendiente')
      .preload('conductor', (q) => q.preload('usuario'))
      .orderBy('createdAt', 'asc')

    return response.json(
      ofertas.map((o) => ({
        id: String(o.id),
        _id: String(o.id),
        monto: o.monto,
        conductor: {
          id: String(o.conductor.id),
          nombre: `${o.conductor.usuario?.nombre || ''} ${o.conductor.usuario?.apellido || ''}`.trim(),
          foto: o.conductor.fotoConductor,
          calificacion: o.conductor.calificacion,
          rating: o.conductor.calificacion,
          placa: o.conductor.placa,
          tipoVehiculo: o.conductor.tipoVehiculo,
        },
        placa: o.placa ?? o.conductor.placa,
        mensaje: o.mensaje ?? null,
        expiresAt: o.expiraAt ? o.expiraAt.toISO() : null,
        createdAt: o.createdAt.toISO(),
      }))
    )
  }

  async accept({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()

    // ── Transacción con bloqueo pesimista ───────────────────────────
    // Evita que la misma oferta se acepte dos veces (doble tap) y que el viaje
    // cambie de estado mientras se procesa la aceptación.
    let resultado: { viaje: Viaje; oferta: Oferta }
    try {
      resultado = await db.transaction(async (trx) => {
        const viaje = await Viaje.query({ client: trx })
          .where('id', params.id)
          .forUpdate()
          .first()

        if (!viaje) {
          throw Object.assign(new Error('NO_ENCONTRADO'), {
            statusCode: 404,
            message: 'Viaje no encontrado',
          })
        }
        if (viaje.clienteId !== user.id) {
          throw Object.assign(new Error('NO_PROPIO'), {
            statusCode: 403,
            message: 'Este viaje no te pertenece',
          })
        }

        // Verificar (bajo lock) que el viaje sigue aceptando ofertas
        if (!['buscando_conductor', 'pendiente'].includes(viaje.estado)) {
          throw Object.assign(new Error('YA_ASIGNADO'), {
            statusCode: 400,
            message: 'El viaje ya no acepta ofertas',
          })
        }

        const oferta = await Oferta.query({ client: trx })
          .where('id', params.offerId)
          .where('viaje_id', viaje.id)
          .where('estado', 'pendiente')
          .forUpdate()
          .first()

        if (!oferta) {
          throw Object.assign(new Error('OFERTA'), {
            statusCode: 404,
            message: 'Oferta no encontrada o ya procesada',
          })
        }

        // Oferta expirada: no se puede aceptar (Re-enviar una oferta nueva).
        if (oferta.expiraAt && oferta.expiraAt.toMillis() <= DateTime.now().toMillis()) {
          throw Object.assign(new Error('OFERTA_EXPIRADA'), {
            statusCode: 422,
            message: 'La oferta ha expirado',
          })
        }

        // El conductor pudo ser suspendido o desverificado después de ofertar.
        // FOR UPDATE sobre el conductor: serializa dos aceptaciones simultáneas
        // de ofertas del mismo conductor en viajes distintos.
        const conductorOferta = await Conductor.query({ client: trx })
          .where('id', oferta.conductorId)
          .forUpdate()
          .preload('usuario', (q) => q.select('id', 'suspendido'))
          .first()
        if (
          !conductorOferta ||
          conductorOferta.estadoVerificacion !== 'aprobado' ||
          conductorOferta.usuario?.suspendido
        ) {
          throw Object.assign(new Error('CONDUCTOR_NO_HABILITADO'), {
            statusCode: 409,
            message: 'El conductor de esta oferta ya no está habilitado. Elige otra oferta.',
          })
        }

        // Un conductor = un servicio a la vez (inmediatos) y sin choques de
        // horario (reservas programadas).
        const conflicto = await TripConflictService.conductorTieneConflicto(
          oferta.conductorId,
          viaje,
          trx
        )
        if (conflicto && viaje.tipoProgramacion === 'programada') {
          throw Object.assign(new Error('CONFLICTO_HORARIO'), {
            statusCode: 409,
            code: 'CONFLICTO_HORARIO',
            message: 'El conductor tiene otro viaje incompatible en ese horario',
          })
        }
        if (conflicto) {
          throw Object.assign(new Error('CONDUCTOR_OCUPADO'), {
            statusCode: 409,
            code: 'CONDUCTOR_OCUPADO',
            message: 'El conductor de esta oferta ya está atendiendo otro servicio. Elige otra oferta.',
          })
        }

        oferta.estado = 'aceptada'
        await oferta.useTransaction(trx).save()

        await Oferta.query({ client: trx })
          .where('viaje_id', viaje.id)
          .where('id', '!=', oferta.id)
          .where('estado', 'pendiente')
          .update({ estado: 'rechazada' })

        viaje.conductorId = oferta.conductorId
        viaje.estado = 'aceptado'
        viaje.precioFinal = oferta.monto
        viaje.aceptadoAt = DateTime.now()
        await viaje.useTransaction(trx).save()

        return { viaje, oferta }
      })
    } catch (err: any) {
      if (err?.statusCode) {
        return response
          .status(err.statusCode)
          .send(err.code ? { error: err.message, code: err.code } : { error: err.message })
      }
      throw err
    }

    const viaje = resultado.viaje
    const oferta = await Oferta.query()
      .where('id', resultado.oferta.id)
      .preload('conductor', (q) => q.preload('usuario'))
      .firstOrFail()

    emitTripUpdateToModerators(viaje)

    // Se usan los helpers (no `getIO()` directo) para que el endpoint siga
    // respondiendo aunque Socket.IO no esté inicializado. Eventos y rooms
    // son exactamente los mismos que antes.
    emitTripStatusChanged(viaje.clienteId, oferta.conductor.usuarioId, {
      id: String(viaje.id),
      estado: 'aceptado',
    })

    emitToClient(viaje.clienteId, 'offer:accepted', {
      viajeId: String(viaje.id),
      ofertaId: String(oferta.id),
      monto: oferta.monto,
      conductor: {
        id: String(oferta.conductorId),
        nombre: `${oferta.conductor.usuario?.nombre || ''} ${oferta.conductor.usuario?.apellido || ''}`.trim() || 'Sin nombre',
        tipoVehiculo: oferta.conductor.tipoVehiculo,
        placa: oferta.conductor.placa,
        rating: oferta.conductor.calificacion,
      },
      estado: 'aceptado',
    })

    emitToDriver(oferta.conductor.usuarioId, 'offer:accepted', {
      viajeId: String(viaje.id),
      ofertaId: String(oferta.id),
      monto: oferta.monto,
      estado: 'aceptado',
    })

    emitToDriver(oferta.conductor.usuarioId, 'trip:offer_accepted', {
      viajeId: String(viaje.id),
      ofertaId: String(oferta.id),
      monto: oferta.monto,
      estado: 'aceptado',
    })

    if (oferta.conductor.usuario.fcmToken) {
      await sendToToken(
        oferta.conductor.usuario.fcmToken,
        'Oferta aceptada',
        `Tu oferta de $${oferta.monto} fue aceptada. Dirígete al origen del viaje`
      )
    }

    const otrasOfertas = await Oferta.query()
      .where('viaje_id', viaje.id)
      .where('estado', 'rechazada')
      .preload('conductor', (q) => q.preload('usuario'))

    for (const otra of otrasOfertas) {
      emitToDriver(otra.conductor.usuarioId, 'offer:rejected', {
        viajeId: String(viaje.id),
        ofertaId: String(otra.id),
      })
      if (otra.conductor?.usuario?.fcmToken) {
        await sendToToken(
          otra.conductor.usuario.fcmToken,
          'Oferta rechazada',
          'Tu oferta para un viaje no fue seleccionada'
        )
      }
    }

    // Emitir trip:accepted a TODOS los conductores online (excepto el que aceptó)
    const tripAcceptedPayload = {
      event: 'trip:accepted',
      tripId: Number(viaje.id),
      conductorId: Number(oferta.conductorId),
    }
    const onlineDriverIds = await Conductor.query()
      .where('online', true)
      .where('id', '!=', oferta.conductorId)
      .select('usuario_id')
    for (const c of onlineDriverIds) {
      emitToDriver(c.usuarioId, 'trip:accepted', tripAcceptedPayload)
    }

    return {
      id: String(viaje.id),
      estado: viaje.estado,
      ofertaId: String(oferta.id),
      conductorId: String(oferta.conductorId),
      precioFinal: viaje.precioFinal,
    }
  }

  /**
   * Confirma que el conductor va en camino (transicion de aceptado a conductor_en_camino)
   */
  async confirmArrival({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const viaje = await Viaje.findOrFail(params.id)

    if (viaje.conductorId === null) {
      return response.status(403).send({ error: 'El viaje no tiene conductor asignado' })
    }

    const conductor = await Conductor.findByOrFail('usuario_id', user.id)
    if (viaje.conductorId !== conductor.id) {
      return response.status(403).send({ error: 'No eres el conductor asignado a este viaje' })
    }

    if (viaje.estado !== 'aceptado') {
      return response.status(422).send({ error: `El viaje debe estar en 'aceptado' (actual: ${viaje.estado})` })
    }

    viaje.estado = 'conductor_en_camino'
    await viaje.save()

    emitTripStatusChanged(viaje.clienteId, conductor.usuarioId, {
      id: String(viaje.id),
      estado: 'conductor_en_camino',
    })

    emitToClient(viaje.clienteId, 'driver:on_the_way', {
      viajeId: String(viaje.id),
    })

    const clienteUser = await User.find(viaje.clienteId)
    if (clienteUser?.fcmToken) {
      await sendToToken(
        clienteUser.fcmToken,
        'Conductor en camino',
        'Tu conductor está en camino al punto de recogida'
      ).catch(() => {})
    }

    emitTripUpdateToModerators(viaje)

    return { id: String(viaje.id), estado: viaje.estado }
  }

  /**
   * Confirma que el conductor ha llegado al origen (transicion de conductor_en_camino a conductor_llegada)
   */
  async confirmPickup({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const viaje = await Viaje.findOrFail(params.id)

    if (viaje.conductorId === null) {
      return response.status(403).send({ error: 'El viaje no tiene conductor asignado' })
    }

    const conductor = await Conductor.findByOrFail('usuario_id', user.id)
    if (viaje.conductorId !== conductor.id) {
      return response.status(403).send({ error: 'No eres el conductor asignado a este viaje' })
    }

    if (viaje.estado !== 'conductor_en_camino') {
      return response.status(422).send({ error: `El viaje debe estar en 'conductor_en_camino' (actual: ${viaje.estado})` })
    }

    // R2: Validar recogida - conductor debe estar a < radioCierreKm del origen
    try {
      await AntifraudeService.validarRecogida(viaje, conductor)
    } catch (e: any) {
      if (e.code === 'FUERA_DE_RANGO_ORIGEN') {
        return response.status(422).send({ error: e.message, code: e.code, distanciaKm: e.extra?.distanciaKm })
      }
      if (e.code === 'UBICACION_NO_RECIENTE') {
        return response.status(422).send({ error: e.message, code: e.code })
      }
      throw e
    }

    viaje.estado = 'conductor_llegada'
    await viaje.save()

    emitTripStatusChanged(viaje.clienteId, conductor.usuarioId, {
      id: String(viaje.id),
      estado: 'conductor_llegada',
    })

    emitToClient(viaje.clienteId, 'driver:arrived', {
      viajeId: String(viaje.id),
    })

    const clienteUser = await User.find(viaje.clienteId)
    if (clienteUser?.fcmToken) {
      await sendToToken(
        clienteUser.fcmToken,
        'El conductor llegó',
        'Tu conductor ha llegado al punto de recogida'
      ).catch(() => {})
    }

    emitTripUpdateToModerators(viaje)

    return { id: String(viaje.id), estado: viaje.estado }
  }

  async reject({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const viaje = await Viaje.find(params.id)

    if (!viaje) {
      return response.status(404).send({ error: 'Viaje no encontrado' })
    }
    if (viaje.clienteId !== user.id) {
      return response.status(403).send({ error: 'Este viaje no te pertenece' })
    }

    const oferta = await Oferta.query()
      .where('id', params.offerId)
      .where('viaje_id', viaje.id)
      .where('estado', 'pendiente')
      .preload('conductor', (q) => q.preload('usuario'))
      .first()

    if (!oferta) {
      return response.status(404).send({ error: 'Oferta no encontrada o ya procesada' })
    }

    oferta.estado = 'rechazada'
    await oferta.save()

    const io = getIO()
    io.to(`driver:${oferta.conductor.usuarioId}`).emit('offer:rejected', {
      viajeId: String(viaje.id),
      ofertaId: String(oferta.id),
    })

    if (oferta.conductor?.usuario?.fcmToken) {
      await sendToToken(
        oferta.conductor.usuario.fcmToken,
        'Oferta rechazada',
        'El cliente rechazó tu oferta'
      )
    }

    return response.status(200).send({
      id: String(oferta.id),
      estado: oferta.estado,
    })
  }
}
