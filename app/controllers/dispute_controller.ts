import Disputa from '#models/disputa'
import Viaje from '#models/viaje'
import Conductor from '#models/conductor'
import type { HttpContext } from '@adonisjs/core/http'
import app from '@adonisjs/core/services/app'
import { randomUUID } from 'node:crypto'
import { emitToAdmin, emitToClient, emitToDriver } from '#start/socket'


export default class DisputeController {
  async show({ auth, params, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const disputa = await Disputa.find(params.id)
    if (!disputa) {
      return response.status(404).send(serialize.withoutWrapping({ error: 'Disputa no encontrada' }))
    }
    if (disputa.clienteId !== user.id && disputa.conductorId !== user.id) {
      const conductor = await Conductor.findBy('usuario_id', user.id)
      if (!conductor || disputa.conductorId !== conductor.id) {
        return response.status(403).send(serialize.withoutWrapping({ error: 'No tienes acceso a esta disputa' }))
      }
    }

    return serialize.withoutWrapping({
      id: String(disputa.id),
      numero: disputa.numero,
      estado: disputa.estado,
      problema: disputa.problema,
      resultado: disputa.resultado,
      reembolso: disputa.reembolso,
      comentarioAdmin: disputa.comentarioAdmin,
      fechaResolucion: disputa.resueltaAt?.toISO() || null,
    })
  }

  async storeRoot({ auth, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (user.rol !== 'conductor' && user.rol !== 'cliente') {
      return response.status(403).send(serialize.withoutWrapping({ error: 'Solo conductores o clientes pueden abrir disputas' }))
    }

    const { tripId, problema, descripcion } = request.only(['tripId', 'problema', 'descripcion'])
    let fotos = request.input('fotos', [])

    if (!tripId) {
      return response.status(422).send(serialize.withoutWrapping({ error: 'tripId es requerido' }))
    }

    const viaje = await Viaje.find(tripId)
    if (!viaje) {
      return response.status(404).send(serialize.withoutWrapping({ error: 'Viaje no encontrado' }))
    }
    if (!['esperando_confirmacion', 'finalizado'].includes(viaje.estado)) {
      return response.status(422).send(serialize.withoutWrapping({ error: `Solo puedes disputar viajes en estado 'esperando_confirmacion' o 'finalizado' (actual: ${viaje.estado})` }))
    }

    const existe = await Disputa.query().where('viaje_id', viaje.id).first()
    if (existe) {
      return response.status(400).send(serialize.withoutWrapping({ error: 'Ya existe una disputa para este viaje' }))
    }

    if (!Array.isArray(fotos)) {
      fotos = []
    }

    if (user.rol === 'conductor') {
      const conductor = await Conductor.findByOrFail('usuario_id', user.id)
      if (viaje.conductorId !== conductor.id) {
        return response.status(403).send(serialize.withoutWrapping({ error: 'No eres el conductor de este viaje' }))
      }

      const disputa = await Disputa.create({
        viajeId: viaje.id,
        conductorId: conductor.id,
        clienteId: viaje.clienteId,
        versionConductor: descripcion || '',
        problema: problema || null,
        descripcion: descripcion || null,
        fotos: fotos.length > 0 ? fotos : null,
        estado: 'abierta',
      })

      disputa.numero = await this.generarNumero()
      await disputa.save()

      const createdPayload = {
        id: String(disputa.id),
        numero: disputa.numero,
        viajeId: String(viaje.id),
        conductorId: String(conductor.id),
        clienteId: String(viaje.clienteId),
        estado: disputa.estado,
        problema: disputa.problema,
        createdAt: disputa.createdAt.toISO(),
      }

      emitToAdmin('admin:new_dispute', createdPayload)
      emitToClient(viaje.clienteId, 'dispute:updated', createdPayload)

      return response.status(201).send(
        serialize.withoutWrapping({
          id: String(disputa.id),
          numero_disputa: disputa.numero,
        })
      )
    }

    // cliente
    if (viaje.clienteId !== user.id) {
      return response.status(403).send(serialize.withoutWrapping({ error: 'Este viaje no te pertenece' }))
    }
    if (!viaje.conductorId) {
      return response.status(422).send(serialize.withoutWrapping({ error: 'El viaje no tiene conductor asignado' }))
    }

    const conductor = await Conductor.find(viaje.conductorId)
    if (!conductor) {
      return response.status(422).send(serialize.withoutWrapping({ error: 'Conductor no encontrado' }))
    }

    const disputa = await Disputa.create({
      viajeId: viaje.id,
      conductorId: conductor.id,
      clienteId: viaje.clienteId,
      versionCliente: descripcion || '',
      problema: problema || null,
      descripcion: descripcion || null,
      fotos: fotos.length > 0 ? fotos : null,
      estado: 'abierta',
    })

    disputa.numero = await this.generarNumero()
    await disputa.save()

    const createdPayloadCliente = {
      id: String(disputa.id),
      numero: disputa.numero,
      viajeId: String(viaje.id),
      conductorId: String(conductor.id),
      clienteId: String(viaje.clienteId),
      estado: disputa.estado,
      problema: disputa.problema,
      createdAt: disputa.createdAt.toISO(),
    }

    emitToAdmin('admin:new_dispute', createdPayloadCliente)
    const conductorUserObj = await Conductor.find(conductor.id)
    if (conductorUserObj) {
      emitToDriver(conductorUserObj.usuarioId, 'dispute:updated', createdPayloadCliente)
    }

    return response.status(201).send(
      serialize.withoutWrapping({
        id: String(disputa.id),
        numero_disputa: disputa.numero,
      })
    )
  }

  private async generarNumero(): Promise<string> {
    const count = await Disputa.query().count('id as total')
    const total = Number(count[0].$extras?.total || 0)
    return `DSP-${String(total).padStart(5, '0')}`
  }

  async store({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    if (user.rol !== 'conductor' && user.rol !== 'cliente') {
      return response
        .status(403)
        .send(serialize.withoutWrapping({ error: 'Solo conductores o clientes pueden abrir disputas' }))
    }

    const viaje = await Viaje.find(params.id)
    if (!viaje) {
      return response.status(404).send(serialize.withoutWrapping({ error: 'Viaje no encontrado' }))
    }
    if (!['esperando_confirmacion', 'finalizado'].includes(viaje.estado)) {
      return response
        .status(422)
        .send(serialize.withoutWrapping({ error: `Solo puedes disputar viajes en estado 'esperando_confirmacion' o 'finalizado' (actual: ${viaje.estado})` }))
    }

    const existe = await Disputa.query().where('viaje_id', viaje.id).first()
    if (existe) {
      return response
        .status(400)
        .send(serialize.withoutWrapping({ error: 'Ya existe una disputa para este viaje' }))
    }

    const { version, motivo, descripcion } = request.only(['version', 'motivo', 'descripcion'])
    const description = version || motivo || descripcion
    if (!description) {
      return response
        .status(422)
        .send(serialize.withoutWrapping({ error: 'Debes describir tu versión de los hechos' }))
    }

    if (user.rol === 'conductor') {
      const conductor = await Conductor.findByOrFail('usuario_id', user.id)
      if (viaje.conductorId !== conductor.id) {
        return response
          .status(403)
          .send(serialize.withoutWrapping({ error: 'No eres el conductor de este viaje' }))
      }

      const disputa = await Disputa.create({
        viajeId: viaje.id,
        conductorId: conductor.id,
        clienteId: viaje.clienteId,
        versionConductor: description,
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

    // cliente
    if (viaje.clienteId !== user.id) {
      return response
        .status(403)
        .send(serialize.withoutWrapping({ error: 'Este viaje no te pertenece' }))
    }

    if (!viaje.conductorId) {
      return response
        .status(422)
        .send(serialize.withoutWrapping({ error: 'El viaje no tiene conductor asignado' }))
    }

    const conductor = await Conductor.find(viaje.conductorId)
    if (!conductor) {
      return response
        .status(422)
        .send(serialize.withoutWrapping({ error: 'Conductor no encontrado' }))
    }

    const disputa = await Disputa.create({
      viajeId: viaje.id,
      conductorId: conductor.id,
      clienteId: viaje.clienteId,
      versionCliente: description,
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

    const { version, motivo, descripcion } = request.only(['version', 'motivo', 'descripcion'])
    const description = version || motivo || descripcion
    if (!description) {
      return response
        .status(422)
        .send(serialize.withoutWrapping({ error: 'Debes describir tu versión' }))
    }

    disputa.versionCliente = description
    disputa.estado = 'en_revision'
    await disputa.save()

    const appealPayload = {
      id: String(disputa.id),
      viajeId: String(disputa.viajeId),
      estado: disputa.estado,
    }

    emitToAdmin('admin:dispute_appeal', appealPayload)
    emitToClient(disputa.clienteId, 'dispute:updated', appealPayload)
    const conductorObj = await Conductor.find(disputa.conductorId)
    if (conductorObj) {
      emitToDriver(conductorObj.usuarioId, 'dispute:updated', appealPayload)
    }

    return serialize.withoutWrapping({
      id: String(disputa.id),
      estado: disputa.estado,
      message: 'Apelación recibida. El administrador revisará el caso.',
    })
  }

  async submitVersion({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const disputa = await Disputa.find(params.id)
    if (!disputa) {
      return response.status(404).send(serialize.withoutWrapping({ error: 'Disputa no encontrada' }))
    }

    const { version } = request.only(['version'])
    if (!version || !version.trim()) {
      return response.status(422).send(serialize.withoutWrapping({ error: 'Debes escribir tu versión' }))
    }

    const conductor = await Conductor.findBy('usuario_id', user.id)
    const esConductor = conductor && disputa.conductorId === conductor.id
    const esCliente = disputa.clienteId === user.id

    if (!esConductor && !esCliente) {
      return response.status(403).send(serialize.withoutWrapping({ error: 'No tienes acceso a esta disputa' }))
    }

    if (disputa.estado === 'resuelta') {
      return response.status(422).send(serialize.withoutWrapping({ error: 'La disputa ya fue resuelta' }))
    }

    if (esConductor) {
      disputa.versionConductor = version.trim()
    } else {
      disputa.versionCliente = version.trim()
    }

    if (disputa.estado === 'abierta') {
      disputa.estado = 'en_revision'
    }
    await disputa.save()

    const payload = {
      id: String(disputa.id),
      viajeId: String(disputa.viajeId),
      estado: disputa.estado,
    }

    emitToAdmin('admin:dispute_updated', payload)
    emitToClient(disputa.clienteId, 'dispute:updated', payload)
    const conductorObj = await Conductor.find(disputa.conductorId)
    if (conductorObj) {
      emitToDriver(conductorObj.usuarioId, 'dispute:updated', payload)
    }

    return serialize.withoutWrapping({
      id: String(disputa.id),
      estado: disputa.estado,
      message: 'Versión actualizada. El administrador revisará el caso.',
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
