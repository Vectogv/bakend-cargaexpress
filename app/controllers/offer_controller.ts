import Oferta from '#models/oferta'
import Viaje from '#models/viaje'
import Conductor from '#models/conductor'
import User from '#models/user'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import { getIO, emitToDriver } from '#start/socket'
import { sendToToken } from '#services/push_notification_service'

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

    const viaje = await Viaje.find(params.id)

    if (!viaje) {
      return response.status(404).send({ error: 'Viaje no encontrado' })
    }
    if (!['buscando_conductor', 'pendiente'].includes(viaje.estado)) {
      return response.status(400).send({ error: 'El viaje ya no acepta ofertas' })
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
    }

    const oferta = await Oferta.create({
      viajeId: viaje.id,
      conductorId: conductor.id,
      monto,
      estado: 'pendiente',
      expiraAt: DateTime.now().plus({ seconds: 28 }),
    })

    // Si es la primera oferta, pasar a 'pendiente'
    if (viaje.estado === 'buscando_conductor') {
      viaje.estado = 'pendiente'
      await viaje.save()
      try {
        const ioPrev = getIO()
        ioPrev.to(`client:${viaje.clienteId}`).emit('trip:status_changed', {
          id: String(viaje.id),
          estado: 'pendiente',
        })
      } catch (_e) { /* no crítico */ }
    }

    try {
      const io = getIO()
      io.to(`client:${viaje.clienteId}`).emit('new:offer', {
        id: String(oferta.id),
        viajeId: String(oferta.viajeId),
        monto: oferta.monto,
        conductor: {
          id: String(conductor.id),
          nombre: `${datosConductor.nombre} ${datosConductor.apellido}`.trim() || 'Sin nombre',
          foto: conductor.fotoConductor,
          calificacion: conductor.calificacion,
          placa: conductor.placa,
          tipoVehiculo: conductor.tipoVehiculo,
        },
        createdAt: oferta.createdAt ? oferta.createdAt.toISO() : new Date().toISOString(),
      })

      // Alias del documento
      io.to(`client:${viaje.clienteId}`).emit('trip:offer_received', {
        id: String(oferta.id),
        viajeId: String(oferta.viajeId),
        monto: oferta.monto,
        conductor: {
          id: String(conductor.id),
          nombre: `${datosConductor.nombre} ${datosConductor.apellido}`.trim() || 'Sin nombre',
          foto: conductor.fotoConductor,
          calificacion: conductor.calificacion,
          placa: conductor.placa,
          tipoVehiculo: conductor.tipoVehiculo,
        },
        expiresAt: oferta.expiraAt ? oferta.expiraAt.toISO() : null,
        createdAt: oferta.createdAt ? oferta.createdAt.toISO() : new Date().toISOString(),
      })
    } catch (e) {
      console.error('Socket emit error (no crítico):', e)
    }

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
        monto: o.monto,
        conductor: {
          id: String(o.conductor.id),
          nombre: `${o.conductor.usuario?.nombre || ''} ${o.conductor.usuario?.apellido || ''}`.trim(),
          foto: o.conductor.fotoConductor,
          calificacion: o.conductor.calificacion,
          placa: o.conductor.placa,
          tipoVehiculo: o.conductor.tipoVehiculo,
        },
        createdAt: o.createdAt.toISO(),
      }))
    )
  }

  async accept({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const viaje = await Viaje.find(params.id)

    if (!viaje) {
      return response.status(404).send({ error: 'Viaje no encontrado' })
    }
    if (viaje.clienteId !== user.id) {
      return response.status(403).send({ error: 'Este viaje no te pertenece' })
    }

    // Verificar que el viaje sigue aceptando ofertas
    if (!['buscando_conductor', 'pendiente'].includes(viaje.estado)) {
      return response.status(400).send({ error: 'El viaje ya no acepta ofertas' })
    }

    const oferta = await Oferta.query()
      .where('id', params.offerId)
      .where('viaje_id', viaje.id)
      .where('estado', 'pendiente')
      .preload('conductor', (q) => q.preload('usuario'))
      .preload('viaje')
      .first()

    if (!oferta) {
      return response.status(404).send({ error: 'Oferta no encontrada o ya procesada' })
    }

    oferta.estado = 'aceptada'
    await oferta.save()

    await Oferta.query()
      .where('viaje_id', viaje.id)
      .where('id', '!=', oferta.id)
      .where('estado', 'pendiente')
      .update({ estado: 'rechazada' })

    viaje.conductorId = oferta.conductorId
    viaje.estado = 'aceptado'
    viaje.precioFinal = oferta.monto
    viaje.aceptadoAt = DateTime.now()
    await viaje.save()

    const io = getIO()
    io.to(`client:${viaje.clienteId}`).emit('trip:status_changed', {
      id: String(viaje.id),
      estado: 'aceptado',
    })

    io.to(`client:${viaje.clienteId}`).emit('offer:accepted', {
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

    io.to(`driver:${oferta.conductor.usuarioId}`).emit('offer:accepted', {
      viajeId: String(viaje.id),
      ofertaId: String(oferta.id),
      monto: oferta.monto,
      estado: 'aceptado',
    })

    io.to(`driver:${oferta.conductor.usuarioId}`).emit('trip:offer_accepted', {
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
      .preload('conductor')

    for (const otra of otrasOfertas) {
      io.to(`driver:${otra.conductor.usuarioId}`).emit('offer:rejected', {
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

    try {
      const io = getIO()
      io.to(`client:${viaje.clienteId}`).emit('trip:status_changed', {
        id: String(viaje.id),
        estado: 'conductor_en_camino',
      })
      io.to(`client:${viaje.clienteId}`).emit('driver:on_the_way', {
        viajeId: String(viaje.id),
      })
    } catch (_e) { /* no crítico */ }

    const clienteUser = await User.find(viaje.clienteId)
    if (clienteUser?.fcmToken) {
      await sendToToken(
        clienteUser.fcmToken,
        'Conductor en camino',
        'Tu conductor está en camino al punto de recogida'
      ).catch(() => {})
    }

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

    viaje.estado = 'conductor_llegada'
    await viaje.save()

    try {
      const io = getIO()
      io.to(`client:${viaje.clienteId}`).emit('trip:status_changed', {
        id: String(viaje.id),
        estado: 'conductor_llegada',
      })
      io.to(`client:${viaje.clienteId}`).emit('driver:arrived', {
        viajeId: String(viaje.id),
      })
    } catch (_e) { /* no crítico */ }

    const clienteUser = await User.find(viaje.clienteId)
    if (clienteUser?.fcmToken) {
      await sendToToken(
        clienteUser.fcmToken,
        'El conductor llegó',
        'Tu conductor ha llegado al punto de recogida'
      ).catch(() => {})
    }

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
      .preload('conductor')
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
