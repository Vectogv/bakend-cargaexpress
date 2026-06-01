import Disputa from '#models/disputa'
import Viaje from '#models/viaje'
import Conductor from '#models/conductor'
import type { HttpContext } from '@adonisjs/core/http'
import app from '@adonisjs/core/services/app'
import { randomUUID } from 'node:crypto'
import { emitToAdmin } from '#start/socket'

export default class DisputeController {
  async store({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (user.rol !== 'conductor') {
      return response
        .status(403)
        .send(serialize.withoutWrapping({ error: 'Solo conductores pueden abrir disputas' }))
    }

    const viaje = await Viaje.find(params.id)
    if (!viaje) {
      return response.status(404).send(serialize.withoutWrapping({ error: 'Viaje no encontrado' }))
    }
    if (viaje.estado !== 'finalizado') {
      return response
        .status(422)
        .send(serialize.withoutWrapping({ error: 'Solo puedes disputar viajes finalizados' }))
    }

    const conductor = await Conductor.findByOrFail('usuario_id', user.id)
    if (viaje.conductorId !== conductor.id) {
      return response
        .status(403)
        .send(serialize.withoutWrapping({ error: 'No eres el conductor de este viaje' }))
    }

    const existe = await Disputa.query().where('viaje_id', viaje.id).first()
    if (existe) {
      return response
        .status(400)
        .send(serialize.withoutWrapping({ error: 'Ya existe una disputa para este viaje' }))
    }

    const { version } = request.only(['version'])
    if (!version) {
      return response
        .status(422)
        .send(serialize.withoutWrapping({ error: 'Debes describir tu versión de los hechos' }))
    }

    const disputa = await Disputa.create({
      viajeId: viaje.id,
      conductorId: conductor.id,
      clienteId: viaje.clienteId,
      versionConductor: version,
      estado: 'abierta',
    })

    emitToAdmin('admin:new_dispute', {
      id: String(disputa.id),
      viajeId: String(viaje.id),
      conductorId: String(conductor.id),
      clienteId: String(viaje.clienteId),
      estado: disputa.estado,
      createdAt: disputa.createdAt.toISO(),
    })

    return response.status(201).send(
      serialize.withoutWrapping({
        id: String(disputa.id),
        estado: disputa.estado,
        message: 'Disputa creada. El administrador revisará el caso.',
      })
    )
  }

  async appeal({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const disputa = await Disputa.query().where('viaje_id', params.id).first()
    if (!disputa) {
      return response
        .status(404)
        .send(serialize.withoutWrapping({ error: 'Disputa no encontrada' }))
    }
    if (disputa.clienteId !== user.id) {
      return response
        .status(403)
        .send(serialize.withoutWrapping({ error: 'No eres el cliente de esta disputa' }))
    }
    if (disputa.estado !== 'abierta') {
      return response
        .status(422)
        .send(serialize.withoutWrapping({ error: 'La disputa no está en estado abierta' }))
    }

    const { version } = request.only(['version'])
    if (!version) {
      return response
        .status(422)
        .send(serialize.withoutWrapping({ error: 'Debes describir tu versión' }))
    }

    disputa.versionCliente = version
    disputa.estado = 'en_revision'
    await disputa.save()

    emitToAdmin('admin:dispute_appeal', {
      id: String(disputa.id),
      viajeId: String(disputa.viajeId),
      estado: disputa.estado,
    })

    return serialize.withoutWrapping({
      id: String(disputa.id),
      estado: disputa.estado,
      message: 'Apelación recibida. El administrador revisará el caso.',
    })
  }

  async uploadSupport({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const disputa = await Disputa.query().where('viaje_id', params.id).first()
    if (!disputa) {
      return response
        .status(404)
        .send(serialize.withoutWrapping({ error: 'Disputa no encontrada' }))
    }
    if (disputa.clienteId !== user.id) {
      return response
        .status(403)
        .send(serialize.withoutWrapping({ error: 'No eres el cliente de esta disputa' }))
    }

    const file = request.file('file', {
      size: '5mb',
      extnames: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'pdf'],
    })
    if (!file) {
      return serialize.withoutWrapping({ error: 'No file uploaded' })
    }

    const fileName = `dispute-${disputa.id}-${randomUUID()}.${file.extname}`
    await file.move(app.makePath('storage', 'uploads'), { name: fileName })

    disputa.soporteCliente = `/storage/uploads/${fileName}`
    await disputa.save()

    return serialize.withoutWrapping({ soporte: disputa.soporteCliente })
  }
}
