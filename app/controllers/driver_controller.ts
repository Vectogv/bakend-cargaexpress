import Conductor from '#models/conductor'
import Ganancia from '#models/ganancia'
import UbicacionDriver from '#models/ubicacion_driver'
import Viaje from '#models/viaje'
import PDFDocument from 'pdfkit'
import { driverStatusValidator, driverLocationValidator } from '#validators/driver'
import type { HttpContext } from '@adonisjs/core/http'
import app from '@adonisjs/core/services/app'
import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import { ApiOperation, ApiBody, ApiResponse } from '@foadonis/openapi/decorators'
import { emitToClient } from '#start/socket'
import GpsRateLimitService from '#services/gps_rate_limit_service'
import FraudDetectionService from '#services/fraud_detection_service'

export default class DriverController {
  @ApiOperation({
    summary: 'Update driver status',
    description: 'Sets the driver online/offline status',
  })
  @ApiBody({ type: () => driverStatusValidator })
  @ApiResponse({ type: 'object' })
  async status({ auth, request, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const data = await request.validateUsing(driverStatusValidator)

    const conductor = await Conductor.findBy('usuario_id', user.id)
    if (!conductor) {
      return serialize.withoutWrapping({ error: 'Conductor profile not found' })
    }

    if (data.online && conductor.estadoVerificacion !== 'aprobado') {
      return response.status(403).send({ error: 'Debes estar verificado para ponerte online' })
    }

    conductor.online = data.online
    await conductor.save()

    return serialize.withoutWrapping({
      online: conductor.online,
      updatedAt: DateTime.now().toISO(),
    })
  }

  @ApiOperation({
    summary: 'Get driver earnings',
    description: 'Returns driver earnings for today, week, month, and total',
  })
  @ApiResponse({ type: 'object' })
  async earnings({ auth, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const conductor = await Conductor.findByOrFail('usuario_id', user.id)

    const now = DateTime.now()
    const startOfDay = now.startOf('day').toSQL()
    const startOfWeek = now.startOf('week').toSQL()
    const startOfMonth = now.startOf('month').toSQL()

    async function periodStats(since: string) {
      const rows = await Ganancia.query()
        .where('conductor_id', conductor.id)
        .where('created_at', '>=', since)
        .select(
          Ganancia.query().count('*').as('viajes'),
          Ganancia.query().sum('monto_bruto').as('bruto'),
          Ganancia.query().sum('comision').as('comision'),
          Ganancia.query().sum('monto_neto').as('neto'),
          Ganancia.query().where('comision_pagada', false).sum('comision').as('pendiente')
        )
        .first()
      return rows?.$extras || {}
    }

    const [hoy, semana, mes] = await Promise.all([
      periodStats(startOfDay),
      periodStats(startOfWeek),
      periodStats(startOfMonth),
    ])

    const totales = await Ganancia.query()
      .where('conductor_id', conductor.id)
      .select(
        Ganancia.query().count('*').as('viajes'),
        Ganancia.query().sum('monto_bruto').as('bruto'),
        Ganancia.query().sum('comision').as('comision'),
        Ganancia.query().sum('monto_neto').as('neto'),
        Ganancia.query().where('comision_pagada', false).sum('comision').as('pendiente')
      )
      .first()

    const total = totales?.$extras || {}

    function mapPeriod(p: Record<string, any>) {
      return {
        viajesCompletados: Number(p.viajes || 0),
        montoBruto: Number(p.bruto || 0),
        comision: Number(p.comision || 0),
        montoNeto: Number(p.neto || 0),
        comisionPendiente: Number(p.pendiente || 0),
      }
    }

    return serialize.withoutWrapping({
      hoy: mapPeriod(hoy),
      semana: mapPeriod(semana),
      mes: mapPeriod(mes),
      total: mapPeriod(total),
    })
  }

  @ApiOperation({
    summary: 'Get driver stats',
    description: 'Returns driver statistics like trips, active hours, rating',
  })
  @ApiResponse({ type: 'object' })
  async stats({ auth, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const conductor = await Conductor.findByOrFail('usuario_id', user.id)

    return serialize.withoutWrapping({
      viajes: conductor.totalViajes,
      horasActivo: conductor.horasActivo,
      calificacion: conductor.calificacion,
      totalReviews: 0,
    })
  }

  @ApiOperation({ summary: 'Upload vehicle photo', description: 'Uploads a photo of the vehicle' })
  @ApiResponse({ type: 'object' })
  async vehiclePhoto({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const conductor = await Conductor.findByOrFail('usuario_id', user.id)

    const file = request.file('file', {
      size: '5mb',
      extnames: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    })

    if (!file) {
      return serialize.withoutWrapping({ error: 'No file uploaded' })
    }

    const fileName = `vehicle-${user.id}-${randomUUID()}.${file.extname}`
    await file.move(app.makePath('storage', 'uploads'), { name: fileName })

    conductor.fotoVehiculo = `/storage/uploads/${fileName}`
    await conductor.save()

    return serialize.withoutWrapping({ fotoVehiculo: conductor.fotoVehiculo })
  }

  @ApiOperation({
    summary: 'Update driver location',
    description: 'Updates the driver current location and logs to ubicaciones_drivers',
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
    await conductor.save()

    // GPS fraud detection (non-blocking — logs only, no rejection)
    FraudDetectionService.analyzeLocation(conductor.id, data.lat, data.lng)

    await UbicacionDriver.create({
      conductorId: conductor.id,
      lat: data.lat,
      lng: data.lng,
    })

    const viajeActivo = await Viaje.query()
      .where('conductor_id', conductor.id)
      .whereIn('estado', ['aceptado', 'en_curso'])
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

      if (viajeActivo.estado === 'aceptado') {
        const R = 6371
        const destLat = viajeActivo.origenLat
        const destLng = viajeActivo.origenLng
        const dLat = ((destLat - data.lat) * Math.PI) / 180
        const dLng = ((destLng - data.lng) * Math.PI) / 180
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos((data.lat * Math.PI) / 180) *
            Math.cos((destLat * Math.PI) / 180) *
            Math.sin(dLng / 2) ** 2
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        const distanciaKm = R * c
        const minutos = Math.ceil((distanciaKm / 30) * 60)

        emitToClient(viajeActivo.clienteId, 'trip:eta_update', { minutos })

        if (distanciaKm < 0.5) {
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
              'Tu conductor está llegando al punto de recogida'
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
    summary: 'Get driver today stats',
    description: 'Returns earnings, trips, and km for today',
  })
  @ApiResponse({ type: 'object' })
  async todayStats({ auth, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const conductor = await Conductor.findByOrFail('usuario_id', user.id)

    const now = DateTime.now()
    const startOfDay = now.startOf('day').toSQL()

    const stats = await Ganancia.query()
      .where('conductor_id', conductor.id)
      .where('created_at', '>=', startOfDay)
      .select(
        Ganancia.query().count('*').as('viajes'),
        Ganancia.query().sum('monto_bruto').as('bruto'),
        Ganancia.query().sum('comision').as('comision'),
        Ganancia.query().sum('monto_neto').as('neto')
      )
      .first()

    const s = stats?.$extras || {}

    return serialize.withoutWrapping({
      viajesHoy: Number(s.viajes || 0),
      horasOnline: conductor.horasActivo,
      gananciasHoy: Number(s.bruto || 0),
      comisionHoy: Number(s.comision || 0),
      netaHoy: Number(s.neto || 0),
      totalViajes: conductor.totalViajes,
      calificacion: conductor.calificacion,
    })
  }

  @ApiOperation({ summary: 'Upload driver photo', description: 'Uploads a photo of the driver' })
  @ApiResponse({ type: 'object' })
  async driverPhoto({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const conductor = await Conductor.findByOrFail('usuario_id', user.id)

    const file = request.file('file', {
      size: '5mb',
      extnames: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    })

    if (!file) {
      return serialize.withoutWrapping({ error: 'No file uploaded' })
    }

    const fileName = `driver-${user.id}-${randomUUID()}.${file.extname}`
    await file.move(app.makePath('storage', 'uploads'), { name: fileName })

    conductor.fotoConductor = `/storage/uploads/${fileName}`
    await conductor.save()

    return serialize.withoutWrapping({ fotoConductor: conductor.fotoConductor })
  }

  async uploadCedula({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const conductor = await Conductor.findByOrFail('usuario_id', user.id)

    const file = request.file('file', {
      size: '5mb',
      extnames: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    })
    if (!file) return serialize.withoutWrapping({ error: 'No file uploaded' })

    const fileName = `cedula-${user.id}-${randomUUID()}.${file.extname}`
    await file.move(app.makePath('storage', 'uploads'), { name: fileName })

    conductor.fotoCedula = `/storage/uploads/${fileName}`
    await conductor.save()

    return serialize.withoutWrapping({ fotoCedula: conductor.fotoCedula })
  }

  async uploadLicencia({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const conductor = await Conductor.findByOrFail('usuario_id', user.id)

    const file = request.file('file', {
      size: '5mb',
      extnames: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    })
    if (!file) return serialize.withoutWrapping({ error: 'No file uploaded' })

    const fileName = `licencia-${user.id}-${randomUUID()}.${file.extname}`
    await file.move(app.makePath('storage', 'uploads'), { name: fileName })

    conductor.fotoLicencia = `/storage/uploads/${fileName}`
    await conductor.save()

    return serialize.withoutWrapping({ fotoLicencia: conductor.fotoLicencia })
  }

  async uploadVehiculo({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const conductor = await Conductor.findByOrFail('usuario_id', user.id)

    const file = request.file('file', {
      size: '5mb',
      extnames: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    })
    if (!file) return serialize.withoutWrapping({ error: 'No file uploaded' })

    const fileName = `verif-vehiculo-${user.id}-${randomUUID()}.${file.extname}`
    await file.move(app.makePath('storage', 'uploads'), { name: fileName })

    conductor.fotoVehiculo = `/storage/uploads/${fileName}`
    await conductor.save()

    return serialize.withoutWrapping({ fotoVehiculo: conductor.fotoVehiculo })
  }

  async earningsHistory({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const conductor = await Conductor.findByOrFail('usuario_id', user.id)

    const periodo = request.input('periodo', 'todo')
    const page = Number.parseInt(request.input('page', '1'))
    const limit = Number.parseInt(request.input('limit', '20'))

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

    const doc = new PDFDocument({ margin: 50 })

    response.response.setHeader('Content-Type', 'application/pdf')
    response.response.setHeader('Content-Disposition', 'attachment; filename=ganancias.pdf')
    doc.pipe(response.response)

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
  }
}
