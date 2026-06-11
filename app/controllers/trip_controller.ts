import User from '#models/user'
import Viaje from '#models/viaje'
import Conductor from '#models/conductor'
import Ganancia from '#models/ganancia'
import Calificacion from '#models/calificacion'
import SolicitudCancelacion from '#models/solicitud_cancelacion'
import ConfiguracionPlataforma from '#models/configuracion_plataforma'
import { tripRequestValidator, tripCompleteValidator, tripCancelValidator } from '#validators/trip'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import app from '@adonisjs/core/services/app'
import { randomUUID } from 'node:crypto'
import { ApiOperation, ApiBody, ApiResponse } from '@foadonis/openapi/decorators'
import { emitToClient, emitToDriver, emitToAdmin } from '#start/socket'
import { sendToMultiple, sendToToken } from '#services/push_notification_service'
import GeoService from '#services/geo_service'
import TripStateMachine, { type EstadoViaje } from '#services/trip_state_machine'
import TripFinalizationService from '#services/trip_finalization_service'

export default class TripController {
  @ApiOperation({ summary: 'Request a trip', description: 'Creates a new trip request' })
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
      .whereIn('estado', ['buscando_conductor', 'aceptado', 'en_curso'])
      .first()
    if (viajeActivo) {
      return response.status(409).send({
        error: 'Ya tienes un viaje activo. Debes cancelarlo o esperar a que termine.',
        viajeId: String(viajeActivo.id),
      })
    }

    const data = await request.validateUsing(tripRequestValidator)

    const config = await ConfiguracionPlataforma.first()
    const zonas = config?.zonasCobertura
    if (zonas && Array.isArray(zonas) && zonas.length > 0) {
      const dentro = zonas.some((z: any) => {
        const R = 6371
        const dLat = ((data.origen.lat - z.lat) * Math.PI) / 180
        const dLng = ((data.origen.lng - z.lng) * Math.PI) / 180
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos((z.lat * Math.PI) / 180) *
            Math.cos((data.origen.lat * Math.PI) / 180) *
            Math.sin(dLng / 2) ** 2
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        return R * c <= z.radio
      })
      if (!dentro) {
        return response
          .status(422)
          .send({ error: 'Lo sentimos, por el momento solo operamos en Cali, Popayán y Pasto.' })
      }
    }

    const viaje = await Viaje.create({
      clienteId: user.id,
      estado: 'buscando_conductor',
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

    // Obtener conductores online dentro de 20km del origen usando Haversine en DB
    // Antes: traía TODOS los conductores online sin filtro geográfico (bug de performance y spam)
    const conductoresCercanosRaw = await GeoService.obtenerConductoresCercanos(
      data.origen.lat,
      data.origen.lng,
      20
    )

    // Para emitir por socket y push, necesitamos los usuarioId y fcmToken
    // GeoService devuelve los datos básicos; cargamos el resto con una query simple
    const conductorIds = conductoresCercanosRaw.map((c: any) => c.id)

    let conductoresCercanos: any[] = []
    if (conductorIds.length > 0) {
      conductoresCercanos = await Conductor.query()
        .whereIn('id', conductorIds)
        .whereHas('usuario', (q) => q.whereNotNull('fcm_token'))
        .preload('usuario')
    }

    const tripPayload = {
      id: String(viaje.id),
      clienteId: String(viaje.clienteId),
      estado: viaje.estado,
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
      precioCliente: viaje.precioCliente,
      precioEstimado: viaje.precioEstimado,
      createdAt: viaje.createdAt.toISO(),
    }

    // Emitir solo a conductores online en lugar de broadcast global
    for (const c of conductoresCercanos) {
      emitToDriver(c.usuarioId, 'trip:new', tripPayload)
    }

    const tokens = conductoresCercanos.map((c) => c.usuario.fcmToken).filter(Boolean) as string[]
    if (tokens.length > 0) {
      await sendToMultiple(
        tokens,
        'Nuevo viaje disponible',
        `Viaje de ${data.origen.direccion} a ${data.destino.direccion}`
      )
    }

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
    summary: 'Get nearby trips',
    description: 'Returns trips near a given location within a radius. Uses DB-level Haversine — no in-memory filtering.',
  })
  @ApiResponse({ type: 'array' })
  async nearby({ request, serialize, response }: HttpContext) {
    const lat = Number.parseFloat(request.input('lat', ''))
    const lng = Number.parseFloat(request.input('lng', ''))
    const radio = Number.parseFloat(request.input('radio', '5'))

    // Validar coordenadas antes de cualquier operación
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return response.status(422).send({ error: 'lat inválida. Debe ser un número entre -90 y 90.' })
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      return response.status(422).send({ error: 'lng inválida. Debe ser un número entre -180 y 180.' })
    }
    if (!Number.isFinite(radio) || radio <= 0 || radio > 200) {
      return response.status(422).send({ error: 'radio inválido. Debe ser un número entre 0 y 200.' })
    }

    // Delegar el filtrado geográfico al motor de DB (Haversine en SQL)
    // Evita traer todos los viajes a memoria del servidor para luego filtrarlos.
    const viajes = await GeoService.obtenerViajesCercanos(lat, lng, radio)

    const result = viajes.map((v: any) => ({
      id: String(v.id),
      cliente: {
        nombre: `${v.nombre || ''} ${v.apellido || ''}`.trim(),
        reputacion: v.reputacion,
        visibilidad: v.visibilidad,
        totalViajes: v.totalViajes,
        calificacion: v.calificacion ?? 5.0,
      },
      origen: { direccion: v.origenDireccion, lat: v.origenLat, lng: v.origenLng },
      destino: { direccion: v.destinoDireccion, lat: v.destinoLat, lng: v.destinoLng },
      carga: v.carga,
      precioEstimado: v.precioEstimado,
      distancia: Math.round(Number(v.distancia_km) * 100) / 100,
      createdAt: v.createdAt,
    }))

    return serialize.withoutWrapping(result)
  }

  @ApiOperation({
    summary: 'Get active trip',
    description: 'Returns the currently active trip for the authenticated user',
  })
  @ApiResponse({ type: 'object' })
  async active({ auth, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()

    let viaje
    if (user.rol === 'conductor') {
      const conductor = await Conductor.findByOrFail('usuario_id', user.id)
      viaje = await Viaje.query()
        .where('conductor_id', conductor.id)
        .whereIn('estado', ['aceptado', 'en_curso'])
        .preload('cliente')
        .preload('conductor', (q) => q.preload('usuario'))
        .first()
    } else {
      viaje = await Viaje.query()
        .where('cliente_id', user.id)
        .whereIn('estado', ['buscando_conductor', 'aceptado', 'en_curso'])
        .preload('cliente')
        .preload('conductor', (q) => q.preload('usuario'))
        .first()
    }

    if (!viaje) {
      return response.status(404).send({ error: 'No active trip' })
    }

    return serialize.withoutWrapping(this.formatViajeResponse(viaje))
  }

  @ApiOperation({ summary: 'Accept a trip (DEPRECATED)', description: 'DEPRECATED: usar POST /trips/:id/offers/:offerId/accept. Este endpoint será eliminado en la próxima versión mayor.' })
  @ApiResponse({ type: 'object' })
  async accept({ params, serialize, auth, response }: HttpContext) {
    // Cabecera de deprecación según RFC 8594
    response.header('Deprecation', 'true')
    response.header(
      'Sunset',
      new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toUTCString() // 90 días
    )
    response.header(
      'Link',
      '</api/trips/:id/offers/:offerId/accept>; rel="successor-version"'
    )

    const user = auth.getUserOrFail()
    if (user.rol !== 'conductor') {
      return response.status(403).send({ error: 'Solo los conductores pueden aceptar viajes' })
    }

    const viaje = await Viaje.find(params.id)
    if (!viaje) {
      return response.status(404).send({ error: 'Viaje no encontrado' })
    }
    if (viaje.estado !== 'buscando_conductor') {
      return response.status(422).send({ error: 'Este viaje ya no está disponible' })
    }

    const conductor = await Conductor.findByOrFail('usuario_id', user.id)

    if (user.suspendido) {
      return response.status(403).send({ error: 'Tu cuenta está suspendida. Contacta al administrador.' })
    }

    if (conductor.estadoVerificacion !== 'aprobado') {
      return response.status(403).send({ error: 'Tu cuenta de conductor no está verificada.' })
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

    await viaje.save()

    await viaje.load((loader) => {
      loader.load('conductor', (q) => q.preload('usuario'))
    })

    emitToClient(viaje.clienteId, 'trip:accepted', {
      id: String(viaje.id),
      estado: viaje.estado,
      conductor: {
        id: String(viaje.conductor.id),
        nombre:
          `${viaje.conductor.usuario.nombre || ''} ${viaje.conductor.usuario.apellido || ''}`.trim(),
        telefono: viaje.conductor.usuario.telefono,
        placa: viaje.conductor.placa,
        foto: viaje.conductor.fotoConductor,
        calificacion: viaje.conductor.calificacion,
      },
      tiempoEstimadoMinutos: viaje.tiempoEstimadoMinutos,
      aceptadoAt: viaje.aceptadoAt.toISO(),
    })

    return serialize.withoutWrapping({
      id: String(viaje.id),
      estado: viaje.estado,
      aceptadoAt: viaje.aceptadoAt.toISO(),
    })
  }

  @ApiOperation({
    summary: 'Start trip (pickup)',
    description: 'Changes trip to en_curso after driver picks up cargo',
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
      return response.status(422).send({ error: `El viaje debe estar en estado 'aceptado' para iniciarse (estado actual: ${viaje.estado})` })
    }

    viaje.estado = 'en_curso'
    viaje.enCursoAt = DateTime.now()
    await viaje.save()

    emitToClient(viaje.clienteId, 'trip:started', {
      id: String(viaje.id),
      estado: viaje.estado,
      enCursoAt: viaje.enCursoAt.toISO(),
    })

    return serialize.withoutWrapping({
      id: String(viaje.id),
      estado: viaje.estado,
      enCursoAt: viaje.enCursoAt.toISO(),
    })
  }

  @ApiOperation({ summary: 'Decline a trip', description: 'Driver declines a pending trip' })
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

    emitToClient(viaje.clienteId, 'trip:declined', {
      id: String(viaje.id),
      estado: viaje.estado,
    })

    return serialize.withoutWrapping({ id: String(viaje.id), estado: viaje.estado })
  }

  @ApiOperation({ summary: 'Complete a trip', description: 'Marks a trip as completed' })
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

    if (!TripStateMachine.validarTransicion(viaje.estado as EstadoViaje, 'completado')) {
      return response.status(422).send({ error: `El viaje debe estar 'en_curso' para completarse (estado actual: ${viaje.estado})` })
    }

    const data = await request.validateUsing(tripCompleteValidator)
    viaje.estado = 'completado'
    viaje.precioFinal = data.montoFinal
    viaje.completadoAt = DateTime.now()
    await viaje.save()

    emitToClient(viaje.clienteId, 'trip:finalized', {
      id: String(viaje.id),
      estado: viaje.estado,
      montoFinal: viaje.precioFinal,
      completadoAt: viaje.completadoAt.toISO(),
    })

    return serialize.withoutWrapping({
      id: String(viaje.id),
      estado: viaje.estado,
      montoFinal: viaje.precioFinal,
      completadoAt: viaje.completadoAt.toISO(),
    })
  }

  @ApiOperation({
    summary: 'Finalize delivery',
    description: 'Confirms delivery, sets driver online, records payment. Idempotent — safe to retry.',
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
      actorRol: user.rol,
    })

    if (!result.ok) {
      return response.status(result.statusCode).send({ error: result.error })
    }

    // ── Notificaciones y sockets (fuera de la transacción) ────────────────
    // Si la operación fue idempotente (el viaje ya estaba finalizado) no
    // volvemos a emitir eventos para no spam al frontend con duplicados.
    if (!result.idempotent) {
      emitToClient(Number(result.viaje.id), 'trip:finalized', {
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

      // Push notification al cliente
      const viaje = await Viaje.find(Number(result.viaje.id))
      if (viaje) {
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

  @ApiOperation({ summary: 'Cancel a trip', description: 'Cancels a trip with an optional reason' })
  @ApiBody({ type: () => tripCancelValidator })
  @ApiResponse({ type: 'object' })
  async cancel({ params, request, serialize, auth, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const data = await request.validateUsing(tripCancelValidator)
    const viaje = await Viaje.findOrFail(params.id)

    // Solo el admin puede cancelar un viaje en curso
    if (viaje.estado === 'en_curso' && user.rol !== 'admin') {
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

    const estadoAnterior = viaje.estado
    viaje.estado = 'cancelado'
    viaje.motivoCancelacion = data.motivo || null
    viaje.canceladoAt = DateTime.now()
    await viaje.save()

    if (user.id === viaje.clienteId && estadoAnterior === 'aceptado') {
      const cliente = await User.find(viaje.clienteId)
      if (cliente) {
        cliente.reputacion = Math.max(1.0, cliente.reputacion - 0.5)
        await cliente.save()
      }
    }

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
      }
    }

    return serialize.withoutWrapping({
      id: String(viaje.id),
      estado: viaje.estado,
      canceladoAt: viaje.canceladoAt.toISO(),
    })
  }

  @ApiOperation({ summary: 'Request cancellation', description: 'Conductor requests trip cancellation when en_curso. Admin must approve.' })
  @ApiResponse({ type: 'object' })
  async requestCancellation({ auth, params, request, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (user.rol !== 'conductor') {
      return response.status(403).send({ error: 'Solo los conductores pueden solicitar cancelación' })
    }

    const viaje = await Viaje.findOrFail(params.id)
    if (viaje.estado !== 'en_curso') {
      return response.status(422).send({ error: `Solo puedes solicitar cancelación cuando el viaje está en curso (estado actual: ${viaje.estado})` })
    }

    const conductor = await Conductor.findByOrFail('usuario_id', user.id)
    if (viaje.conductorId !== conductor.id) {
      return response.status(403).send({ error: 'No eres el conductor asignado a este viaje' })
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
      conductorId: conductor.id,
      motivo: motivo || 'Sin motivo especificado',
      estado: 'pendiente',
    })

    emitToAdmin('admin:cancellation_requested', {
      id: String(solicitud.id),
      viajeId: String(viaje.id),
      conductorId: String(conductor.id),
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
    summary: 'Get trip history',
    description: 'Returns paginated trip history for the authenticated user',
  })
  @ApiResponse({ type: 'array' })
  async history({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const page = Number.parseInt(request.input('page', '1'))
    const limitRaw = Number.parseInt(request.input('limit', '20'))
    const limit = Math.min(100, Math.max(1, Number.isNaN(limitRaw) ? 20 : limitRaw))
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
    summary: 'Get trip details',
    description: 'Returns details of a specific trip by ID',
  })
  @ApiResponse({ type: 'object' })
  async show({ auth, params, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const viaje = await Viaje.query()
      .where('id', params.id)
      .preload('cliente')
      .preload('conductor', (q) => q.preload('usuario'))
      .firstOrFail()

    // Solo el cliente, el conductor asignado o un admin pueden ver los detalles del viaje
    if (user.rol !== 'admin') {
      const esCliente = viaje.clienteId === user.id
      let esConductor = false
      if (user.rol === 'conductor' && viaje.conductorId) {
        const conductor = await Conductor.findBy('usuario_id', user.id)
        esConductor = conductor !== null && viaje.conductorId === conductor.id
      }
      if (!esCliente && !esConductor) {
        return response.status(403).send({ error: 'No tienes permisos para ver este viaje' })
      }
    }

    return serialize.withoutWrapping(this.formatViajeResponse(viaje))
  }

  private formatViajeResponse(viaje: Viaje) {
    return {
      id: String(viaje.id),
      estado: viaje.estado,
      cliente: {
        id: String(viaje.cliente.id),
        nombre: `${viaje.cliente.nombre || ''} ${viaje.cliente.apellido || ''}`.trim(),
        telefono: viaje.cliente.telefono,
        avatar: viaje.cliente.avatar,
      },
      conductor: viaje.conductor
        ? {
            id: String(viaje.conductor.id),
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
      fotoEntrega: viaje.fotoEntrega,
      tiempoEstimadoMinutos: Number(viaje.tiempoEstimadoMinutos),
      precioEstimado: Number(viaje.precioEstimado),
      precioFinal: Number(viaje.precioFinal),
      // tiempoEstimadoMinutos ya está incluido arriba
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
    if (!puntaje || puntaje < 1 || puntaje > 5) {
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
      puntaje,
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
      puntaje,
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

    if (!['en_curso', 'completado'].includes(viaje.estado)) {
      return response
        .status(422)
        .send(serialize.withoutWrapping({ error: 'Solo puedes subir foto de entrega cuando el viaje está en curso o completado' }))
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
