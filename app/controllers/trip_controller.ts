import db from '@adonisjs/lucid/services/db'
import type { TransactionClientContract } from '@adonisjs/lucid/types/database'
import User from '#models/user'
import Viaje from '#models/viaje'
import Conductor from '#models/conductor'
import Calificacion from '#models/calificacion'
import SolicitudCancelacion from '#models/solicitud_cancelacion'
import LogFraude from '#models/log_fraude'
import Disputa from '#models/disputa'
import {
  tripRequestValidator,
  tripReserveValidator,
  tripCompleteValidator,
  tripCancelValidator,
} from '#validators/trip'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import StorageService from '#services/storage_service'
import { randomUUID } from 'node:crypto'
import { ApiOperation, ApiBody, ApiResponse } from '@foadonis/openapi/decorators'
import { emitToClient, emitToDriver, emitToAdmin, emitTripStatusChanged } from '#start/socket'
import { sendToToken } from '#services/push_notification_service'
import GeoService, { distanciaKm } from '#services/geo_service'
import { rutaDelViaje, payloadRuta } from '#services/trip_route_service'
import CoverageService from '#services/coverage_service'
import TripDispatchService from '#services/trip_dispatch_service'
import TripConflictService from '#services/trip_conflict_service'
import reservationConfig from '#config/reservations'
import { parseScheduledDateTime } from '#services/reservation_time'
import TripStateMachine, { type EstadoViaje } from '#services/trip_state_machine'
import TripFinalizationService from '#services/trip_finalization_service'
import DriverDebtSuspensionService from '#services/driver_debt_suspension_service'
import { emitTripUpdateToModerators } from '#services/moderator_trip_events'
import antifraudeConfig from '#config/antifraude'
import logger from '@adonisjs/core/services/logger'
import AntifraudeService from '#services/antifraude_service'

/** Estados en los que un viaje del cliente le impide pedir o reservar otro. */
const ESTADOS_VIAJE_ACTIVO_CLIENTE = [
  'buscando_conductor',
  'pendiente',
  'aceptado',
  'conductor_en_camino',
  'conductor_llegada',
  'en_curso',
  'entregado',
  'esperando_confirmacion',
  // El conductor finalizó y falta que el cliente confirme la entrega.
  'pendiente_confirmacion',
  'sos',
  'disputa',
]

/** Estados que GET /api/trips/active devuelve al cliente como su viaje actual. */
const ESTADOS_VIAJE_ACTUAL_CLIENTE = ['creado', ...ESTADOS_VIAJE_ACTIVO_CLIENTE]

function viajeActivoDelCliente(clienteId: number, trx?: TransactionClientContract) {
  return Viaje.query(trx ? { client: trx } : {})
    .where('cliente_id', clienteId)
    .whereIn('estado', ESTADOS_VIAJE_ACTIVO_CLIENTE)
    .first()
}

type Punto = { lat: number; lng: number }

/**
 * Cobertura compartida por viajes inmediatos y reservas: origen y destino deben
 * estar dentro de una zona activa. Devuelve el mensaje de error o null.
 */
async function errorDeCobertura(origen: Punto, destino: Punto): Promise<string | null> {
  if (!(await GeoService.validarCobertura(origen.lat, origen.lng))) {
    return CoverageService.mensajeFueraDeCobertura()
  }
  if (!(await GeoService.validarCobertura(destino.lat, destino.lng))) {
    const zonas = await CoverageService.mensajeFueraDeCobertura()
    return `El destino está fuera de nuestra zona de cobertura. ${zonas}`
  }
  return null
}

/**
 * SELECT ... FOR UPDATE sobre la fila del cliente: serializa la creación de
 * viajes/reservas del mismo cliente (MySQL). En SQLite es un no-op, pero allí
 * las transacciones ya se serializan en la única conexión.
 */
async function bloquearCliente(clienteId: number, trx: TransactionClientContract) {
  await User.query({ client: trx }).where('id', clienteId).forUpdate().first()
}

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
    // Verificación rápida (se repite bajo bloqueo antes de insertar).
    const viajeActivo = await viajeActivoDelCliente(user.id)
    if (viajeActivo) {
      return response.status(409).send({
        error: 'Ya tienes un viaje activo. Debes cancelarlo o esperar a que termine.',
        viajeId: String(viajeActivo.id),
      })
    }

    const data = await request.validateUsing(tripRequestValidator)

    // Validación de cobertura (origen y destino) compartida con las reservas programadas.
    const fueraDeCobertura = await errorDeCobertura(data.origen, data.destino)
    if (fueraDeCobertura) {
      return response.status(422).send({ error: fueraDeCobertura })
    }

    // Verificación + INSERT atómicos: el FOR UPDATE sobre la fila del cliente
    // serializa solicitudes simultáneas (doble tap, reintentos sin
    // X-Idempotency-Key), así solo una puede crear el viaje.
    const creado = await db.transaction(async (trx) => {
      await bloquearCliente(user.id, trx)
      const activo = await viajeActivoDelCliente(user.id, trx)
      if (activo) return { activo }

      const nuevo = await Viaje.create(
        {
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
        },
        { client: trx }
      )

      // Transicion inmediata a buscando_conductor
      nuevo.estado = 'buscando_conductor'
      await nuevo.useTransaction(trx).save()
      return { viaje: nuevo }
    })

    if (creado.activo) {
      return response.status(409).send({
        error: 'Ya tienes un viaje activo. Debes cancelarlo o esperar a que termine.',
        viajeId: String(creado.activo.id),
      })
    }
    const viaje = creado.viaje!

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
    // Verificación rápida (se repite bajo bloqueo antes de insertar).
    const viajeEnCurso = await viajeActivoDelCliente(user.id)
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

    // Misma validación de cobertura (origen y destino) que el viaje inmediato.
    const fueraDeCobertura = await errorDeCobertura(data.origen, data.destino)
    if (fueraDeCobertura) {
      return response.status(422).send({ error: fueraDeCobertura })
    }

    // La búsqueda de conductor arranca `dispatchLeadMinutes` antes de la hora programada.
    // Se normaliza a la zona del servidor porque Lucid lee las columnas `dateTime`
    // con `DateTime.fromSQL` (sin offset en sqlite/mysql).
    const activacionAt = programada
      .minus({ minutes: reservationConfig.dispatchLeadMinutes })
      .setZone(DateTime.now().zone)

    // Verificaciones + INSERT atómicos (FOR UPDATE sobre la fila del cliente):
    // dos reservas simultáneas no pueden pasar ambas las verificaciones.
    const creada = await db.transaction(async (trx) => {
      await bloquearCliente(user.id, trx)

      const enCurso = await viajeActivoDelCliente(user.id, trx)
      if (enCurso) {
        return {
          conflicto: {
            error: 'Ya tienes un viaje activo. Debes cancelarlo o esperar a que termine para reservar otro.',
            viajeId: String(enCurso.id),
          },
        }
      }

      // Evitar dos reservas activas del mismo cliente para el mismo horario.
      const duplicada = await Viaje.query({ client: trx })
        .where('cliente_id', user.id)
        .where('tipo_programacion', 'programada')
        .where('fecha_programada', data.fechaProgramada)
        .where('hora_programada', data.horaProgramada)
        .whereNot('estado', 'cancelado')
        .first()
      if (duplicada) {
        return {
          conflicto: {
            error: 'Ya tienes una reserva para esa misma fecha y hora.',
            viajeId: String(duplicada.id),
          },
        }
      }

      const nueva = await Viaje.create(
        {
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
        },
        { client: trx }
      )
      return { viaje: nueva }
    })

    if (creada.conflicto) {
      return response.status(409).send(creada.conflicto)
    }
    const viaje = creada.viaje!

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
    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
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

  /**
   * Ruta y ETA actuales del viaje (la misma para cliente y conductor), para
   * dibujarla al abrir la pantalla sin esperar a que el conductor se mueva.
   * Usa la caché de trip_route_service: normalmente no llama a Mapbox.
   */
  async route({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const viaje = await Viaje.find(params.id)
    if (!viaje) return response.status(404).json({ error: 'Viaje no encontrado' })
    const conductor = viaje.conductorId ? await Conductor.find(viaje.conductorId) : null
    if (viaje.clienteId !== user.id && conductor?.usuarioId !== user.id) {
      return response.status(403).json({ error: 'No participas en este viaje' })
    }
    if (!conductor?.ultimaUbicacionLat || !conductor?.ultimaUbicacionLng) {
      return response.status(404).json({ error: 'Aún no hay ubicación del conductor', code: 'SIN_UBICACION' })
    }
    const estado = await rutaDelViaje(viaje, [
      Number(conductor.ultimaUbicacionLat),
      Number(conductor.ultimaUbicacionLng),
    ])
    if (!estado) {
      return response.status(404).json({ error: 'El viaje no está en una fase con ruta', code: 'SIN_RUTA' })
    }
    return response.json(
      payloadRuta(viaje.id, estado, true, conductor.ubicacionActualizadaEn?.toISO() ?? null)
    )
  }

  /**
   * Vehículos disponibles cerca del origen de un viaje, para que el cliente los vea
   * en el mapa mientras busca conductor. Solo posiciones aproximadas y tipo de vehículo.
   */
  async nearbyDrivers({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const viaje = await Viaje.find(params.id)
    if (!viaje) return response.status(404).json({ error: 'Viaje no encontrado' })
    if (viaje.clienteId !== user.id) {
      return response.status(403).json({ error: 'No tienes acceso a este viaje' })
    }
    const radioKm = antifraudeConfig.radioConductoresVisiblesKm
    if (!['buscando_conductor', 'pendiente'].includes(viaje.estado)) {
      return response.json({ radioKm, conductores: [] })
    }

    const desde = DateTime.now().minus({ seconds: antifraudeConfig.ubicacionMaxSeg })
    const candidatos = await Conductor.query()
      .where('online', true)
      .where('estado_verificacion', 'aprobado')
      .whereNotNull('ultima_ubicacion_lat')
      .whereNotNull('ultima_ubicacion_lng')
      .where('ubicacion_actualizada_en', '>=', desde.toSQL()!)

    const conductores = candidatos
      .map((c) => ({
        c,
        distancia: distanciaKm(
          Number(viaje.origenLat),
          Number(viaje.origenLng),
          Number(c.ultimaUbicacionLat),
          Number(c.ultimaUbicacionLng)
        ),
      }))
      .filter(({ distancia }) => distancia <= radioKm)
      .sort((a, b) => a.distancia - b.distancia)
      .slice(0, 30)
      .map(({ c, distancia }) => ({
        // Redondeado a ~11 m: suficiente para el mapa sin exponer la posición exacta.
        lat: Math.round(Number(c.ultimaUbicacionLat) * 1e4) / 1e4,
        lng: Math.round(Number(c.ultimaUbicacionLng) * 1e4) / 1e4,
        tipoVehiculo: c.tipoVehiculo,
        distanciaKm: Math.round(distancia * 100) / 100,
      }))

    return response.json({ radioKm, conductores })
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
      const viajeDelConductor = () =>
        Viaje.query()
          .where('conductor_id', conductor.id)
          .preload('cliente', (q) => q.select('id', 'nombre', 'apellido', 'telefono', 'avatar'))
          .preload('conductor', (q) => q.select('id', 'placa', 'tipo_vehiculo', 'foto_conductor', 'calificacion', 'total_viajes', 'usuario_id').preload('usuario', (uq) => uq.select('id', 'nombre', 'apellido', 'telefono')))
      viaje = await viajeDelConductor()
        .whereIn('estado', ['aceptado', 'conductor_en_camino', 'conductor_llegada', 'en_curso', 'entregado', 'esperando_confirmacion', 'sos'])
        .first()
      // Sin viaje en curso: el más reciente que espera la confirmación del
      // cliente, para no perderlo al reiniciar la app. No cuenta como ocupado
      // (TripConflictService), así que un viaje activo nuevo tiene prioridad.
      if (!viaje) {
        viaje = await viajeDelConductor()
          .where('estado', 'pendiente_confirmacion')
          .orderBy('id', 'desc')
          .first()
      }
    } else {
      viaje = await Viaje.query()
        .where('cliente_id', user.id)
        .whereIn('estado', ESTADOS_VIAJE_ACTUAL_CLIENTE)
        .preload('cliente', (q) => q.select('id', 'nombre', 'apellido', 'telefono', 'avatar'))
        .preload('conductor', (q) => q.select('id', 'placa', 'tipo_vehiculo', 'foto_conductor', 'calificacion', 'total_viajes', 'usuario_id').preload('usuario', (uq) => uq.select('id', 'nombre', 'apellido', 'telefono')))
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

    const bloqueoPago = DriverDebtSuspensionService.bloqueo(user)
    if (bloqueoPago) {
      return response.status(403).send(bloqueoPago)
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

        // FOR UPDATE sobre el conductor: serializa dos aceptaciones simultáneas
        // del mismo conductor en viajes distintos.
        await Conductor.query({ client: trx }).where('id', conductor.id).forUpdate().first()

        // Un conductor = un servicio a la vez (inmediatos) y sin choques de
        // horario (reservas programadas).
        const conflicto = await TripConflictService.conductorTieneConflicto(
          conductor.id,
          viaje,
          trx
        )
        if (conflicto && viaje.tipoProgramacion === 'programada') {
          throw Object.assign(new Error('CONFLICTO_HORARIO'), {
            statusCode: 409,
            code: 'CONFLICTO_HORARIO',
            message: 'Tienes otro viaje incompatible en ese horario',
          })
        }
        if (conflicto) {
          throw Object.assign(new Error('CONDUCTOR_OCUPADO'), {
            statusCode: 409,
            code: 'CONDUCTOR_OCUPADO',
            message: 'Ya estás atendiendo un servicio. Termínalo antes de aceptar otro viaje.',
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
        return response
          .status(err.statusCode)
          .send(err.code ? { error: err.message, code: err.code } : { error: err.message })
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
          totalViajes: resultado.viaje.conductor.totalViajes,
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
        totalViajes: resultado.viaje.conductor.totalViajes,
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

    // R2: Validar distancia al origen para marcar la recogida (radioRecogidaKm)
    if (!conductor.ultimaUbicacionLat || !conductor.ultimaUbicacionLng) {
      return response.status(422).send({
        error: 'No tienes ubicación registrada. Actualiza tu ubicación antes de marcar la recogida.',
        code: 'UBICACION_NO_RECIENTE',
      })
    }
    if (!conductor.ubicacionActualizadaEn) {
      return response.status(422).send({
        error: 'Tu ubicación no es reciente. Actualízala antes de marcar la recogida.',
        code: 'UBICACION_NO_RECIENTE',
      })
    }
    const ubicacionAgeSeg = DateTime.now().diff(conductor.ubicacionActualizadaEn, 'seconds').seconds
    if (ubicacionAgeSeg > antifraudeConfig.ubicacionMaxSeg) {
      return response.status(422).send({
        error: 'Tu ubicación no es reciente. Actualízala antes de marcar la recogida.',
        code: 'UBICACION_NO_RECIENTE',
      })
    }
    const distOrigenKm = distanciaKm(
      conductor.ultimaUbicacionLat,
      conductor.ultimaUbicacionLng,
      viaje.origenLat,
      viaje.origenLng
    )
    if (distOrigenKm >= antifraudeConfig.radioRecogidaKm) {
      // Registrar en logs_fraude
      try {
        await LogFraude.create({
          userId: user.id,
          conductorId: conductor.id,
          tipo: 'recogida_fuera_de_origen',
          descripcion: `Intento de marcar recogida a ${distOrigenKm.toFixed(2)} km del origen`,
          latitud: conductor.ultimaUbicacionLat,
          longitud: conductor.ultimaUbicacionLng,
          metadata: { viajeId: viaje.id, distanciaKm: distOrigenKm },
        })
        emitToAdmin('admin:fraud_alert', {
          tipo: 'recogida_fuera_de_origen',
          viajeId: viaje.id,
          conductorId: conductor.id,
          distanciaKm: distOrigenKm,
        })
      } catch (e) {
        logger.error({ err: e }, 'Error registrando fraude en recogida')
      }
      return response.status(422).send({
        error: `No puedes marcar la recogida: estás a ${distOrigenKm.toFixed(2)} km del punto de origen.`,
        code: 'FUERA_DE_RANGO_ORIGEN',
        distanciaKm: distOrigenKm,
      })
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

    const clienteInicio = await User.find(viaje.clienteId)
    if (clienteInicio?.fcmToken) {
      await sendToToken(
        clienteInicio.fcmToken,
        'Tu viaje comenzó',
        'El conductor recogió tu carga y va hacia el destino.'
      )
    }

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

  @ApiOperation({ summary: 'Completar un viaje', description: 'El conductor solicita cerrar el servicio (pasa a pendiente_confirmacion)' })
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

    if (!TripStateMachine.validarTransicion(viaje.estado as EstadoViaje, 'pendiente_confirmacion')) {
      return response.status(422).send({ error: `El viaje debe estar 'en_curso' para completarse (estado actual: ${viaje.estado})` })
    }

    const data = await request.validateUsing(tripCompleteValidator)

    // R3: Validar distancia al destino
    if (!conductor.ultimaUbicacionLat || !conductor.ultimaUbicacionLng) {
      return response.status(422).send({
        error: 'No tienes ubicación registrada. Actualiza tu ubicación antes de cerrar el servicio.',
        code: 'UBICACION_NO_RECIENTE',
      })
    }
    if (!conductor.ubicacionActualizadaEn) {
      return response.status(422).send({
        error: 'Tu ubicación no es reciente. Actualízala antes de cerrar el servicio.',
        code: 'UBICACION_NO_RECIENTE',
      })
    }
    const ubicacionAgeSeg = DateTime.now().diff(conductor.ubicacionActualizadaEn, 'seconds').seconds
    if (ubicacionAgeSeg > antifraudeConfig.ubicacionMaxSeg) {
      return response.status(422).send({
        error: 'Tu ubicación no es reciente. Actualízala antes de cerrar el servicio.',
        code: 'UBICACION_NO_RECIENTE',
      })
    }
    const distDestinoKm = distanciaKm(
      conductor.ultimaUbicacionLat,
      conductor.ultimaUbicacionLng,
      viaje.destinoLat,
      viaje.destinoLng
    )

    const justificacion = request.input('justificacion') as string | undefined
    const fueraDeRango = distDestinoKm >= antifraudeConfig.radioCierreKm

    if (fueraDeRango) {
      // R3b: Fuera de rango - exige justificación
      if (!justificacion || justificacion.trim().length < 10) {
        return response.status(422).send({
          error: `Estás a ${distDestinoKm.toFixed(2)} km del destino. Para cerrar el servicio debes justificar el motivo.`,
          code: 'JUSTIFICACION_REQUERIDA',
          distanciaKm: distDestinoKm,
        })
      }
    }

    // Cambiar a pendiente_confirmacion
    viaje.estado = 'pendiente_confirmacion'
    // El precio es el acordado al aceptar la oferta (offer_controller fija
    // precioFinal = oferta.monto): el conductor no lo puede cambiar al cerrar.
    // `montoFinal` sólo se usa si el viaje no tiene ningún precio (legado).
    viaje.precioFinal =
      viaje.precioFinal ?? viaje.precioCliente ?? viaje.precioEstimado ?? data.montoFinal ?? 0
    viaje.completadoAt = DateTime.now()
    viaje.pendienteConfirmacionDesde = DateTime.now()
    viaje.moderadorNotificadoEn = null
    await viaje.save()

    // Registrar en logs_fraude si fuera de rango
    if (fueraDeRango) {
      try {
        await LogFraude.create({
          userId: user.id,
          conductorId: conductor.id,
          tipo: 'cierre_fuera_de_destino',
          descripcion: `Cierre fuera de rango (${distDestinoKm.toFixed(2)} km). Justificación: ${justificacion}`,
          latitud: conductor.ultimaUbicacionLat,
          longitud: conductor.ultimaUbicacionLng,
          metadata: { viajeId: viaje.id, distanciaKm: distDestinoKm, justificacion },
        })
        emitToAdmin('admin:fraud_alert', {
          tipo: 'cierre_fuera_de_destino',
          viajeId: viaje.id,
          conductorId: conductor.id,
          distanciaKm: distDestinoKm,
          justificacion,
        })
      } catch (e) {
        logger.error({ err: e }, 'Error registrando fraude en cierre')
      }
    }

    // Emitir trip:finalize_request al cliente
    emitToClient(viaje.clienteId, 'trip:finalize_request', {
      viajeId: String(viaje.id),
      estado: 'pendiente_confirmacion',
      fueraDeRango,
      distanciaKm: distDestinoKm,
      justificacion: fueraDeRango ? justificacion : undefined,
      montoFinal: viaje.precioFinal,
    })

    emitTripStatusChanged(viaje.clienteId, conductor.usuarioId, {
      id: String(viaje.id),
      estado: 'pendiente_confirmacion',
      montoFinal: viaje.precioFinal,
      completadoAt: viaje.completadoAt.toISO(),
    })

    emitTripUpdateToModerators(viaje)

    // Push: el cliente debe confirmar aunque no tenga la app abierta.
    const clienteCierre = await User.find(viaje.clienteId)
    if (clienteCierre?.fcmToken) {
      await sendToToken(
        clienteCierre.fcmToken,
        'Tu carga llegó al destino',
        'El conductor terminó la entrega. Entra a la app para confirmarla.'
      )
    }

    return serialize.withoutWrapping({
      id: String(viaje.id),
      estado: 'pendiente_confirmacion',
      mensaje: 'Está en proceso de cerrar el servicio, a la espera de la confirmación del servicio por parte del cliente.',
      montoFinal: viaje.precioFinal,
      completadoAt: viaje.completadoAt.toISO(),
    })
  }

  @ApiOperation({
    summary: 'Finalizar un viaje (alias de complete)',
    description: 'El conductor solicita cerrar el servicio (pasa a pendiente_confirmacion). Misma regla antifraude que complete.',
  })
  @ApiBody({ type: () => tripCompleteValidator })
  @ApiResponse({ type: 'object' })
  async finalize(ctx: HttpContext) {
    return this.complete(ctx)
  }

  @ApiOperation({
    summary: 'Finalizar entrega (cliente confirma cierre)',
    description: 'El cliente confirma o rechaza el cierre del servicio solicitado por el conductor',
  })
  @ApiResponse({ type: 'object' })
  async confirmClose({ auth, params, request, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()

    if (user.rol !== 'cliente') {
      return response.status(403).send({ error: 'Solo el cliente puede confirmar el cierre del servicio' })
    }

    const { confirmar, motivo } = request.only(['confirmar', 'motivo'])

    if (typeof confirmar !== 'boolean') {
      return response.status(422).send({ error: 'El campo confirmar (true/false) es obligatorio' })
    }

    const viaje = await Viaje.findOrFail(params.id)

    if (viaje.clienteId !== user.id) {
      return response.status(403).send({ error: 'Este viaje no te pertenece' })
    }

    // Solo se puede confirmar desde pendiente_confirmacion
    if (viaje.estado !== 'pendiente_confirmacion') {
      return response.status(422).send({ error: `El viaje no está pendiente de confirmación (estado actual: ${viaje.estado})` })
    }

    if (confirmar) {
      // Cliente confirma → finalizar viaje de verdad
      // Usar TripFinalizationService para la lógica financiera
      await Conductor.findByOrFail('id', viaje.conductorId!)
      const result = await TripFinalizationService.finalize({
        viajeId: viaje.id,
        montoFinal: viaje.precioFinal!,
        actorUserId: user.id,
        actorRol: 'cliente',
      })

      if (!result.ok) {
        return response.status(result.statusCode).send({ error: result.error })
      }

      if (!result.idempotent) {
        const viajeFinalizado = await Viaje.find(Number(result.viaje.id))
        if (viajeFinalizado) {
          const conductorStatusChanged = viajeFinalizado.conductorId
            ? await Conductor.find(viajeFinalizado.conductorId)
            : null
          emitTripStatusChanged(
            viajeFinalizado.clienteId,
            conductorStatusChanged?.usuarioId,
            {
              id: String(viajeFinalizado.id),
              estado: 'finalizado',
              montoFinal: result.viaje.montoFinal,
              finalizadoAt: result.viaje.finalizadoAt,
            }
          )

          emitToClient(viajeFinalizado.clienteId, 'trip:finalized', {
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

          emitTripUpdateToModerators(viajeFinalizado)

          const cliente = await User.find(viajeFinalizado.clienteId)
          if (cliente?.fcmToken) {
            await sendToToken(
              cliente.fcmToken,
              'Envío entregado',
              'Tu envío ha sido entregado exitosamente'
            )
          }

          if (viajeFinalizado.conductorId) {
            const conductor = await Conductor.find(viajeFinalizado.conductorId)
            if (conductor) {
              emitToDriver(conductor.usuarioId, 'driver:stop_gps', {
                viajeId: String(viajeFinalizado.id),
              })

              const conductorUser = await User.find(conductor.usuarioId)
              if (conductorUser?.fcmToken && conductorUser.montoDeuda && conductorUser.deudaFechaLimite) {
                const diasRestantes = Math.ceil(
                  conductorUser.deudaFechaLimite.diff(DateTime.now(), 'days').days
                )
                const comision = Math.round(viajeFinalizado.precioFinal! * 0.1 * 100) / 100
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
        estado: 'finalizado',
        montoFinal: result.viaje.montoFinal,
        finalizadoAt: result.viaje.finalizadoAt,
      })
    } else {
      // Cliente rechaza → el viaje pasa a 'disputa'. Un viaje tiene una sola
      // disputa: si el cliente ya abrió una (POST /api/disputes), se reutiliza.
      const conductor = await Conductor.findByOrFail('id', viaje.conductorId!)

      const existente = await Disputa.query().where('viaje_id', viaje.id).first()
      const disputa =
        existente ??
        (await Disputa.create({
          viajeId: viaje.id,
          conductorId: conductor.id,
          clienteId: viaje.clienteId,
          estado: 'abierta',
          problema: 'cliente_rechaza_cierre',
          descripcion:
            motivo || 'El cliente rechazó el cierre del servicio solicitado por el conductor',
          versionConductor: 'Conductor solicitó cierre del servicio',
          versionCliente: motivo || 'Cliente rechazó el cierre',
        }))

      viaje.estado = 'disputa'
      await viaje.save()

      emitTripStatusChanged(viaje.clienteId, conductor.usuarioId, {
        id: String(viaje.id),
        estado: 'disputa',
        disputaId: disputa.id,
      })

      emitToClient(viaje.clienteId, 'trip:close_rejected', {
        viajeId: String(viaje.id),
        estado: 'disputa',
        disputaId: disputa.id,
      })

      emitToDriver(conductor.usuarioId, 'trip:close_rejected', {
        viajeId: String(viaje.id),
        estado: 'disputa',
        disputaId: disputa.id,
        motivo: motivo || 'El cliente rechazó el cierre del servicio',
      })

      emitTripUpdateToModerators(viaje)

      return serialize.withoutWrapping({
        id: String(viaje.id),
        estado: 'disputa',
        disputaId: disputa.id,
      })
    }
  }

  @ApiOperation({ summary: 'Cancelar un viaje', description: 'Cancela un viaje con un motivo opcional' })
  @ApiBody({ type: () => tripCancelValidator })
  @ApiResponse({ type: 'object' })
  async cancel({ params, request, serialize, auth, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const data = await request.validateUsing(tripCancelValidator)
    const viaje = await Viaje.findOrFail(params.id)

    // Solo el admin puede cancelar un viaje en curso o en estados avanzados.
    // Durante un SOS el cliente tampoco cancela directo: debe solicitarlo
    // (request-cancellation) para que lo revise el administrador.
    const requiereRevision =
      (['en_curso', 'conductor_llegada'].includes(viaje.estado) && user.rol !== 'admin') ||
      (viaje.estado === 'sos' && user.rol === 'cliente')
    if (requiereRevision) {
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

    // R1: Cancelación - Cliente no puede cancelar si conductor está a < radioCierreKm del origen
    // R1: Conductor SÍ puede cancelar pero exige justificación (mín 10 chars) y registra en logs_fraude
    if (user.rol === 'cliente' && viaje.conductorId) {
      const conductor = await Conductor.find(viaje.conductorId)
      if (conductor) {
        try {
          await AntifraudeService.validarCancelacionClienteCercaOrigen(viaje, conductor)
        } catch (e: any) {
          if (e.code === 'CONDUCTOR_CERCA') {
            return response.status(422).send({ error: e.message, code: e.code, distanciaKm: e.extra?.distanciaKm })
          }
          throw e
        }
      }
    } else if (user.rol === 'conductor') {
      const conductor = await Conductor.findByOrFail('usuario_id', user.id)
      // Validar justificación obligatoria
      const justificacion = request.input('justificacion') as string | undefined
      try {
        await AntifraudeService.validarCancelacionConductor(justificacion)
      } catch (e: any) {
        if (e.code === 'JUSTIFICACION_REQUERIDA') {
          return response.status(422).send({ error: e.message, code: e.code })
        }
        throw e
      }
      // Registrar en logs_fraude
      await AntifraudeService.registrarFraude('cancelacion_conductor', {
        userId: user.id,
        conductorId: conductor.id,
        viajeId: viaje.id,
        justificacion,
        descripcion: `Conductor canceló el viaje. Justificación: ${justificacion}`,
      })
      // Usar la justificación como motivo
      data.motivo = justificacion
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

    // H4: Penalizar reputacion del conductor si el cancela un viaje ya asignado
    if (user.rol === 'conductor' && viaje.conductorId && ['aceptado', 'conductor_en_camino'].includes(estadoAnterior)) {
      const conductorPenalizado = await Conductor.find(viaje.conductorId)
      if (conductorPenalizado) {
        const conductorUser = await User.find(conductorPenalizado.usuarioId)
        if (conductorUser) {
          conductorUser.reputacion = Math.max(
            1.0,
            Number(conductorUser.reputacion || 5.0) - antifraudeConfig.penalizacionCancelacion
          )
          await conductorUser.save()
        }
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

    // canceladoPor: la app muestra el aviso correcto (no "por el conductor"
    // cuando canceló el propio cliente).
    emitToClient(viaje.clienteId, 'trip:cancelled', {
      id: String(viaje.id),
      estado: viaje.estado,
      motivo: viaje.motivoCancelacion,
      canceladoPor: user.rol,
    })

    if (viaje.conductorId) {
      const conductor = await Conductor.find(viaje.conductorId)
      if (conductor) {
        emitToDriver(conductor.usuarioId, 'trip:cancelled', {
          id: String(viaje.id),
          estado: viaje.estado,
          motivo: viaje.motivoCancelacion,
          canceladoPor: user.rol,
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
    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
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
    // (buscando_conductor/pendiente) para decidir si hace una oferta, pero sin los
    // datos de contacto del cliente (se revelan solo al conductor asignado).
    let soloVistaPrevia = false
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
      soloVistaPrevia = !esCliente && !esConductor
    }

    const data = this.formatViajeResponse(viaje)
    if (soloVistaPrevia) data.cliente.telefono = null
    return serialize.withoutWrapping(data)
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
            // F lib/contracts/calificacion.dart lee `calificacion`/`totalViajes`
            // del conductor para decidir si muestra "Nuevo" o el promedio.
            calificacion: viaje.conductor.calificacion,
            totalViajes: viaje.conductor.totalViajes,
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
      return response.status(404).send(await serialize.withoutWrapping({ error: 'Viaje no encontrado' }))
    }
    if (viaje.estado !== 'finalizado') {
      return response
        .status(422)
        .send(await serialize.withoutWrapping({ error: 'Solo puedes calificar viajes finalizados' }))
    }

    const { puntaje, comentario } = request.only(['puntaje', 'comentario'])
    const rating = request.input('rating', puntaje || null)
    const puntajeFinal = rating ?? puntaje
    if (puntajeFinal === null || puntajeFinal === undefined || puntajeFinal < 1 || puntajeFinal > 5) {
      return response
        .status(422)
        .send(await serialize.withoutWrapping({ error: 'El puntaje debe ser entre 1 y 5' }))
    }

    const existe = await Calificacion.query()
      .where('viaje_id', viaje.id)
      .where('calificador_id', user.id)
      .first()
    if (existe) {
      return response
        .status(400)
        .send(await serialize.withoutWrapping({ error: 'Ya calificaste este viaje' }))
    }

    let calificadoId: number
    let tipo: string

    if (user.rol === 'cliente') {
      // Verificar que el cliente es dueño del viaje
      if (viaje.clienteId !== user.id) {
        return response
          .status(403)
          .send(await serialize.withoutWrapping({ error: 'No eres el cliente de este viaje' }))
      }
      if (!viaje.conductorId) {
        return response
          .status(422)
          .send(await serialize.withoutWrapping({ error: 'El viaje no tiene conductor asignado' }))
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
          .send(await serialize.withoutWrapping({ error: 'No eres el conductor de este viaje' }))
      }
      calificadoId = viaje.clienteId
      tipo = 'conductor_a_cliente'
    } else {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ error: 'No tienes permisos para calificar' }))
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
      return response.status(404).send(await serialize.withoutWrapping({ error: 'Viaje no encontrado' }))
    }

    const conductor = await Conductor.findByOrFail('usuario_id', user.id)
    if (viaje.conductorId !== conductor.id) {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ error: 'No eres el conductor de este viaje' }))
    }

    if (!['en_curso', 'entregado'].includes(viaje.estado)) {
      return response
        .status(422)
        .send(await serialize.withoutWrapping({ error: 'Solo puedes subir foto de entrega cuando el viaje está en curso o entregado' }))
    }

    const file = request.file('file', {
      size: '5mb',
      extnames: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    })
    if (!file) {
      return response.status(400).send({ error: 'No file uploaded' })
    }
    if (!file.isValid) {
      return response.status(422).send({ error: file.errors[0]?.message || 'Archivo inválido' })
    }

    const fileName = `delivery-${viaje.id}-${randomUUID()}.${file.extname}`
    await file.move(StorageService.uploadsDir(), { name: fileName })

    viaje.fotoEntrega = `/storage/uploads/${fileName}`
    await viaje.save()

    return serialize.withoutWrapping({ fotoEntrega: viaje.fotoEntrega })
  }
}
