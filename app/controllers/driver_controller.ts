import Conductor from '#models/conductor'
import Aviso from '#models/aviso'
import AvisoComentario from '#models/aviso_comentario'
import Comunicado from '#models/comunicado'
import { claveDe } from '#services/coverage_service'
import Ganancia from '#models/ganancia'
import Oferta from '#models/oferta'
import UbicacionDriver from '#models/ubicacion_driver'
import Viaje from '#models/viaje'
import PDFDocument from 'pdfkit'
import { driverStatusValidator, driverLocationValidator } from '#validators/driver'
import type { HttpContext } from '@adonisjs/core/http'
import StorageService from '#services/storage_service'
import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import { ApiOperation, ApiBody, ApiResponse } from '@foadonis/openapi/decorators'
import { emitToClient, emitToAdmin, emitToDriver } from '#start/socket'
import { rutaDelViaje, payloadRuta, distanciaM } from '#services/trip_route_service'

/**
 * Viajes a los que ya se envió el push "Conductor cerca": antes salía en cada
 * actualización de ubicación (cada ~10 s) mientras estuviera a < 500 m.
 */
const avisoCercaEnviado = new Set<number>()
/** Igual, pero para el push "llega en 5 min" (una vez por viaje, hacia origen o destino). */
const avisoEta5Enviado = new Set<number>()
import GpsRateLimitService from '#services/gps_rate_limit_service'
import FraudDetectionService from '#services/fraud_detection_service'
import RedisService from '#services/redis_service'
import db from '@adonisjs/lucid/services/db'
import reservationConfig from '#config/reservations'
import SignedUploadService from '#services/signed_upload_service'
import DriverDebtSuspensionService from '#services/driver_debt_suspension_service'
import { ESTADOS_CONDUCTOR_OCUPADO, ORDEN_CONDUCTOR_OCUPADO_SQL } from '#services/trip_conflict_service'

/**
 * Totales de ganancias de UN conductor (opcionalmente desde una fecha). Las subconsultas
 * `Ganancia.query().count()` dentro de `.select()` ignoraban el where y sumaban las
 * ganancias de todos los conductores.
 */
async function resumenGanancias(conductorId: number, desde?: string) {
  const q = db.from('ganancias').where('conductor_id', conductorId)
  if (desde) q.where('created_at', '>=', desde)
  const fila = await q
    .select(
      db.raw('COUNT(*) as viajes'),
      db.raw('COALESCE(SUM(monto_bruto), 0) as bruto'),
      db.raw('COALESCE(SUM(comision), 0) as comision'),
      db.raw('COALESCE(SUM(monto_neto), 0) as neto'),
      db.raw('COALESCE(SUM(CASE WHEN comision_pagada = ? THEN comision ELSE 0 END), 0) as pendiente', [false])
    )
    .first()
  return (fila || {}) as Record<string, any>
}

/** Inicio de día/semana/mes en la zona horaria del negocio, expresado en UTC. */
function inicioDe(unidad: 'day' | 'week' | 'month') {
  return DateTime.now().setZone(reservationConfig.timezone).startOf(unidad).toUTC().toSQL()!
}

export default class DriverController {
  @ApiOperation({
    summary: 'Actualizar estado del conductor',
    description: 'Establece el estado en línea/fuera de línea del conductor',
  })
  @ApiBody({ type: () => driverStatusValidator })
  @ApiResponse({ type: 'object' })
  async status({ auth, request, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const data = await request.validateUsing(driverStatusValidator)

    const conductor = await Conductor.findBy('usuario_id', user.id)
    if (!conductor) {
      return response.status(404).send({ error: 'Perfil de conductor no encontrado' })
    }

    if (data.online && conductor.estadoVerificacion !== 'aprobado') {
      return response.status(403).send({ error: 'Debes estar verificado para ponerte online' })
    }

    // Deuda de comisión vencida (o comprobante en revisión): puede desconectarse,
    // pero no volver a conectarse hasta que el admin apruebe el pago.
    const bloqueo = data.online ? DriverDebtSuspensionService.bloqueo(user) : null
    if (bloqueo) {
      return response.status(403).send(bloqueo)
    }

    conductor.online = data.online
    await conductor.save()

    return serialize.withoutWrapping({
      online: conductor.online,
      updatedAt: DateTime.now().toISO(),
    })
  }

  @ApiOperation({
    summary: 'Obtener ganancias del conductor',
    description: 'Devuelve las ganancias del conductor de hoy, la semana, el mes y el total',
  })
  @ApiResponse({ type: 'object' })
  async earnings({ auth, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const cacheKey = `driver:earnings:${user.id}`
    const cached = await RedisService.cacheGet<any>(cacheKey)
    if (cached) return serialize.withoutWrapping(cached)

    const conductor = await Conductor.findByOrFail('usuario_id', user.id)

    const [hoy, semana, mes, total] = await Promise.all([
      resumenGanancias(conductor.id, inicioDe('day')),
      resumenGanancias(conductor.id, inicioDe('week')),
      resumenGanancias(conductor.id, inicioDe('month')),
      resumenGanancias(conductor.id),
    ])

    function mapPeriod(p: Record<string, any>) {
      return {
        viajesCompletados: Number(p.viajes || 0),
        montoBruto: Number(p.bruto || 0),
        comision: Number(p.comision || 0),
        montoNeto: Number(p.neto || 0),
        comisionPendiente: Number(p.pendiente || 0),
      }
    }

    const data = {
      hoy: mapPeriod(hoy),
      semana: mapPeriod(semana),
      mes: mapPeriod(mes),
      total: mapPeriod(total),
    }

    await RedisService.cacheSet(cacheKey, data, 30)
    return serialize.withoutWrapping(data)
  }

  @ApiOperation({
    summary: 'Ofertas pendientes del conductor',
    description:
      'Devuelve las ofertas del conductor autenticado que siguen pendientes y no han vencido, con su vencimiento (expiresAt) y el origen/destino del viaje',
  })
  @ApiResponse({ type: 'object' })
  async offers({ auth, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (user.rol !== 'conductor') {
      return response.status(403).send({ error: 'Solo los conductores pueden ver sus ofertas' })
    }
    const conductor = await Conductor.findBy('usuario_id', user.id)
    if (!conductor) {
      return response.status(404).send({ error: 'Perfil de conductor no encontrado' })
    }

    const ofertas = await Oferta.query()
      .where('conductor_id', conductor.id)
      .where('estado', 'pendiente')
      // Misma comparación que OfferExpiryService (hora local en SQL).
      .where('expira_at', '>', DateTime.now().toSQL()!)
      .preload('viaje')
      .orderBy('created_at', 'desc')

    return serialize.withoutWrapping(
      ofertas.map((o) => ({
        id: String(o.id),
        viajeId: String(o.viajeId),
        monto: o.monto,
        estado: o.estado,
        expiresAt: o.expiraAt ? o.expiraAt.toISO() : null,
        createdAt: o.createdAt.toISO(),
        viaje: {
          origen: {
            direccion: o.viaje.origenDireccion,
            lat: Number(o.viaje.origenLat),
            lng: Number(o.viaje.origenLng),
          },
          destino: {
            direccion: o.viaje.destinoDireccion,
            lat: Number(o.viaje.destinoLat),
            lng: Number(o.viaje.destinoLng),
          },
          estado: o.viaje.estado,
        },
      }))
    )
  }

  @ApiOperation({
    summary: 'Obtener estadísticas del conductor',
    description: 'Devuelve estadísticas del conductor como viajes, horas activas y calificación',
  })
  @ApiResponse({ type: 'object' })
  async stats({ auth, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const cacheKey = `driver:stats:${user.id}`
    const cached = await RedisService.cacheGet<any>(cacheKey)
    if (cached) return serialize.withoutWrapping(cached)

    const conductor = await Conductor.findByOrFail('usuario_id', user.id)
    const data = {
      viajes: conductor.totalViajes,
      horasActivo: conductor.horasActivo,
      calificacion: conductor.calificacion,
      totalReviews: 0,
    }

    await RedisService.cacheSet(cacheKey, data, 30)
    return serialize.withoutWrapping(data)
  }

  @ApiOperation({ summary: 'Subir foto del vehículo', description: 'Sube una foto del vehículo' })
  @ApiResponse({ type: 'object' })
  async vehiclePhoto({ auth, request, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const conductor = await Conductor.findByOrFail('usuario_id', user.id)

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
    const fileName = `vehicle-${user.id}-${randomUUID()}.${file.extname}`
    await file.move(StorageService.uploadsDir(), { name: fileName })

    conductor.fotoVehiculo = `/storage/uploads/${fileName}`
    await conductor.save()

    return serialize.withoutWrapping({ fotoVehiculo: conductor.fotoVehiculo })
  }

  @ApiOperation({
    summary: 'Actualizar ubicación del conductor',
    description: 'Actualiza la ubicación actual del conductor y la registra en ubicaciones_drivers',
  })
  @ApiBody({ type: () => driverLocationValidator })
  @ApiResponse({ type: 'object' })
  async location({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const data = await request.validateUsing(driverLocationValidator)

    const conductor = await Conductor.findByOrFail('usuario_id', user.id)

    // GPS rate limit (Redis-backed, with in-memory fallback)
    if (!(await GpsRateLimitService.checkAndMark(conductor.id))) {
      return response
        .status(429)
        .send({ error: 'Espera antes de actualizar ubicación' })
    }
    conductor.ultimaUbicacionLat = data.lat
    conductor.ultimaUbicacionLng = data.lng
    conductor.ubicacionActualizadaEn = DateTime.now()
    await conductor.save()

    // GPS fraud detection (non-blocking — logs only, no rejection)
    FraudDetectionService.analyzeLocation(conductor.id, data.lat, data.lng)

    await UbicacionDriver.create({
      conductorId: conductor.id,
      lat: data.lat,
      lng: data.lng,
    })

    // Se relaya la ubicación mientras el conductor está atendiendo el viaje
    // (mismo criterio que TripConflictService: asignado y aún no lo cierra),
    // no solo en 'aceptado'/'en_curso'. De lo contrario el cliente se queda
    // sin `driver:location` durante 'conductor_en_camino', 'conductor_llegada'
    // y 'sos'.
    const viajeActivo = await Viaje.query()
      .where('conductor_id', conductor.id)
      .whereIn('estado', ESTADOS_CONDUCTOR_OCUPADO)
      .orderByRaw(ORDEN_CONDUCTOR_OCUPADO_SQL)
      .first()

    if (viajeActivo) {
      const ultimaUbic = await UbicacionDriver.query()
        .where('conductor_id', conductor.id)
        .orderBy('created_at', 'desc')
        .offset(1)
        .first()
      if (ultimaUbic) {
        const segundosDesdeUltima = DateTime.now().diff(ultimaUbic.createdAt, 'seconds').seconds
        if (segundosDesdeUltima > 30) {
          emitToClient(viajeActivo.clienteId, 'trip:gps_frozen', {
            mensaje: 'El conductor no está enviando su ubicación',
          })
        }
      }

      emitToClient(viajeActivo.clienteId, 'driver:location', {
        lat: data.lat,
        lng: data.lng,
      })
      emitToAdmin('admin:driver:location', {
        id: String(conductor.id),
        _id: String(conductor.id),
        conductorId: String(conductor.id),
        usuarioId: String(user.id),
        lat: data.lat,
        lng: data.lng,
      })

      // Ruta y ETA calculados aquí para ambos (trip_route_service: Mapbox con
      // tráfico, cacheado por fase; la línea sólo viaja cuando cambia).
      const estadoRuta = await rutaDelViaje(viajeActivo, [data.lat, data.lng])
      if (estadoRuta) {
        const actualizadaEn = conductor.ubicacionActualizadaEn?.toISO() ?? null
        const eta = payloadRuta(viajeActivo.id, estadoRuta, false, actualizadaEn)
        emitToClient(viajeActivo.clienteId, 'trip:eta_update', eta)
        emitToDriver(user.id, 'trip:eta_update', eta)
        if (estadoRuta.recalculada) {
          const ruta = payloadRuta(viajeActivo.id, estadoRuta, true, actualizadaEn)
          emitToClient(viajeActivo.clienteId, 'trip:route_update', ruta)
          emitToDriver(user.id, 'trip:route_update', ruta)
        }

        // Push "llega en 5 min", una vez por viaje (hacia origen o destino).
        if (
          eta.minutos !== null &&
          eta.minutos !== undefined &&
          eta.minutos <= 5 &&
          !avisoEta5Enviado.has(viajeActivo.id)
        ) {
          avisoEta5Enviado.add(viajeActivo.id)
          const cliente = await import('#models/user').then((m) => m.default.find(viajeActivo.clienteId))
          if (cliente?.fcmToken) {
            const { sendToToken } = await import('#services/push_notification_service')
            const destino = eta.fase === 'destino' ? 'a tu destino' : 'al punto de recogida'
            await sendToToken(cliente.fcmToken, 'Tu conductor está cerca', `Llega ${destino} en unos 5 minutos`, {
              tipo: 'viaje_estado',
              viajeId: String(viajeActivo.id),
            }).catch(
              () => {}
            )
          }
        }
      }

      if (viajeActivo.estado === 'aceptado' || viajeActivo.estado === 'conductor_en_camino') {
        const distanciaKm =
          distanciaM([data.lat, data.lng], [Number(viajeActivo.origenLat), Number(viajeActivo.origenLng)]) / 1000

        if (distanciaKm < 0.5 && !avisoCercaEnviado.has(viajeActivo.id)) {
          avisoCercaEnviado.add(viajeActivo.id)
          emitToClient(viajeActivo.clienteId, 'trip:driver_nearby', {
            lat: data.lat,
            lng: data.lng,
          })
          const cliente = await import('#models/user').then((m) =>
            m.default.find(viajeActivo.clienteId)
          )
          if (cliente?.fcmToken) {
            const { sendToToken } = await import('#services/push_notification_service')
            await sendToToken(
              cliente.fcmToken,
              'Conductor cerca',
              'Tu conductor está llegando al punto de recogida',
              { tipo: 'viaje_estado', viajeId: String(viajeActivo.id) }
            )
          }
        }
      }
    }

    return serialize.withoutWrapping({
      lat: conductor.ultimaUbicacionLat,
      lng: conductor.ultimaUbicacionLng,
      updatedAt: DateTime.now().toISO(),
    })
  }

  @ApiOperation({
    summary: 'Obtener estadísticas del día',
    description: 'Devuelve las ganancias, viajes y kilómetros de hoy',
  })
  @ApiResponse({ type: 'object' })
  async todayStats({ auth, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const cacheKey = `driver:todayStats:${user.id}`
    const cached = await RedisService.cacheGet<any>(cacheKey)
    if (cached) return serialize.withoutWrapping(cached)

    const conductor = await Conductor.findByOrFail('usuario_id', user.id)

    const s = await resumenGanancias(conductor.id, inicioDe('day'))

    const data = {
      viajesHoy: Number(s.viajes || 0),
      horasOnline: conductor.horasActivo,
      gananciasHoy: Number(s.bruto || 0),
      comisionHoy: Number(s.comision || 0),
      netaHoy: Number(s.neto || 0),
      totalViajes: conductor.totalViajes,
      calificacion: conductor.calificacion,
    }

    await RedisService.cacheSet(cacheKey, data, 30)
    return serialize.withoutWrapping(data)
  }

  @ApiOperation({ summary: 'Subir foto del conductor', description: 'Sube una foto del conductor' })
  @ApiResponse({ type: 'object' })
  async driverPhoto({ auth, request, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const conductor = await Conductor.findByOrFail('usuario_id', user.id)

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
    const fileName = `driver-${user.id}-${randomUUID()}.${file.extname}`
    await file.move(StorageService.uploadsDir(), { name: fileName })

    conductor.fotoConductor = `/storage/uploads/${fileName}`
    await conductor.save()

    return serialize.withoutWrapping({ fotoConductor: conductor.fotoConductor })
  }

  async uploadCedula({ auth, request, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const conductor = await Conductor.findByOrFail('usuario_id', user.id)

    const file = request.file('file', {
      size: '5mb',
      extnames: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    })
    if (!file) return response.status(400).send({ error: 'No file uploaded' })

    if (!file.isValid) {
      return response.status(422).send({ error: file.errors[0]?.message || 'Archivo inválido' })
    }
    const fileName = `cedula-${user.id}-${randomUUID()}.${file.extname}`
    await file.move(StorageService.uploadsDir(), { name: fileName })

    conductor.fotoCedula = `/storage/uploads/${fileName}`
    await conductor.save()

    return serialize.withoutWrapping({ fotoCedula: SignedUploadService.sign(conductor.fotoCedula) })
  }

  async uploadLicencia({ auth, request, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const conductor = await Conductor.findByOrFail('usuario_id', user.id)

    const file = request.file('file', {
      size: '5mb',
      extnames: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    })
    if (!file) return response.status(400).send({ error: 'No file uploaded' })

    if (!file.isValid) {
      return response.status(422).send({ error: file.errors[0]?.message || 'Archivo inválido' })
    }
    const fileName = `licencia-${user.id}-${randomUUID()}.${file.extname}`
    await file.move(StorageService.uploadsDir(), { name: fileName })

    conductor.fotoLicencia = `/storage/uploads/${fileName}`
    await conductor.save()

    return serialize.withoutWrapping({ fotoLicencia: SignedUploadService.sign(conductor.fotoLicencia) })
  }

  async uploadVehiculo({ auth, request, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const conductor = await Conductor.findByOrFail('usuario_id', user.id)

    const file = request.file('file', {
      size: '5mb',
      extnames: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    })
    if (!file) return response.status(400).send({ error: 'No file uploaded' })

    if (!file.isValid) {
      return response.status(422).send({ error: file.errors[0]?.message || 'Archivo inválido' })
    }
    const fileName = `verif-vehiculo-${user.id}-${randomUUID()}.${file.extname}`
    await file.move(StorageService.uploadsDir(), { name: fileName })

    conductor.fotoVehiculo = `/storage/uploads/${fileName}`
    await conductor.save()

    return serialize.withoutWrapping({ fotoVehiculo: conductor.fotoVehiculo })
  }

  /**
   * Documentos nuevos de verificación (cédula reverso, tarjeta de propiedad,
   * tecnomecánica y SOAT). Los dos últimos llevan `vence` (YYYY-MM-DD) como
   * campo del multipart y se rechazan si ya vencieron.
   */
  async uploadDocumento({ auth, params, request, serialize, response }: HttpContext) {
    const docs: Record<string, { foto: 'fotoCedulaReverso' | 'fotoTarjetaPropiedad' | 'fotoTecnomecanica' | 'fotoSoat'; vence?: 'tecnomecanicaVence' | 'soatVence' }> = {
      'cedula-reverso': { foto: 'fotoCedulaReverso' },
      'tarjeta-propiedad': { foto: 'fotoTarjetaPropiedad' },
      'tecnomecanica': { foto: 'fotoTecnomecanica', vence: 'tecnomecanicaVence' },
      'soat': { foto: 'fotoSoat', vence: 'soatVence' },
    }
    const doc = docs[params.tipo]
    if (!doc) return response.status(404).send({ error: 'Documento no reconocido' })

    const user = auth.getUserOrFail()
    const conductor = await Conductor.findByOrFail('usuario_id', user.id)

    const file = request.file('file', {
      size: '5mb',
      extnames: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    })
    if (!file) return response.status(400).send({ error: 'No file uploaded' })
    if (!file.isValid) {
      return response.status(422).send({ error: file.errors[0]?.message || 'Archivo inválido' })
    }

    let vence: string | null = null
    if (doc.vence) {
      vence = String(request.input('vence', '')).slice(0, 10)
      const fecha = DateTime.fromISO(vence)
      if (!fecha.isValid) {
        return response.status(422).send({ error: 'Falta la fecha de vencimiento (YYYY-MM-DD)' })
      }
      if (fecha.toISODate()! < DateTime.now().toISODate()!) {
        return response.status(422).send({ error: 'El documento ya está vencido' })
      }
    }

    const fileName = `${params.tipo}-${user.id}-${randomUUID()}.${file.extname}`
    await file.move(StorageService.uploadsDir(), { name: fileName })

    conductor[doc.foto] = `/storage/uploads/${fileName}`
    if (doc.vence) conductor[doc.vence] = vence
    await conductor.save()

    return serialize.withoutWrapping({
      [doc.foto]: SignedUploadService.sign(conductor[doc.foto]),
      ...(doc.vence ? { [doc.vence]: conductor[doc.vence] } : {}),
    })
  }

  /** "¿No tienes SOAT?": pide que CargaExpress valore el vehículo. Queda pendiente para el admin. */
  async solicitarExcepcionSoat({ auth, request, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const conductor = await Conductor.findByOrFail('usuario_id', user.id)
    if (conductor.excepcionSoatEstado === 'aprobada') {
      return response.status(409).send({ error: 'Ya tienes una excepción de SOAT aprobada' })
    }
    const comentario = String(request.input('comentario', '') ?? '').trim().slice(0, 500)
    conductor.excepcionSoatEstado = 'pendiente'
    conductor.excepcionSoatNota = comentario || null
    await conductor.save()

    try {
      emitToAdmin('admin:excepcion_soat', { conductorId: conductor.id, usuarioId: user.id })
    } catch {
      // socket no disponible
    }

    return serialize.withoutWrapping({
      excepcionSoatEstado: conductor.excepcionSoatEstado,
      excepcionSoatNota: conductor.excepcionSoatNota,
    })
  }

  async earningsHistory({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const conductor = await Conductor.findByOrFail('usuario_id', user.id)

    const periodo = request.input('periodo', 'todo')
    const page = Math.max(1, Number.parseInt(request.input('page', '1')) || 1)
    const limit = Math.min(100, Math.max(1, Number.parseInt(request.input('limit', '20')) || 20))

    let query = Ganancia.query().where('conductor_id', conductor.id)

    const now = DateTime.now()
    if (periodo === 'semana') {
      query = query.where('created_at', '>=', now.startOf('week').toSQL())
    } else if (periodo === 'mes') {
      query = query.where('created_at', '>=', now.startOf('month').toSQL())
    }

    const result = await query
      .preload('viaje', (q) => q.select('id', 'origen_direccion', 'destino_direccion'))
      .orderBy('created_at', 'desc')
      .paginate(page, limit)

    const data = result.all().map((g) => ({
      id: g.id,
      viajeId: g.viajeId,
      viaje: g.viaje
        ? { origen: g.viaje.origenDireccion, destino: g.viaje.destinoDireccion }
        : null,
      montoBruto: g.montoBruto,
      comision: g.comision,
      montoNeto: g.montoNeto,
      comisionPagada: g.comisionPagada,
      createdAt: g.createdAt.toISO(),
    }))

    return serialize.withoutWrapping({
      data,
      total: result.total,
      page: result.currentPage,
      limit: result.perPage,
    })
  }

  async earningsPDF({ auth, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const conductor = await Conductor.findByOrFail('usuario_id', user.id)

    const periodo = request.input('periodo', 'todo')
    const now = DateTime.now()
    let titulo = 'Historial completo'
    let query = Ganancia.query().where('conductor_id', conductor.id)

    if (periodo === 'semana') {
      query = query.where('created_at', '>=', now.startOf('week').toSQL())
      titulo = 'Última semana'
    } else if (periodo === 'mes') {
      query = query.where('created_at', '>=', now.startOf('month').toSQL())
      titulo = 'Último mes'
    }

    const ganancias = await query.orderBy('created_at', 'desc')
    const totalBruto = ganancias.reduce((s, g) => s + Number(g.montoBruto || 0), 0)
    const totalComision = ganancias.reduce((s, g) => s + Number(g.comision || 0), 0)
    const totalNeto = ganancias.reduce((s, g) => s + Number(g.montoNeto || 0), 0)

    const doc = new PDFDocument({ margin: 50 })

    doc.fontSize(18).text('CargaExpress', { align: 'center' })
    doc.fontSize(14).text(`Reporte de Ganancias - ${titulo}`, { align: 'center' })
    doc.moveDown()
    doc.fontSize(12).text(`Conductor: ${user.nombre} ${user.apellido}`)
    doc.text(`Cédula: ${conductor.cedula}`)
    doc.text(`Placa: ${conductor.placa}`)
    doc.moveDown()
    doc.fontSize(10).text(`Generado: ${now.toFormat('dd/MM/yyyy HH:mm')}`)
    doc.moveDown()

    if (ganancias.length === 0) {
      doc.text('No hay ganancias registradas en este período.')
    } else {
      const tableTop = doc.y
      doc.fontSize(10).font('Helvetica-Bold')
      doc.text('ID', 50, tableTop, { width: 40 })
      doc.text('Fecha', 90, tableTop, { width: 100 })
      doc.text('Bruto', 200, tableTop, { width: 80, align: 'right' })
      doc.text('Comisión', 280, tableTop, { width: 80, align: 'right' })
      doc.text('Neto', 370, tableTop, { width: 80, align: 'right' })
      doc.moveDown()

      doc.font('Helvetica')
      let y = doc.y
      for (const g of ganancias) {
        doc.text(String(g.id), 50, y, { width: 40 })
        doc.text(g.createdAt.toFormat('dd/MM/yy'), 90, y, { width: 100 })
        doc.text(`$${Number(g.montoBruto || 0).toFixed(2)}`, 200, y, { width: 80, align: 'right' })
        doc.text(`$${Number(g.comision || 0).toFixed(2)}`, 280, y, { width: 80, align: 'right' })
        doc.text(`$${Number(g.montoNeto || 0).toFixed(2)}`, 370, y, { width: 80, align: 'right' })
        y += 18
        if (y > 700) {
          doc.addPage()
          y = 50
        }
      }

      doc.moveDown(2)
      doc.font('Helvetica-Bold')
      doc.text(`Total Bruto: $${totalBruto.toFixed(2)}`, { align: 'right' })
      doc.text(`Total Comisión: $${totalComision.toFixed(2)}`, { align: 'right' })
      doc.text(`Total Neto: $${totalNeto.toFixed(2)}`, { align: 'right' })
    }

    doc.end()

    response.type('application/pdf')
    response.header('Content-Disposition', 'attachment; filename=ganancias.pdf')
    return response.stream(doc)
  }

  /**
   * GET /api/drivers/grupo: zona del conductor, su líder, avisos y comunicados
   * aprobados de la zona. Las zonas se comparan normalizadas (claveDe); los
   * avisos incluyen los 'general' (los que publican los propios conductores).
   */
  async grupo({ auth, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (user.rol !== 'conductor') {
      return response.status(403).send({ error: 'Solo para conductores' })
    }
    const esLider = Boolean(user.esLider)
    const conductor = await Conductor.query().where('usuario_id', user.id).select('id', 'ciudad').first()
    const clave = conductor?.ciudad ? claveDe(conductor.ciudad) : ''
    if (!clave) {
      return serialize.withoutWrapping({ zona: null, esLider, lider: null, avisos: [], comunicados: [] })
    }

    const lideres = await Conductor.query()
      .whereNotNull('ciudad')
      .whereHas('usuario', (q) => q.where('es_lider', true))
      .preload('usuario', (q) => q.select('id', 'nombre', 'apellido', 'telefono'))
    const lider = lideres.find((c) => claveDe(c.ciudad || '') === clave)?.usuario

    const avisos = await Aviso.query()
      .where('eliminado', false)
      .whereIn('zona', [clave, 'general'])
      .preload('autor', (q) => q.select('id', 'nombre', 'apellido', 'rol'))
      .orderBy('fijado', 'desc')
      .orderBy('created_at', 'desc')
      .limit(50)

    const comentarios = avisos.length
      ? await AvisoComentario.query()
          .whereIn('aviso_id', avisos.map((a) => a.id))
          .preload('autor', (q) => q.select('id', 'nombre', 'apellido'))
          .orderBy('created_at', 'asc')
      : []
    const comentariosDe = new Map<number, any[]>()
    for (const c of comentarios) {
      const lista = comentariosDe.get(c.avisoId) ?? []
      lista.push({
        id: c.id,
        contenido: c.contenido,
        createdAt: c.createdAt.toISO(),
        autor: { nombre: c.autor.nombre, apellido: c.autor.apellido },
        propio: c.autorId === user.id,
        puedeBorrar: c.autorId === user.id || esLider,
      })
      comentariosDe.set(c.avisoId, lista)
    }

    const comunicados = await Comunicado.query()
      .where('estado', 'aprobado')
      .where('zona', clave)
      .orderBy('created_at', 'desc')
      .limit(20)

    return serialize.withoutWrapping({
      zona: conductor!.ciudad,
      esLider,
      lider: lider
        ? { id: lider.id, nombre: `${lider.nombre} ${lider.apellido}`.trim(), telefono: lider.telefono }
        : null,
      avisos: avisos.map((a) => ({
        id: a.id,
        contenido: a.contenido,
        fijado: Boolean(a.fijado),
        createdAt: a.createdAt.toISO(),
        autor: { nombre: a.autor.nombre, apellido: a.autor.apellido, rol: a.autor.rol },
        comentarios: comentariosDe.get(a.id) ?? [],
      })),
      comunicados: comunicados.map((c) => ({
        id: c.id,
        titulo: c.titulo,
        contenido: c.contenido,
        createdAt: c.createdAt.toISO(),
      })),
    })
  }

  /** POST /api/drivers/grupo/avisos/:id/comentarios {contenido}: comentar un anuncio de mi zona. */
  async comentarAviso({ auth, params, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const zona = await zonaDeConductor(user.id, user.rol)
    if (!zona) return response.status(403).send({ error: 'Solo para conductores con zona' })
    const contenido = String(request.input('contenido') ?? '').trim()
    if (!contenido || contenido.length > 500) {
      return response.status(422).send({ error: 'El comentario debe tener entre 1 y 500 caracteres' })
    }
    const aviso = await Aviso.query().where('id', params.id).where('eliminado', false).first()
    if (!aviso || ![zona, 'general'].includes(aviso.zona)) {
      return response.status(404).send({ error: 'Anuncio no encontrado' })
    }
    const c = await AvisoComentario.create({ avisoId: aviso.id, autorId: user.id, contenido })
    return response.status(201).send({ id: c.id, contenido: c.contenido, createdAt: c.createdAt.toISO() })
  }

  /** DELETE /api/drivers/grupo/comentarios/:id: lo borra su autor o el líder de la zona. */
  async borrarComentario({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const zona = await zonaDeConductor(user.id, user.rol)
    const c = await AvisoComentario.find(params.id)
    const aviso = c ? await Aviso.find(c.avisoId) : null
    if (!c || !aviso || !zona || ![zona, 'general'].includes(aviso.zona)) {
      return response.status(404).send({ error: 'Comentario no encontrado' })
    }
    if (c.autorId !== user.id && !user.esLider) {
      return response.status(403).send({ error: 'Solo el autor o el líder pueden borrarlo' })
    }
    await c.delete()
    return { message: 'Comentario eliminado' }
  }
}

/** Zona normalizada (claveDe) del conductor, o null si no es conductor o no tiene ciudad. */
async function zonaDeConductor(userId: number, rol: string | null):Promise<string | null> {
  if (rol !== 'conductor') return null
  const conductor = await Conductor.query().where('usuario_id', userId).select('ciudad').first()
  return conductor?.ciudad ? claveDe(conductor.ciudad) : null
}
