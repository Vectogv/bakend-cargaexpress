import db from '@adonisjs/lucid/services/db'
import User from '#models/user'
import Viaje from '#models/viaje'
import Conductor from '#models/conductor'
import Calificacion from '#models/calificacion'
import SolicitudCancelacion from '#models/solicitud_cancelacion'
import {
  tripRequestValidator,
  tripReserveValidator,
  tripCompleteValidator,
  tripCancelValidator,
} from '#validators/trip'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import app from '@adonisjs/core/services/app'
import { randomUUID } from 'node:crypto'
import { ApiOperation, ApiBody, ApiResponse } from '@foadonis/openapi/decorators'
import { emitToClient, emitToDriver, emitToAdmin, emitTripStatusChanged } from '#start/socket'
import { sendToToken } from '#services/push_notification_service'
import GeoService from '#services/geo_service'
import TripDispatchService from '#services/trip_dispatch_service'
import TripConflictService from '#services/trip_conflict_service'
import reservationConfig from '#config/reservations'
import { parseScheduledDateTime } from '#services/reservation_time'
import TripStateMachine, { type EstadoViaje } from '#services/trip_state_machine'
import TripFinalizationService from '#services/trip_finalization_service'
import { emitTripUpdateToModerators } from '#services/moderator_trip_events'

export default class TripController {
  @ApiOperation({ summary: 'Solicitar un viaje', description: 'Crea una nueva solicitud de viaje' })
  @ApiBody({ type: () => tripRequestValidator })
  @ApiResponse({ type: 'object' })
  async request({ auth, request, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (user.rol !== 'cliente') {
      return response
        .status(403)
        .send({ error: 'Solo los clientes pueden solicitar viajes.' })
    }
    if (user.estadoCuenta !== 'activa') {
      return response
        .status(403)
        .send({ error: 'Tu cuenta no está activa. No puedes solicitar viajes.' })
    }

    // Un cliente no puede tener más de un viaje activo simultáneo.
    const viajeActivo = await Viaje.query()
      .where('cliente_id', user.id)
      .whereIn('estado', ['buscando_conductor', 'pendiente', 'aceptado', 'conductor_en_camino', 'conductor_llegada', 'en_curso', 'entregado', 'esperando_confirmacion', 'sos', 'disputa'])
      .first()
    if (viajeActivo) {
      return response.status(409).send({
        error: 'Ya tienes un viaje activo. Debes cancelarlo o esperar a que termine.',
        viajeId: String(viajeActivo.id),
      })
    }

    const data = await request.validateUsing(tripRequestValidator)

    // Validación de cobertura compartida con las reservas programadas.
    const dentroCobertura = await GeoService.validarCobertura(data.origen.lat, data.origen.lng)
    if (!dentroCobertura) {
      return response
        .status(422)
        .send({ error: 'Lo sentimos, por el momento solo operamos en Cali, Popayán y Pasto.' })
    }

    const viaje = await Viaje.create({
      clienteId: user.id,
      estado: 'creado',
      origenDireccion: data.origen.direccion,
      origenLat: data.origen.lat,
      origenLng: data.origen.lng,
      destinoDireccion: data.destino.direccion,
      destinoLat: data.destino.lat,
      destinoLng: data.destino.lng,
      carga: data.descripcion || null,
      precioCliente: data.precioCliente,
      precioEstimado: data.precioCliente,
    })

    // Transicion inmediata a buscando_conductor
    viaje.estado = 'buscando_conductor'
    await viaje.save()

    emitToClient(viaje.clienteId, 'trip:status_changed', {
      id: String(viaje.id),
      estado: 'creado',
    })

    emitToClient(viaje.clienteId, 'trip:status_changed', {
      id: String(viaje.id),
      estado: 'buscando_conductor',
    })

    emitTripUpdateToModerators(viaje)

    // Buscar conductores online dentro de 20km y notificarles (socket + push).
    // Centralizado en TripDispatchService para reutilizarlo en las reservas.
    await TripDispatchService.buscarConductores(viaje)

    return serialize.withoutWrapping({
      id: String(viaje.id),
      estado: viaje.estado,
      clienteId: String(viaje.clienteId),
      origen: {
        direccion: viaje.origenDireccion,
        lat: viaje.origenLat,
        lng: viaje.origenLng,
      },
      destino: {
        direccion: viaje.destinoDireccion,
        lat: viaje.destinoLat,
        lng: viaje.destinoLng,
      },
      precioEstimado: viaje.precioEstimado,
      createdAt: viaje.createdAt.toISO(),
    })
  }

  @ApiOperation({
    summary: 'Reservar un viaje programado',
    description:
      'Crea una reserva para una fecha/hora futura. El viaje queda en estado reservado y el scheduler inicia la búsqueda de conductor cuando llega la ventana de activación.',
  })
  @ApiBody({ type: () => tripReserveValidator })
  @ApiResponse({ type: 'object' })
  async reserve({ auth, request, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()

    if (user.rol !== 'cliente') {
      return response.status(403).send({ error: 'Solo los clientes pueden reservar viajes.' })
    }
    if (user.estadoCuenta !== 'activa') {
      return response.status(403).send({ error: 'Tu cuenta no está activa. No puedes reservar viajes.' })
    }

    // Un cliente no puede reservar mientras tiene un viaje en curso.
    // Las demás reservas futuras no lo bloquean: puede tener varias programadas.
    const viajeEnCurso = await Viaje.query()
      .where('cliente_id', user.id)
      .whereIn('estado', [
        'buscando_conductor',
        'pendiente',
        'aceptado',
        'conductor_en_camino',
        'conductor_llegada',
        'en_curso',
        'entregado',
        'esperando_confirmacion',
        'sos',
        'disputa',
      ])
      .first()
    if (viajeEnCurso) {
      return response.status(409).send({
        error: 'Ya tienes un viaje activo. Debes cancelarlo o esperar a que termine para reservar otro.',
        viajeId: String(viajeEnCurso.id),
      })
    }

    const data = await request.validateUsing(tripReserveValidator)

    const programada = parseScheduledDateTime(data.fechaProgramada, data.horaProgramada)
    if (!programada) {
      return response.status(422).send({ error: 'Fecha u hora programada inválida.' })
    }

    // Anticipación mínima configurable (RESERVATION_MIN_LEAD_TIME_MINUTES).
    const minLead = reservationConfig.minLeadMinutes
    if (programada <= DateTime.now().plus({ minutes: minLead })) {
      return response.status(400).send({
        error: `La reserva debe hacerse con al menos ${minLead} minutos de anticipación.`,
      })
    }

    // Misma validación de cobertura que el viaje inmediato.
    const dentroCobertura = await GeoService.validarCobertura(data.origen.lat, data.origen.lng)
    if (!dentroCobertura) {
      return response
        .status(422)
        .send({ error: 'Lo sentimos, por el momento solo operamos en Cali, Popayán y Pasto.' })
    }

    // Evitar dos reservas activas del mismo cliente para el mismo horario.
    const duplicada = await Viaje.query()
      .where('cliente_id', user.id)
      .where('tipo_programacion', 'programada')
      .where('fecha_programada', data.fechaProgramada)
      .where('hora_programada', data.horaProgramada)
      .whereNot('estado', 'cancelado')
      .first()
    if (duplicada) {
      return response.status(409).send({
        error: 'Ya tienes una reserva para esa misma fecha y hora.',
        viajeId: String(duplicada.id),
      })
    }

    // La búsqueda de conductor arranca `dispatchLeadMinutes` antes de la hora programada.
    // Se normaliza a la zona del servidor porque Lucid lee las columnas `dateTime`
    // con `DateTime.fromSQL` (sin offset en sqlite/mysql).
    const activacionAt = programada
      .minus({ minutes: reservationConfig.dispatchLeadMinutes })
      .setZone(DateTime.now().zone)

    const viaje = await Viaje.create({
      clienteId: user.id,
      estado: 'reservado',
      tipoProgramacion: 'programada',
      fechaProgramada: data.fechaProgramada,
      horaProgramada: data.horaProgramada,
      activacionAt,
      recordatorioEnviado: false,
      origenDireccion: data.origen.direccion,
      origenLat: data.origen.lat,
      origenLng: data.origen.lng,
      destinoDireccion: data.destino.direccion,
      destinoLat: data.destino.lat,
      destinoLng: data.destino.lng,
      carga: data.descripcion || null,
      precioCliente: data.precioCliente,
      precioEstimado: data.precioCliente,
    })

    emitToClient(viaje.clienteId, 'trip:status_changed', {
      id: String(viaje.id),
      estado: 'reservado',
    })

    emitToClient(viaje.clienteId, 'trip:reserved', {
      id: String(viaje.id),
      estado: viaje.estado,
      tipoProgramacion: viaje.tipoProgramacion,
      fechaProgramada: viaje.fechaProgramada,
      horaProgramada: viaje.horaProgramada,
      activacionAt: viaje.activacionAt?.toISO() ?? null,
    })

    emitTripUpdateToModerators(viaje)

    if (user.fcmToken) {
      await sendToToken(user.fcmToken, 'Reserva creada', 'Tu reserva fue creada correctamente.')
    }

    // `serialize.withoutWrapping` es asíncrono: hay que esperarlo antes de
    // pasarlo a response.send, de lo contrario el body sale vacío.
    const payload = await serialize.withoutWrapping({
      id: String(viaje.id),
        estado: viaje.estado,
        tipoProgramacion: viaje.tipoProgramacion,
        clienteId: String(viaje.clienteId),
        origen: {
          direccion: viaje.origenDireccion,
          lat: viaje.origenLat,
          lng: viaje.origenLng,
        },
        destino: {
          direccion: viaje.destinoDireccion,
          lat: viaje.destinoLat,
          lng: viaje.destinoLng,
        },
        carga: viaje.carga,
        precioEstimado: viaje.precioEstimado,
        fechaProgramada: viaje.fechaProgramada,
        horaProgramada: viaje.horaProgramada,
      activacionAt: viaje.activacionAt?.toISO() ?? null,
      createdAt: viaje.createdAt.toISO(),
    })

    return response.status(201).send(payload)
  }

  @ApiOperation({
    summary: 'Listar reservas programadas',
    description:
      'Devuelve las reservas programadas del usuario autenticado (propias si es cliente, asignadas si es conductor).',
  })
  @ApiResponse({ type: 'array' })
  async reservations({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const page = Number.parseInt(request.input('page', '1'))
    const limitRaw = Number.parseInt(request.input('limit', '20'))
    const limit = Math.min(100, Math.max(1, Number.isNaN(limitRaw) ? 20 : limitRaw))
    const estadoFilter = request.input('estado') as string | undefined
    const desde = request.input('desde') as string | undefined
    const hasta = request.input('hasta') as string | undefined
    const proximas = request.input('proximas')

    const query = Viaje.query()
      .where('tipo_programacion', 'programada')
      .preload('cliente')
      .preload('conductor', (q) => q.preload('usuario'))
      .orderBy('activacion_at', 'asc')

    if (user.rol === 'conductor') {
      const conductor = await Conductor.findByOrFail('usuario_id', user.id)
      query.where('conductor_id', conductor.id)
    } else {
      query.where('cliente_id', user.id)
    }

    if (estadoFilter) {
      const estados = estadoFilter
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      if (estados.length > 0) query.whereIn('estado', estados)
    }
    if (desde) query.where('fecha_programada', '>=', desde)
    if (hasta) query.where('fecha_programada', '<=', hasta)
    if (proximas === true || proximas === 'true') {
      query.whereIn('estado', [
        'reservado',
        'buscando_conductor',
        'pendiente',
        'aceptado',
        'conductor_en_camino',
        'conductor_llegada',
        'en_curso',
      ])
    }

    const result = await query.paginate(page, limit)
    return serialize.withoutWrapping({
      data: result.all().map((v) => this.formatViajeResponse(v)),
      total: result.total,
      page: result.currentPage,
      limit: result.perPage,
    })
  }

  @ApiOperation({
    summary: 'Obtener viajes cercanos',
    description: 'Devuelve los viajes cerca de una ubicación dentro de un radio. Usa la fórmula de Haversine con filtrado en memoria.',
  })
  @ApiResponse({ type: 'array' })
  async nearby({ auth, request, serialize, response }: HttpContext) {
    let lat = Number.parseFloat(request.input('lat', ''))
    let lng = Number.parseFloat(request.input('lng', ''))
    const radio = Number.parseFloat(request.input('radio', '20'))

    // Si el usuario es conductor y no envió coordenadas, usar su última ubicación guardada
    if ((!Number.isFinite(lat) || !Number.isFinite(lng)) && auth.user?.rol === 'conductor') {
      const conductor = await Conductor.findBy('usuario_id', auth.user.id)
      if (conductor?.ultimaUbicacionLat && conductor?.ultimaUbicacionLng) {
        lat = Number(conductor.ultimaUbicacionLat)
        lng = Number(conductor.ultimaUbicacionLng)
      }
    }

    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return response.status(422).send({ error: 'lat inválida. Debe ser un número entre -90 y 90.' })
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      return response.status(422).send({ error: 'lng inválida. Debe ser un número entre -180 y 180.' })
    }
    if (!Number.isFinite(radio) || radio <= 0 || radio > 200) {
      return response.status(422).send({ error: 'radio inválido. Debe ser un número entre 0 y 200.' })
    }

    const viajes = await GeoService.obtenerViajesCercanos(lat, lng, radio)

    return serialize.withoutWrapping(viajes)
  }

  @ApiOperation({
    summary: 'Obtener viaje activo',
    description: 'Devuelve el viaje activo actual del usuario autenticado',
  })
  @ApiResponse({ type: 'object' })
  async active({ auth, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()

    let viaje
    if (user.rol === 'conductor') {
      const conductor = await Conductor.findByOrFail('usuario_id', user.id)
      viaje = await Viaje.query()
        .where('conductor_id', conductor.id)
        .whereIn('estado', ['aceptado', 'conductor_en_camino', 'conductor_llegada', 'en_curso', 'entregado', 'esperando_confirmacion', 'sos'])
        .preload('cliente', (q) => q.select('id', 'nombre', 'apellido', 'telefono', 'avatar'))
        .preload('conductor', (q) => q.select('id', 'placa', 'tipo_vehiculo', 'foto_conductor', 'calificacion', 'usuario_id').preload('usuario', (uq) => uq.select('id', 'nombre', 'apellido', 'telefono')))
        .first()
    } else {
      viaje = await Viaje.query()
        .where('cliente_id', user.id)
        .whereIn('estado', ['creado', 'buscando_conductor', 'pendiente', 'aceptado', 'conductor_en_camino', 'conductor_llegada', 'en_curso', 'entregado', 'esperando_confirmacion', 'sos', 'disputa'])
        .preload('cliente', (q) => q.select('id', 'nombre', 'apellido', 'telefono', 'avatar'))
        .preload('conductor', (q) => q.select('id', 'placa', 'tipo_vehiculo', 'foto_conductor', 'calificacion', 'usuario_id').preload('usuario', (uq) => uq.select('id', 'nombre', 'apellido', 'telefono')))
        .first()
    }

    if (!viaje) {
      return response.status(404).send({ error: 'No active trip' })
    }

    return serialize.withoutWrapping(this.formatViajeResponse(viaje))
  }

  @ApiOperation({ summary: 'Aceptar un viaje (OBSOLETO)', description: 'OBSOLETO: usar POST /trips/:id/offers/:offerId/accept. Este endpoint será eliminado en la próxima versión mayor.' })
  @ApiResponse({ type: 'object' })
  async accept({ params, serialize, auth, response }: HttpContext) {
    response.header('Deprecation', 'true')
    response.header(
      'Sunset',
      new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toUTCString()
    )
    response.header(
      'Link',
      '</api/trips/:id/offers/:offerId/accept>; rel="successor-version"'
    )

    const user = auth.getUserOrFail()
    if (user.rol !== 'conductor') {
      return response.status(403).send({ error: 'Solo los conductores pueden aceptar viajes' })
    }

    const conductor = await Conductor.findByOrFail('usuario_id', user.id)

    if (user.suspendido) {
      return response.status(403).send({ error: 'Tu cuenta está suspendida. Contacta al administrador.' })
    }

    if (conductor.estadoVerificacion !== 'aprobado') {
      return response.status(403).send({ error: 'Tu cuenta de conductor no está verificada.' })
    }

    // ── Transacción con bloqueo pesimista ─────────────────────────────
    // Evita que dos conductores acepten el mismo viaje simultáneamente.
    let resultado: { viaje: Viaje }
    try {
      resultado = await db.transaction(async (trx) => {
        const viaje = await Viaje.query({ client: trx })
          .where('id', params.id)
          .forUpdate()
          .first()

        if (!viaje) {
          throw Object.assign(new Error('NO_ENCONTRADO'), { statusCode: 404, message: 'Viaje no encontrado' })
        }

        // Re-validar estado DENTRO de la transacción (pudo cambiar mientras
        // otro proceso concurrente tenía el lock antes que nosotros).
        if (!['buscando_conductor', 'pendiente'].includes(viaje.estado)) {
          throw Object.assign(
            new Error('YA_ASIGNADO'),
            { statusCode: 422, message: 'El viaje ya fue asignado' }
          )
        }

        // Reservas programadas: evitar que el conductor acepte si ya tiene
        // otro viaje incompatible en la misma franja horaria.
        const conflicto = await TripConflictService.conductorTieneConflicto(
          conductor.id,
          viaje,
          trx
        )
        if (conflicto) {
          throw Object.assign(new Error('CONFLICTO_HORARIO'), {
            statusCode: 409,
            message: 'Tienes otro viaje incompatible en ese horario',
          })
        }

        viaje.conductorId = conductor.id
        viaje.estado = 'aceptado'
        viaje.aceptadoAt = DateTime.now()

        if (conductor.ultimaUbicacionLat && conductor.ultimaUbicacionLng) {
          const R = 6371
          const dLat = ((viaje.origenLat - conductor.ultimaUbicacionLat) * Math.PI) / 180
          const dLng = ((viaje.origenLng - conductor.ultimaUbicacionLng) * Math.PI) / 180
          const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos((conductor.ultimaUbicacionLat * Math.PI) / 180) *
              Math.cos((viaje.origenLat * Math.PI) / 180) *
              Math.sin(dLng / 2) ** 2
          const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
          const distanciaKm = R * c
          viaje.tiempoEstimadoMinutos = Math.ceil((distanciaKm / 30) * 60)
        }

        await viaje.useTransaction(trx).save()

        await viaje.load('conductor', (q) => q.preload('usuario'))

        return { viaje }
      })
    } catch (err: any) {
      if (err?.statusCode) {
        return response.status(err.statusCode).send({ error: err.message })
      }
      throw err
    }

    emitTripStatusChanged(
      resultado.viaje.clienteId,
      resultado.viaje.conductor?.usuarioId,
      {
        id: String(resultado.viaje.id),
        estado: 'aceptado',
        conductor: {
          id: String(resultado.viaje.conductor.id),
          nombre:
            `${resultado.viaje.conductor.usuario.nombre || ''} ${resultado.viaje.conductor.usuario.apellido || ''}`.trim(),
          telefono: resultado.viaje.conductor.usuario.telefono,
          placa: resultado.viaje.conductor.placa,
          foto: resultado.viaje.conductor.fotoConductor,
          calificacion: resultado.viaje.conductor.calificacion,
        },
        tiempoEstimadoMinutos: resultado.viaje.tiempoEstimadoMinutos ?? null,
        aceptadoAt: resultado.viaje.aceptadoAt?.toISO() ?? null,
      }
    )

    emitToClient(resultado.viaje.clienteId, 'trip:accepted', {
      id: String(resultado.viaje.id),
      estado: resultado.viaje.estado,
      conductor: {
        id: String(resultado.viaje.conductor.id),
        nombre:
          `${resultado.viaje.conductor.usuario.nombre || ''} ${resultado.viaje.conductor.usuario.apellido || ''}`.trim(),
        telefono: resultado.viaje.conductor.usuario.telefono,
        placa: resultado.viaje.conductor.placa,
        foto: resultado.viaje.conductor.fotoConductor,
        calificacion: resultado.viaje.conductor.calificacion,
      },
      tiempoEstimadoMinutos: resultado.viaje.tiempoEstimadoMinutos,
      aceptadoAt: resultado.viaje.aceptadoAt?.toISO() ?? null,
    })

    emitToDriver(resultado.viaje.conductor.usuarioId, 'trip:offer_accepted', {
      id: String(resultado.viaje.id),
      estado: resultado.viaje.estado,
      viajeId: Number(resultado.viaje.id),
    })

    emitTripUpdateToModerators(resultado.viaje)

    const tripAcceptedPayload = {
      event: 'trip:accepted',
      tripId: Number(resultado.viaje.id),
      conductorId: Number(conductor.id),
    }
    const onlineDriverIds = await Conductor.query()
      .where('online', true)
      .where('id', '!=', conductor.id)
      .select('usuario_id')
    for (const c of onlineDriverIds) {
      emitToDriver(c.usuarioId, 'trip:accepted', tripAcceptedPayload)
    }

    return serialize.withoutWrapping({
      id: String(resultado.viaje.id),
      estado: resultado.viaje.estado,
      aceptadoAt: resultado.viaje.aceptadoAt?.toISO() ?? null,
    })
  }

  @ApiOperation({
    summary: 'Iniciar viaje (recogida)',
    description: 'Cambia el viaje a en_curso después de que el conductor recoge la carga',
  })
  @ApiResponse({ type: 'object' })
  async startTrip({ auth, params, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()

    if (user.rol !== 'conductor') {
      return response.status(403).send({ error: 'Solo el conductor puede iniciar el viaje' })
    }

    const viaje = await Viaje.findOrFail(params.id)

    const conductor = await Conductor.findByOrFail('usuario_id', user.id)
    if (viaje.conductorId !== conductor.id) {
      return response.status(403).send({ error: 'No eres el conductor asignado a este viaje' })
    }

    if (!TripStateMachine.validarTransicion(viaje.estado as EstadoViaje, 'en_curso')) {
      return response.status(422).send({ error: `El viaje debe estar en estado 'conductor_llegada' o 'aceptado' para iniciarse (estado actual: ${viaje.estado})` })
    }

    viaje.estado = 'en_curso'
    viaje.enCursoAt = DateTime.now()
    await viaje.save()

    emitTripStatusChanged(viaje.clienteId, conductor.usuarioId, {
      id: String(viaje.id),
      estado: 'en_curso',
      enCursoAt: viaje.enCursoAt.toISO(),
    })

    emitToClient(viaje.clienteId, 'trip:started', {
      id: String(viaje.id),
      estado: viaje.estado,
      enCursoAt: viaje.enCursoAt.toISO(),
    })

    emitTripUpdateToModerators(viaje)

    return serialize.withoutWrapping({
      id: String(viaje.id),
      estado: viaje.estado,
      enCursoAt: viaje.enCursoAt.toISO(),
    })
  }

  @ApiOperation({ summary: 'Rechazar un viaje', description: 'El conductor rechaza un viaje pendiente' })
  @ApiResponse({ type: 'object' })
  async decline({ auth, params, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()

    if (user.rol !== 'conductor') {
      return response.status(403).send({ error: 'Solo los conductores pueden rechazar viajes' })
    }

    const viaje = await Viaje.findOrFail(params.id)

    if (!TripStateMachine.validarTransicion(viaje.estado as EstadoViaje, 'rechazado')) {
      return response.status(422).send({ error: `Este viaje no se puede rechazar en su estado actual (${viaje.estado})` })
    }

    // Si el viaje está aceptado, solo el conductor asignado puede rechazarlo
    if (viaje.estado === 'aceptado') {
      const conductor = await Conductor.findByOrFail('usuario_id', user.id)
      if (viaje.conductorId !== conductor.id) {
        return response.status(403).send({ error: 'No eres el conductor asignado a este viaje' })
      }
    }

    viaje.estado = 'rechazado'
    await viaje.save()

    emitToClient(viaje.clienteId, 'trip:status_changed', {
      id: String(viaje.id),
      estado: 'rechazado',
    })

    emitToClient(viaje.clienteId, 'trip:declined', {
      id: String(viaje.id),
      estado: viaje.estado,
    })

    return serialize.withoutWrapping({ id: String(viaje.id), estado: viaje.estado })
  }

  @ApiOperation({ summary: 'Completar un viaje', description: 'Marca un viaje como completado' })
  @ApiBody({ type: () => tripCompleteValidator })
  @ApiResponse({ type: 'object' })
  async complete({ auth, params, request, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()

    if (user.rol !== 'conductor') {
      return response.status(403).send({ error: 'Solo el conductor puede completar el viaje' })
    }

    const viaje = await Viaje.findOrFail(params.id)

    const conductor = await Conductor.findByOrFail('usuario_id', user.id)
    if (viaje.conductorId !== conductor.id) {
      return response.status(403).send({ error: 'No eres el conductor asignado a este viaje' })
    }

    if (!TripStateMachine.validarTransicion(viaje.estado as EstadoViaje, 'entregado')) {
      return response.status(422).send({ error: `El viaje debe estar 'en_curso' para completarse (estado actual: ${viaje.estado})` })
    }

    const data = await request.validateUsing(tripCompleteValidator)
    viaje.estado = 'entregado'
    viaje.precioFinal = data.montoFinal
    viaje.completadoAt = DateTime.now()
    await viaje.save()

    emitTripStatusChanged(viaje.clienteId, conductor.usuarioId, {
      id: String(viaje.id),
      estado: 'entregado',
      montoFinal: viaje.precioFinal,
      completadoAt: viaje.completadoAt.toISO(),
    })

    emitToClient(viaje.clienteId, 'trip:delivered', {
      id: String(viaje.id),
      estado: viaje.estado,
      montoFinal: viaje.precioFinal,
      completadoAt: viaje.completadoAt.toISO(),
    })

    emitToDriver(conductor.usuarioId, 'driver:stop_gps', {
      viajeId: String(viaje.id),
    })

    // Automaticamente pasar a esperando_confirmacion
    viaje.estado = 'esperando_confirmacion'
    await viaje.save()

    emitTripStatusChanged(viaje.clienteId, conductor.usuarioId, {
      id: String(viaje.id),
      estado: 'esperando_confirmacion',
    })

    emitTripUpdateToModerators(viaje)

    return serialize.withoutWrapping({
      id: String(viaje.id),
      estado: viaje.estado,
      montoFinal: viaje.precioFinal,
      completadoAt: viaje.completadoAt.toISO(),
    })
  }

  @ApiOperation({
    summary: 'Finalizar entrega',
    description: 'Confirma la entrega, pone al conductor en línea y registra el pago. Idempotente: seguro de reintentar.',
  })
  @ApiBody({ type: () => tripCompleteValidator })
  @ApiResponse({ type: 'object' })
  async finalize({ auth, params, request, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const data = await request.validateUsing(tripCompleteValidator)

    // ── Delegar toda la lógica financiera al servicio centralizado ────────
    // TripFinalizationService garantiza:
    //   • Atomicidad (transacción única)
    //   • Bloqueo pesimista (SELECT FOR UPDATE)
    //   • Idempotencia (re-read after lock)
    //   • Protección contra disputa activa
    //   • Validación de estado y permisos
    const result = await TripFinalizationService.finalize({
      viajeId: params.id,
      montoFinal: data.montoFinal,
      actorUserId: user.id,
      actorRol: user.rol ?? 'cliente',
    })

    if (!result.ok) {
      return response.status(result.statusCode).send({ error: result.error })
    }

    // ── Notificaciones y sockets (fuera de la transacción) ────────────────
    // Si la operación fue idempotente (el viaje ya estaba finalizado) no
    // volvemos a emitir eventos para no spam al frontend con duplicados.
    if (!result.idempotent) {
      const viaje = await Viaje.find(Number(result.viaje.id))

      if (viaje) {
        const conductorStatusChanged = viaje.conductorId
          ? await Conductor.find(viaje.conductorId)
          : null
        emitTripStatusChanged(
          viaje.clienteId,
          conductorStatusChanged?.usuarioId,
          {
            id: String(viaje.id),
            estado: 'finalizado',
            montoFinal: result.viaje.montoFinal,
            finalizadoAt: result.viaje.finalizadoAt,
          }
        )

        emitToClient(viaje.clienteId, 'trip:finalized', {
          id: result.viaje.id,
          estado: result.viaje.estado,
          montoFinal: result.viaje.montoFinal,
          finalizadoAt: result.viaje.finalizadoAt,
        })

        emitToAdmin('admin:trip_completed', {
          viajeId: result.viaje.id,
          estado: result.viaje.estado,
          montoFinal: result.viaje.montoFinal,
        })

        emitTripUpdateToModerators(viaje)

        // Push notification al cliente
        const cliente = await User.find(viaje.clienteId)
        if (cliente?.fcmToken) {
          await sendToToken(
            cliente.fcmToken,
            'Envío entregado',
            'Tu envío ha sido entregado exitosamente'
          )
        }

        // Push notification al conductor (comisión acumulada)
        if (viaje.conductorId) {
          const conductor = await Conductor.find(viaje.conductorId)
          if (conductor) {
            emitToDriver(conductor.usuarioId, 'driver:stop_gps', {
              viajeId: String(viaje.id),
            })

            const conductorUser = await User.find(conductor.usuarioId)
            if (conductorUser?.fcmToken && conductorUser.montoDeuda && conductorUser.deudaFechaLimite) {
              const diasRestantes = Math.ceil(
                conductorUser.deudaFechaLimite.diff(DateTime.now(), 'days').days
              )
              const comision = Math.round(data.montoFinal * 0.1 * 100) / 100
              await sendToToken(
                conductorUser.fcmToken,
                'Nueva comisión registrada',
                `Se registró una comisión de $${comision.toLocaleString('es-CO')} por este viaje. Tu deuda total es $${conductorUser.montoDeuda.toLocaleString('es-CO')}. Tienes ${diasRestantes} días para pagar.`
              )
            }
          }
        }
      }
    }

    return serialize.withoutWrapping({
      id: result.viaje.id,
      estado: result.viaje.estado,
      montoFinal: result.viaje.montoFinal,
      finalizadoAt: result.viaje.finalizadoAt,
    })
  }

  @ApiOperation({ summary: 'Cancelar un viaje', description: 'Cancela un viaje con un motivo opcional' })
  @ApiBody({ type: () => tripCancelValidator })
  @ApiResponse({ type: 'object' })
  async cancel({ params, request, serialize, auth, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const data = await request.validateUsing(tripCancelValidator)
    const viaje = await Viaje.findOrFail(params.id)

    // Solo el admin puede cancelar un viaje en curso o en estados avanzados
    if (['en_curso', 'conductor_llegada'].includes(viaje.estado) && user.rol !== 'admin') {
      return response.status(403).send({ error: 'No puedes cancelar un viaje en curso. Debes solicitar la cancelación al administrador.' })
    }

    // Validar que el usuario sea el cliente o el conductor del viaje
    if (user.rol === 'conductor') {
      const conductor = await Conductor.findByOrFail('usuario_id', user.id)
      // Si el viaje no tiene conductor asignado todavía, ningún conductor puede cancelarlo
      if (viaje.conductorId === null || viaje.conductorId === undefined) {
        return response.status(403).send({ error: 'Solo el cliente puede cancelar un viaje que aún no tiene conductor asignado' })
      }
      if (viaje.conductorId !== conductor.id) {
        return response.status(403).send({ error: 'No eres el conductor asignado a este viaje' })
      }
    } else if (user.rol === 'cliente') {
      if (viaje.clienteId !== user.id) {
        return response.status(403).send({ error: 'Este viaje no te pertenece' })
      }
    } else if (user.rol !== 'admin') {
      return response.status(403).send({ error: 'No tienes permisos para cancelar este viaje' })
    }

    if (!TripStateMachine.validarTransicion(viaje.estado as EstadoViaje, 'cancelado')) {
      return response
        .status(422)
        .send({ error: `El viaje no puede cancelarse en su estado actual (${viaje.estado})` })
    }

    // Validar distancia si cliente cancela con conductor en camino
    if (user.rol === 'cliente' && viaje.conductorId && viaje.estado === 'conductor_en_camino') {
      const conductor = await Conductor.find(viaje.conductorId)
      if (conductor?.ultimaUbicacionLat && conductor?.ultimaUbicacionLng) {
        const distKm = haversineDist(
          viaje.origenLat, viaje.origenLng,
          conductor.ultimaUbicacionLat, conductor.ultimaUbicacionLng
        )
        if (distKm < 1) {
          return response.status(422).send({ error: `No puedes cancelar: el conductor está a ${distKm.toFixed(2)} km del origen (mín. 1 km)` })
        }
      }
    }

    const estadoAnterior = viaje.estado
    viaje.estado = 'cancelado'
    viaje.motivoCancelacion = data.motivo || null
    viaje.canceladoAt = DateTime.now()
    await viaje.save()

    // Penalizar reputacion si el viaje ya tenia conductor asignado
    if (user.id === viaje.clienteId && viaje.conductorId && ['aceptado', 'conductor_en_camino'].includes(estadoAnterior)) {
      const cliente = await User.find(viaje.clienteId)
      if (cliente) {
        cliente.reputacion = Math.max(1.0, cliente.reputacion - 0.5)
        await cliente.save()
      }
    }

    const conductorStatusChanged = viaje.conductorId
      ? await Conductor.find(viaje.conductorId)
      : null
    emitTripStatusChanged(viaje.clienteId, conductorStatusChanged?.usuarioId, {
      id: String(viaje.id),
      estado: 'cancelado',
      motivo: viaje.motivoCancelacion,
    })

    emitToClient(viaje.clienteId, 'trip:cancelled', {
      id: String(viaje.id),
      estado: viaje.estado,
      motivo: viaje.motivoCancelacion,
    })

    if (viaje.conductorId) {
      const conductor = await Conductor.find(viaje.conductorId)
      if (conductor) {
        emitToDriver(conductor.usuarioId, 'trip:cancelled', {
          id: String(viaje.id),
          estado: viaje.estado,
          motivo: viaje.motivoCancelacion,
        })

        emitToDriver(conductor.usuarioId, 'driver:stop_gps', {
          viajeId: String(viaje.id),
        })
      }
    }

    emitTripUpdateToModerators(viaje)

    return serialize.withoutWrapping({
      id: String(viaje.id),
      estado: viaje.estado,
      canceladoAt: viaje.canceladoAt.toISO(),
    })
  }

  @ApiOperation({ summary: 'Solicitar cancelación', description: 'El conductor o el cliente solicitan la cancelación del viaje cuando está en_curso. El administrador debe aprobarla.' })
  @ApiResponse({ type: 'object' })
  async requestCancellation({ auth, params, request, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const viaje = await Viaje.findOrFail(params.id)

    if (!['en_curso', 'conductor_llegada', 'sos'].includes(viaje.estado)) {
      return response.status(422).send({ error: `No puedes solicitar cancelación en el estado actual (${viaje.estado})` })
    }

    let conductorId: number
    let solicitanteRol: 'conductor' | 'cliente'

    if (user.rol === 'conductor') {
      const conductor = await Conductor.findByOrFail('usuario_id', user.id)
      if (viaje.conductorId !== conductor.id) {
        return response.status(403).send({ error: 'No eres el conductor asignado a este viaje' })
      }
      conductorId = conductor.id
      solicitanteRol = 'conductor'
    } else if (user.rol === 'cliente') {
      if (viaje.clienteId !== user.id) {
        return response.status(403).send({ error: 'Este viaje no te pertenece' })
      }
      if (!viaje.conductorId) {
        return response.status(422).send({ error: 'El viaje no tiene un conductor asignado' })
      }
      conductorId = viaje.conductorId
      solicitanteRol = 'cliente'
    } else {
      return response.status(403).send({ error: 'No tienes permisos para solicitar cancelación' })
    }

    // Verificar que no exista ya una solicitud pendiente
    const existente = await SolicitudCancelacion.query()
      .where('viaje_id', viaje.id)
      .where('estado', 'pendiente')
      .first()
    if (existente) {
      return response.status(409).send({ error: 'Ya existe una solicitud de cancelación pendiente para este viaje' })
    }

    const { motivo } = request.only(['motivo'])

    const solicitud = await SolicitudCancelacion.create({
      viajeId: viaje.id,
      conductorId,
      motivo: motivo || 'Sin motivo especificado',
      estado: 'pendiente',
    })

    emitToAdmin('admin:cancellation_requested', {
      id: String(solicitud.id),
      viajeId: String(viaje.id),
      conductorId: String(conductorId),
      solicitanteRol,
      motivo: solicitud.motivo,
      createdAt: solicitud.createdAt.toISO(),
    })
    emitToAdmin('admin:cancellation', {
      id: String(solicitud.id),
      viajeId: String(viaje.id),
      conductorId: String(conductorId),
      solicitanteRol,
      motivo: solicitud.motivo,
      createdAt: solicitud.createdAt.toISO(),
    })

    return serialize.withoutWrapping({
      id: String(solicitud.id),
      estado: solicitud.estado,
      message: 'Solicitud de cancelación enviada al administrador',
    })
  }

  @ApiOperation({
    summary: 'Obtener historial de viajes',
    description: 'Devuelve el historial de viajes paginado del usuario autenticado',
  })
  @ApiResponse({ type: 'array' })
  async history({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const page = Number.parseInt(request.input('page', '1'))
    const limitRaw = Number.parseInt(request.input('limit', '20'))
    const limit = Math.min(100, Math.max(1, Number.isNaN(limitRaw) ? 20 : limitRaw))
    const estadoFilter = request.input('estado') as string | undefined
    let query
    if (user.rol === 'conductor') {
      const conductor = await Conductor.findByOrFail('usuario_id', user.id)
      query = Viaje.query()
        .where('conductor_id', conductor.id)
        .preload('cliente')
        .preload('conductor', (q) => q.preload('usuario'))
        .orderBy('createdAt', 'desc')
    } else {
      query = Viaje.query()
        .where('cliente_id', user.id)
        .preload('cliente')
        .preload('conductor', (q) => q.preload('usuario'))
        .orderBy('createdAt', 'desc')
    }
    if (estadoFilter) {
      const estados = estadoFilter.split(',').map((s) => s.trim()).filter(Boolean)
      if (estados.length > 0) {
        query.whereIn('estado', estados)
      }
    }
    const result = await query.paginate(page, limit)
    const data = result.all().map((v) => this.formatViajeResponse(v))
    return serialize.withoutWrapping({
      data,
      total: result.total,
      page: result.currentPage,
      limit: result.perPage,
    })
  }

  @ApiOperation({
    summary: 'Obtener detalles del viaje',
    description: 'Devuelve los detalles de un viaje específico por ID',
  })
  @ApiResponse({ type: 'object' })
  async show({ auth, params, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const viaje = await Viaje.query()
      .where('id', params.id)
      .preload('cliente')
      .preload('conductor', (q) => q.preload('usuario'))
      .firstOrFail()

    // Solo el cliente, el conductor asignado o un admin pueden ver los detalles del viaje.
    // Excepción: un conductor puede previsualizar un viaje que aún busca conductor
    // (buscando_conductor/pendiente) para decidir si hace una oferta.
    if (user.rol !== 'admin') {
      const esCliente = viaje.clienteId === user.id
      let esConductor = false
      if (user.rol === 'conductor' && viaje.conductorId) {
        const conductor = await Conductor.findBy('usuario_id', user.id)
        esConductor = conductor !== null && viaje.conductorId === conductor.id
      }
      const estado = viaje.estado as string
      const disponibleSinAsignar = user.rol === 'conductor' && !esConductor
        && ['buscando_conductor', 'pendiente'].includes(estado)
      if (!esCliente && !esConductor && !disponibleSinAsignar) {
        return response.status(403).send({ error: 'No tienes permisos para ver este viaje' })
      }
    }

    return serialize.withoutWrapping(this.formatViajeResponse(viaje))
  }

  private formatViajeResponse(viaje: Viaje) {
    return {
      id: String(viaje.id),
      _id: String(viaje.id),
      estado: viaje.estado,
      cliente: {
        id: String(viaje.cliente.id),
        _id: String(viaje.cliente.id),
        nombre: `${viaje.cliente.nombre || ''} ${viaje.cliente.apellido || ''}`.trim(),
        telefono: viaje.cliente.telefono,
        avatar: viaje.cliente.avatar,
      },
      conductor: viaje.conductor
        ? {
            id: String(viaje.conductor.id),
            _id: String(viaje.conductor.id),
            nombre:
              `${viaje.conductor.usuario.nombre || ''} ${viaje.conductor.usuario.apellido || ''}`.trim(),
            telefono: viaje.conductor.usuario.telefono,
            placa: viaje.conductor.placa,
            tipoVehiculo: viaje.conductor.tipoVehiculo,
          }
        : null,
      origen: {
        direccion: viaje.origenDireccion,
        lat: Number(viaje.origenLat),
        lng: Number(viaje.origenLng),
      },
      destino: {
        direccion: viaje.destinoDireccion,
        lat: Number(viaje.destinoLat),
        lng: Number(viaje.destinoLng),
      },
      carga: viaje.carga,
      // F models/trip.dart lee `descripcion` y `tiempoEstimado`.
      descripcion: viaje.carga,
      tipoProgramacion: viaje.tipoProgramacion ?? 'inmediata',
      fechaProgramada: viaje.fechaProgramada,
      horaProgramada: viaje.horaProgramada,
      activacionAt: viaje.activacionAt?.toISO() ?? null,
      fotoEntrega: viaje.fotoEntrega,
      tiempoEstimadoMinutos: viaje.tiempoEstimadoMinutos ?? null,
      tiempoEstimado: viaje.tiempoEstimadoMinutos ?? null,
      // Evitar Number(null) → 0: si el campo es null se manda null.
      precioEstimado: viaje.precioEstimado ?? null,
      precioFinal: viaje.precioFinal ?? null,
      // tiempoEstimado/tempoEstimadoMinutos ya incluidos arriba
      createdAt: viaje.createdAt.toISO(),
      aceptadoAt: viaje.aceptadoAt?.toISO() || null,
      enCursoAt: viaje.enCursoAt?.toISO() || null,
      completadoAt: viaje.completadoAt?.toISO() || null,
      finalizadoAt: viaje.finalizadoAt?.toISO() || null,
      canceladoAt: viaje.canceladoAt?.toISO() || null,
      motivoCancelacion: viaje.motivoCancelacion,
    }
  }

  async rate({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const viaje = await Viaje.find(params.id)
    if (!viaje) {
      return response.status(404).send(serialize.withoutWrapping({ error: 'Viaje no encontrado' }))
    }
    if (viaje.estado !== 'finalizado') {
      return response
        .status(422)
        .send(serialize.withoutWrapping({ error: 'Solo puedes calificar viajes finalizados' }))
    }

    const { puntaje, comentario } = request.only(['puntaje', 'comentario'])
    const rating = request.input('rating', puntaje || null)
    const puntajeFinal = rating ?? puntaje
    if (puntajeFinal === null || puntajeFinal === undefined || puntajeFinal < 1 || puntajeFinal > 5) {
      return response
        .status(422)
        .send(serialize.withoutWrapping({ error: 'El puntaje debe ser entre 1 y 5' }))
    }

    const existe = await Calificacion.query()
      .where('viaje_id', viaje.id)
      .where('calificador_id', user.id)
      .first()
    if (existe) {
      return response
        .status(400)
        .send(serialize.withoutWrapping({ error: 'Ya calificaste este viaje' }))
    }

    let calificadoId: number
    let tipo: string

    if (user.rol === 'cliente') {
      // Verificar que el cliente es dueño del viaje
      if (viaje.clienteId !== user.id) {
        return response
          .status(403)
          .send(serialize.withoutWrapping({ error: 'No eres el cliente de este viaje' }))
      }
      if (!viaje.conductorId) {
        return response
          .status(422)
          .send(serialize.withoutWrapping({ error: 'El viaje no tiene conductor asignado' }))
      }
      const conductor = await Conductor.findOrFail(viaje.conductorId)
      calificadoId = conductor.usuarioId
      tipo = 'cliente_a_conductor'
    } else if (user.rol === 'conductor') {
      // Verificar que el conductor es quien realizó el viaje
      const conductor = await Conductor.findByOrFail('usuario_id', user.id)
      if (viaje.conductorId !== conductor.id) {
        return response
          .status(403)
          .send(serialize.withoutWrapping({ error: 'No eres el conductor de este viaje' }))
      }
      calificadoId = viaje.clienteId
      tipo = 'conductor_a_cliente'
    } else {
      return response
        .status(403)
        .send(serialize.withoutWrapping({ error: 'No tienes permisos para calificar' }))
    }

    await Calificacion.create({
      viajeId: viaje.id,
      calificadorId: user.id,
      calificadoId,
      puntaje: puntajeFinal,
      comentario: comentario || null,
      tipo,
    })

    const avg = await Calificacion.query()
      .where('calificado_id', calificadoId)
      .avg('puntaje as promedio')
      .first()
    const promedio = Number(avg?.$extras?.promedio || 0)

    if (tipo === 'cliente_a_conductor') {
      const conductor = await Conductor.findByOrFail('usuario_id', calificadoId)
      conductor.calificacion = Math.round(promedio * 100) / 100
      await conductor.save()
    } else {
      const calificado = await User.findOrFail(calificadoId)
      calificado.calificacion = Math.round(promedio * 100) / 100
      await calificado.save()
    }

    return serialize.withoutWrapping({
      success: true,
      rating: puntajeFinal,
      puntaje: puntajeFinal,
      promedio: Math.round(promedio * 100) / 100,
    })
  }

  async deliveryPhoto({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const viaje = await Viaje.find(params.id)
    if (!viaje) {
      return response.status(404).send(serialize.withoutWrapping({ error: 'Viaje no encontrado' }))
    }

    const conductor = await Conductor.findByOrFail('usuario_id', user.id)
    if (viaje.conductorId !== conductor.id) {
      return response
        .status(403)
        .send(serialize.withoutWrapping({ error: 'No eres el conductor de este viaje' }))
    }

    if (!['en_curso', 'entregado'].includes(viaje.estado)) {
      return response
        .status(422)
        .send(serialize.withoutWrapping({ error: 'Solo puedes subir foto de entrega cuando el viaje está en curso o entregado' }))
    }

    const file = request.file('file', {
      size: '5mb',
      extnames: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    })
    if (!file) {
      return response.status(400).send({ error: 'No file uploaded' })
    }

    const fileName = `delivery-${viaje.id}-${randomUUID()}.${file.extname}`
    await file.move(app.makePath('storage', 'uploads'), { name: fileName })

    viaje.fotoEntrega = `/storage/uploads/${fileName}`
    await viaje.save()

    return serialize.withoutWrapping({ fotoEntrega: viaje.fotoEntrega })
  }
}

function haversineDist(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180
}
