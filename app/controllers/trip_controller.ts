import User from '#models/user'
import Viaje from '#models/viaje'
import Conductor from '#models/conductor'
import Ganancia from '#models/ganancia'
import Calificacion from '#models/calificacion'
import ConfiguracionPlataforma from '#models/configuracion_plataforma'
import { tripRequestValidator, tripCompleteValidator, tripCancelValidator } from '#validators/trip'
import type { HttpContext } from '@adonisjs/core/http'
import { DateTime } from 'luxon'
import app from '@adonisjs/core/services/app'
import { randomUUID } from 'node:crypto'
import { ApiOperation, ApiBody, ApiResponse } from '@foadonis/openapi/decorators'
import { getIO, emitToClient, emitToDriver, emitToAdmin } from '#start/socket'
import { sendToMultiple, sendToToken } from '#services/push_notification_service'

export default class TripController {
  @ApiOperation({ summary: 'Request a trip', description: 'Creates a new trip request' })
  @ApiBody({ type: () => tripRequestValidator })
  @ApiResponse({ type: 'object' })
  async request({ auth, request, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()
    if (user.estadoCuenta !== 'activa') {
      return response
        .status(403)
        .send({ error: 'Tu cuenta no está activa. No puedes solicitar viajes.' })
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

    const io = getIO()
    io.emit('trip:new', {
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
    })

    const conductoresCercanos = await Conductor.query()
      .where('online', true)
      .whereHas('usuario', (q) => q.whereNotNull('fcm_token'))
      .preload('usuario')
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
    description: 'Returns trips near a given location within a radius',
  })
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
      .filter((v) => v.cliente.visibilidad !== 'baneado')
      .map((v) => {
        const dlat = v.origenLat - lat
        const dlng = v.origenLng - lng
        const distancia = Math.round(Math.sqrt(dlat * dlat + dlng * dlng) * 111.32 * 100) / 100

        return {
          id: String(v.id),
          cliente: {
            nombre: `${v.cliente.nombre || ''} ${v.cliente.apellido || ''}`.trim(),
            reputacion: v.cliente.reputacion,
            visibilidad: v.cliente.visibilidad,
            totalViajes: v.cliente.totalViajesCompletados,
            totalReportes: v.cliente.totalReportes,
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
      .sort((a, b) => {
        const order: Record<string, number> = { normal: 0, reducida: 1, baneado: 2 }
        return (order[a.cliente.visibilidad] ?? 2) - (order[b.cliente.visibilidad] ?? 2)
      })

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
  async accept({ params, serialize, auth, response }: HttpContext) {
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
  async startTrip({ params, serialize }: HttpContext) {
    const viaje = await Viaje.findOrFail(params.id)
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
  async decline({ params, serialize }: HttpContext) {
    const viaje = await Viaje.findOrFail(params.id)
    viaje.estado = 'rechazado'
    await viaje.save()

    return serialize.withoutWrapping({ id: String(viaje.id), estado: viaje.estado })
  }

  @ApiOperation({ summary: 'Complete a trip', description: 'Marks a trip as completed' })
  @ApiBody({ type: () => tripCompleteValidator })
  @ApiResponse({ type: 'object' })
  async complete({ params, request, serialize }: HttpContext) {
    const data = await request.validateUsing(tripCompleteValidator)
    const viaje = await Viaje.findOrFail(params.id)
    viaje.estado = 'completado'
    viaje.precioFinal = data.montoFinal
    viaje.completadoAt = DateTime.now()
    await viaje.save()

    emitToClient(viaje.clienteId, 'trip:completed', {
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
    description: 'Confirms delivery, sets driver online, records payment',
  })
  @ApiBody({ type: () => tripCompleteValidator })
  @ApiResponse({ type: 'object' })
  async finalize({ params, request, serialize, response }: HttpContext) {
    const data = await request.validateUsing(tripCompleteValidator)
    const viaje = await Viaje.find(params.id)
    if (!viaje) {
      return response.status(404).send({ error: 'Viaje no encontrado' })
    }
    if (viaje.estado !== 'completado') {
      return response
        .status(422)
        .send({ error: 'El viaje debe estar completado antes de finalizar' })
    }
    viaje.estado = 'finalizado'
    viaje.precioFinal = data.montoFinal
    viaje.finalizadoAt = DateTime.now()
    await viaje.save()

    if (viaje.conductorId) {
      const montoBruto = data.montoFinal
      const comision = Math.round(montoBruto * 0.1 * 100) / 100
      const montoNeto = montoBruto - comision

      await Ganancia.create({
        conductorId: viaje.conductorId,
        viajeId: viaje.id,
        monto: montoNeto,
        montoBruto,
        comision,
        montoNeto,
        comisionPagada: false,
      })

      const conductor = await Conductor.find(viaje.conductorId)
      if (conductor) {
        conductor.totalViajes += 1
        conductor.online = true
        await conductor.save()
      }
    }

    const cliente = await User.find(viaje.clienteId)
    if (cliente) {
      cliente.totalViajesCompletados += 1
      if (cliente.totalViajesCompletados % 10 === 0 && cliente.reputacion < 5.0) {
        cliente.reputacion = Math.min(5.0, cliente.reputacion + 0.5)
      }
      if (cliente.totalViajesCompletados >= 1 && cliente.reputacion < 5.0) {
        cliente.reputacion = Math.min(5.0, cliente.reputacion + 0.1)
      }
      await cliente.save()
    }

    emitToClient(viaje.clienteId, 'trip:completed', {
      id: String(viaje.id),
      estado: viaje.estado,
      montoFinal: viaje.precioFinal,
      finalizadoAt: viaje.finalizadoAt.toISO(),
    })

    const clienteUser = await User.find(viaje.clienteId)
    if (clienteUser?.fcmToken) {
      await sendToToken(
        clienteUser.fcmToken,
        'Envío entregado',
        'Tu envío ha sido entregado exitosamente'
      )
    }

    emitToAdmin('admin:trip_completed', {
      viajeId: String(viaje.id),
      estado: viaje.estado,
      montoFinal: viaje.precioFinal,
    })

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
  async cancel({ params, request, serialize, auth }: HttpContext) {
    const user = auth.getUserOrFail()
    const data = await request.validateUsing(tripCancelValidator)
    const viaje = await Viaje.findOrFail(params.id)
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

  @ApiOperation({
    summary: 'Get trip history',
    description: 'Returns paginated trip history for the authenticated user',
  })
  @ApiResponse({ type: 'array' })
  async history({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const page = Number.parseInt(request.input('page', '1'))
    const limit = Number.parseInt(request.input('limit', '20'))
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
      fotoEntrega: viaje.fotoEntrega,
      tiempoEstimadoMinutos: viaje.tiempoEstimadoMinutos,
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
      if (!viaje.conductorId) {
        return response
          .status(422)
          .send(serialize.withoutWrapping({ error: 'El viaje no tiene conductor asignado' }))
      }
      const conductor = await Conductor.findOrFail(viaje.conductorId)
      calificadoId = conductor.usuarioId
      tipo = 'cliente_a_conductor'
    } else if (user.rol === 'conductor') {
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

    const file = request.file('file', {
      size: '5mb',
      extnames: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    })
    if (!file) {
      return serialize.withoutWrapping({ error: 'No file uploaded' })
    }

    const fileName = `delivery-${viaje.id}-${randomUUID()}.${file.extname}`
    await file.move(app.makePath('storage', 'uploads'), { name: fileName })

    viaje.fotoEntrega = `/storage/uploads/${fileName}`
    await viaje.save()

    return serialize.withoutWrapping({ fotoEntrega: viaje.fotoEntrega })
  }
}
