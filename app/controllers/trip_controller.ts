import Viaje from '#models/viaje'
import Conductor from '#models/conductor'
import Ganancia from '#models/ganancia'
import { tripRequestValidator, tripCompleteValidator, tripCancelValidator } from '#validators/trip'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import { ApiOperation, ApiBody, ApiResponse } from '@foadonis/openapi/decorators'

export default class TripController {
  @ApiOperation({ summary: 'Request a trip', description: 'Creates a new trip request' })
  @ApiBody({ type: () => tripRequestValidator })
  @ApiResponse({ type: 'object' })
  async request({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const data = await request.validateUsing(tripRequestValidator)

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
      precioEstimado: 35.0,
    })

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

  @ApiOperation({ summary: 'Get nearby trips', description: 'Returns trips near a given location within a radius' })
  @ApiResponse({ type: 'array' })
  async nearby({ request, serialize }: HttpContext) {
    const lat = Number.parseFloat(request.input('lat', '0'))
    const lng = Number.parseFloat(request.input('lng', '0'))
    const radio = Number.parseFloat(request.input('radio', '5'))

    const viajes = await Viaje.query()
      .where('estado', 'buscando_conductor')
      .preload('cliente')
      .orderBy('createdAt', 'desc')

    const result = viajes
      .map((v) => {
        const dlat = v.origenLat - lat
        const dlng = v.origenLng - lng
        const distancia = Math.round(Math.sqrt(dlat * dlat + dlng * dlng) * 111.32 * 100) / 100

        return {
          id: String(v.id),
          cliente: {
            nombre: `${v.cliente.nombre || ''} ${v.cliente.apellido || ''}`.trim(),
            calificacion: 4.8,
          },
          origen: { direccion: v.origenDireccion, lat: v.origenLat, lng: v.origenLng },
          destino: { direccion: v.destinoDireccion, lat: v.destinoLat, lng: v.destinoLng },
          carga: v.carga,
          precioEstimado: v.precioEstimado,
          distancia,
          createdAt: v.createdAt.toISO(),
        }
      })
      .filter((v) => v.distancia <= radio)

    return serialize.withoutWrapping(result)
  }

  @ApiOperation({ summary: 'Get active trip', description: 'Returns the currently active trip for the authenticated user' })
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
        .whereIn('estado', ['aceptado', 'en_curso'])
        .preload('cliente')
        .preload('conductor', (q) => q.preload('usuario'))
        .first()
    }

    if (!viaje) {
      return response.status(404).send({ error: 'No active trip' })
    }

    return serialize.withoutWrapping(this.formatViajeResponse(viaje))
  }

  @ApiOperation({ summary: 'Accept a trip', description: 'Driver accepts a pending trip' })
  @ApiResponse({ type: 'object' })
  async accept({ params, serialize, auth }: HttpContext) {
    const viaje = await Viaje.findOrFail(params.id)
    const user = auth.getUserOrFail()
    const conductor = await Conductor.findByOrFail('usuario_id', user.id)
    viaje.conductorId = conductor.id
    viaje.estado = 'aceptado'
    viaje.aceptadoAt = DateTime.now()
    await viaje.save()

    return serialize.withoutWrapping({
      id: String(viaje.id),
      estado: viaje.estado,
      aceptadoAt: viaje.aceptadoAt.toISO(),
    })
  }

  @ApiOperation({ summary: 'Start trip (pickup)', description: 'Changes trip to en_curso after driver picks up cargo' })
  @ApiResponse({ type: 'object' })
  async startTrip({ params, serialize }: HttpContext) {
    const viaje = await Viaje.findOrFail(params.id)
    viaje.estado = 'en_curso'
    viaje.enCursoAt = DateTime.now()
    await viaje.save()

    return serialize.withoutWrapping({
      id: String(viaje.id),
      estado: viaje.estado,
      enCursoAt: viaje.enCursoAt.toISO(),
    })
  }

  @ApiOperation({ summary: 'Decline a trip', description: 'Driver declines a pending trip' })
  @ApiResponse({ type: 'object' })
  async decline({ params, serialize }: HttpContext) {
    const viaje = await Viaje.findOrFail(params.id)
    viaje.estado = 'rechazado'
    await viaje.save()

    return serialize.withoutWrapping({ id: String(viaje.id), estado: viaje.estado })
  }

  @ApiOperation({ summary: 'Complete a trip', description: 'Marks a trip as completed and records earnings' })
  @ApiBody({ type: () => tripCompleteValidator })
  @ApiResponse({ type: 'object' })
  async complete({ params, request, serialize }: HttpContext) {
    const data = await request.validateUsing(tripCompleteValidator)
    const viaje = await Viaje.findOrFail(params.id)
    viaje.estado = 'completado'
    viaje.precioFinal = data.montoFinal
    viaje.completadoAt = DateTime.now()
    await viaje.save()

    if (viaje.conductorId) {
      await Ganancia.create({
        conductorId: viaje.conductorId,
        viajeId: viaje.id,
        monto: data.montoFinal,
      })

      const conductor = await Conductor.find(viaje.conductorId)
      if (conductor) {
        conductor.totalViajes += 1
        await conductor.save()
      }
    }

    return serialize.withoutWrapping({
      id: String(viaje.id),
      estado: viaje.estado,
      montoFinal: viaje.precioFinal,
      completadoAt: viaje.completadoAt.toISO(),
    })
  }

  @ApiOperation({ summary: 'Finalize delivery', description: 'Confirms delivery, sets driver online, records payment' })
  @ApiBody({ type: () => tripCompleteValidator })
  @ApiResponse({ type: 'object' })
  async finalize({ params, request, serialize }: HttpContext) {
    const data = await request.validateUsing(tripCompleteValidator)
    const viaje = await Viaje.findOrFail(params.id)
    viaje.estado = 'finalizado'
    viaje.precioFinal = data.montoFinal
    viaje.finalizadoAt = DateTime.now()
    await viaje.save()

    if (viaje.conductorId) {
      await Ganancia.create({
        conductorId: viaje.conductorId,
        viajeId: viaje.id,
        monto: data.montoFinal,
      })

      const conductor = await Conductor.find(viaje.conductorId)
      if (conductor) {
        conductor.totalViajes += 1
        conductor.online = true
        await conductor.save()
      }
    }

    return serialize.withoutWrapping({
      id: String(viaje.id),
      estado: viaje.estado,
      montoFinal: viaje.precioFinal,
      finalizadoAt: viaje.finalizadoAt.toISO(),
    })
  }

  @ApiOperation({ summary: 'Cancel a trip', description: 'Cancels a trip with an optional reason' })
  @ApiBody({ type: () => tripCancelValidator })
  @ApiResponse({ type: 'object' })
  async cancel({ params, request, serialize }: HttpContext) {
    const data = await request.validateUsing(tripCancelValidator)
    const viaje = await Viaje.findOrFail(params.id)
    viaje.estado = 'cancelado'
    viaje.motivoCancelacion = data.motivo || null
    viaje.canceladoAt = DateTime.now()
    await viaje.save()

    return serialize.withoutWrapping({
      id: String(viaje.id),
      estado: viaje.estado,
      canceladoAt: viaje.canceladoAt.toISO(),
    })
  }

  @ApiOperation({ summary: 'Get trip history', description: 'Returns paginated trip history for the authenticated user' })
  @ApiResponse({ type: 'array' })
  async history({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const page = Number.parseInt(request.input('page', '1'))
    const limit = Number.parseInt(request.input('limit', '20'))
    let query
    if (user.rol === 'conductor') {
      const conductor = await Conductor.findByOrFail('usuario_id', user.id)
      query = Viaje.query().where('conductor_id', conductor.id).preload('cliente').preload('conductor', (q) => q.preload('usuario')).orderBy('createdAt', 'desc')
    } else {
      query = Viaje.query().where('cliente_id', user.id).preload('cliente').preload('conductor', (q) => q.preload('usuario')).orderBy('createdAt', 'desc')
    }
    const result = await query.paginate(page, limit)
    const data = result.all().map((v) => this.formatViajeResponse(v))
    return serialize.withoutWrapping({ data, total: result.total, page: result.currentPage, limit: result.perPage })
  }

  @ApiOperation({ summary: 'Get trip details', description: 'Returns details of a specific trip by ID' })
  @ApiResponse({ type: 'object' })
  async show({ params, serialize }: HttpContext) {
    const viaje = await Viaje.query()
      .where('id', params.id)
      .preload('cliente')
      .preload('conductor', (q) => q.preload('usuario'))
      .firstOrFail()

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
          }
        : null,
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
      precioFinal: viaje.precioFinal,
      tiempoEstimado: 12,
      createdAt: viaje.createdAt.toISO(),
      aceptadoAt: viaje.aceptadoAt?.toISO() || null,
      enCursoAt: viaje.enCursoAt?.toISO() || null,
      completadoAt: viaje.completadoAt?.toISO() || null,
      finalizadoAt: viaje.finalizadoAt?.toISO() || null,
    }
  }
}
