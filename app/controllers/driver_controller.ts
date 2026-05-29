import Conductor from '#models/conductor'
import Ganancia from '#models/ganancia'
import UbicacionDriver from '#models/ubicacion_driver'
import Viaje from '#models/viaje'
import { driverStatusValidator, driverLocationValidator } from '#validators/driver'
import type { HttpContext } from '@adonisjs/core/http'
import app from '@adonisjs/core/services/app'
import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import { ApiOperation, ApiBody, ApiResponse } from '@foadonis/openapi/decorators'

export default class DriverController {
  @ApiOperation({ summary: 'Update driver status', description: 'Sets the driver online/offline status' })
  @ApiBody({ type: () => driverStatusValidator })
  @ApiResponse({ type: 'object' })
  async status({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const data = await request.validateUsing(driverStatusValidator)

    const conductor = await Conductor.findBy('usuario_id', user.id)
    if (!conductor) {
      return serialize.withoutWrapping({ error: 'Conductor profile not found' })
    }

    conductor.online = data.online
    await conductor.save()

    return serialize.withoutWrapping({
      online: conductor.online,
      updatedAt: DateTime.now().toISO(),
    })
  }

  @ApiOperation({ summary: 'Get driver earnings', description: 'Returns driver earnings for today, week, month, and total' })
  @ApiResponse({ type: 'object' })
  async earnings({ auth, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const conductor = await Conductor.findByOrFail('usuario_id', user.id)

    const now = DateTime.now()
    const startOfDay = now.startOf('day').toSQL()
    const startOfWeek = now.startOf('week').toSQL()
    const startOfMonth = now.startOf('month').toSQL()

    const [hoy, semana, mes, total] = await Promise.all([
      Ganancia.query()
        .where('conductor_id', conductor.id)
        .where('created_at', '>=', startOfDay)
        .sum('monto as total')
        .first(),
      Ganancia.query()
        .where('conductor_id', conductor.id)
        .where('created_at', '>=', startOfWeek)
        .sum('monto as total')
        .first(),
      Ganancia.query()
        .where('conductor_id', conductor.id)
        .where('created_at', '>=', startOfMonth)
        .sum('monto as total')
        .first(),
      Ganancia.query().where('conductor_id', conductor.id).sum('monto as total').first(),
    ])

    return serialize.withoutWrapping({
      hoy: Number(hoy?.$extras?.total || 0),
      semana: Number(semana?.$extras?.total || 0),
      mes: Number(mes?.$extras?.total || 0),
      total: Number(total?.$extras?.total || 0),
    })
  }

  @ApiOperation({ summary: 'Get driver stats', description: 'Returns driver statistics like trips, active hours, rating' })
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

  @ApiOperation({ summary: 'Update driver location', description: 'Updates the driver current location and logs to ubicaciones_drivers' })
  @ApiBody({ type: () => driverLocationValidator })
  @ApiResponse({ type: 'object' })
  async location({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const data = await request.validateUsing(driverLocationValidator)

    const conductor = await Conductor.findByOrFail('usuario_id', user.id)
    conductor.ultimaUbicacionLat = data.lat
    conductor.ultimaUbicacionLng = data.lng
    await conductor.save()

    await UbicacionDriver.create({
      conductorId: conductor.id,
      lat: data.lat,
      lng: data.lng,
    })

    return serialize.withoutWrapping({
      lat: conductor.ultimaUbicacionLat,
      lng: conductor.ultimaUbicacionLng,
      updatedAt: DateTime.now().toISO(),
    })
  }

  @ApiOperation({ summary: 'Get driver today stats', description: 'Returns earnings, trips, and km for today' })
  @ApiResponse({ type: 'object' })
  async todayStats({ auth, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const conductor = await Conductor.findByOrFail('usuario_id', user.id)

    const now = DateTime.now()
    const startOfDay = now.startOf('day').toSQL()

    const [gananciasHoy, viajesHoy] = await Promise.all([
      Ganancia.query()
        .where('conductor_id', conductor.id)
        .where('created_at', '>=', startOfDay)
        .sum('monto as total')
        .first(),
      Viaje.query()
        .where('conductor_id', conductor.id)
        .whereIn('estado', ['finalizado', 'completado'])
        .where('created_at', '>=', startOfDay)
        .count('* as total')
        .first(),
    ])

    return serialize.withoutWrapping({
      gananciasHoy: Number(gananciasHoy?.$extras?.total || 0),
      viajesHoy: Number(viajesHoy?.$extras?.total || 0),
      totalViajes: conductor.totalViajes,
      horasActivo: conductor.horasActivo,
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
}
