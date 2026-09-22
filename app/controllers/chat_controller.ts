import MensajeChat from '#models/mensaje_chat'
import Viaje from '#models/viaje'
import Conductor from '#models/conductor'
import type { HttpContext } from '@adonisjs/core/http'
import { emitToClient, emitToDriver } from '#start/socket'
import { sendToToken } from '#services/push_notification_service'

export default class ChatController {
  async index({ auth, params, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const viaje = await Viaje.find(params.id)
    if (!viaje) {
      return response.status(404).send(await serialize.withoutWrapping({ error: 'Viaje no encontrado' }))
    }
    if (viaje.clienteId !== user.id && viaje.conductorId) {
      const conductor = await Conductor.find(viaje.conductorId)
      if (!conductor || conductor.usuarioId !== user.id) {
        return response
          .status(403)
          .send(await serialize.withoutWrapping({ error: 'No participas en este viaje' }))
      }
    }
    if (!['aceptado', 'en_curso', 'conductor_en_camino', 'conductor_llegada', 'sos'].includes(viaje.estado)) {
      return response
        .status(422)
        .send(await serialize.withoutWrapping({ error: 'El chat solo está disponible durante el viaje' }))
    }

    const otrosMensajes =
      user.rol === 'conductor'
        ? { remitenteId: viaje.clienteId }
        : viaje.conductorId
          ? { remitenteId: (await Conductor.find(viaje.conductorId))?.usuarioId }
          : {}

    if (otrosMensajes.remitenteId) {
      await MensajeChat.query()
        .where('viaje_id', viaje.id)
        .where('remitente_id', otrosMensajes.remitenteId)
        .where('leido', false)
        .update({ leido: true })
    }

    const mensajes = await MensajeChat.query()
      .where('viaje_id', viaje.id)
      .preload('remitente', (q) => q.select('id', 'nombre', 'apellido'))
      .orderBy('created_at', 'asc')

    return serialize.withoutWrapping(
      mensajes.map((m) => ({
        id: m.id,
        tripId: String(m.viajeId),
        viajeId: m.viajeId,
        senderId: String(m.remitente.id),
        isSent: m.remitente.id === user.id,
        remitente: {
          id: m.remitente.id,
          nombre: `${m.remitente.nombre || ''} ${m.remitente.apellido || ''}`.trim(),
        },
        mensaje: m.mensaje,
        leido: m.leido,
        createdAt: m.createdAt.toISO(),
      }))
    )
  }

  async store({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const viaje = await Viaje.find(params.id)
    if (!viaje) {
      return response.status(404).send(await serialize.withoutWrapping({ error: 'Viaje no encontrado' }))
    }

    let esParticipante = viaje.clienteId === user.id
    if (!esParticipante && viaje.conductorId) {
      const conductor = await Conductor.find(viaje.conductorId)
      esParticipante = conductor?.usuarioId === user.id
    }
    if (!esParticipante) {
      return response
        .status(403)
        .send(await serialize.withoutWrapping({ error: 'No participas en este viaje' }))
    }
    if (!['aceptado', 'en_curso', 'conductor_en_camino', 'conductor_llegada', 'sos'].includes(viaje.estado)) {
      return response
        .status(422)
        .send(await serialize.withoutWrapping({ error: 'El chat solo está disponible durante el viaje' }))
    }

    const texto = request.input('mensaje')
    if (!texto || typeof texto !== 'string' || texto.trim().length === 0) {
      return response
        .status(422)
        .send(await serialize.withoutWrapping({ error: 'El mensaje no puede estar vacío' }))
    }

    const msg = await MensajeChat.create({
      viajeId: viaje.id,
      remitenteId: user.id,
      mensaje: texto.trim(),
    })

    await msg.load('remitente', (q) => q.select('id', 'nombre', 'apellido'))

    emitToClient(viaje.clienteId, 'chat:message', {
      id: msg.id,
      tripId: String(msg.viajeId),
      senderId: String(msg.remitente.id),
      viajeId: msg.viajeId,
      remitente: {
        id: msg.remitente.id,
        nombre: `${msg.remitente.nombre || ''} ${msg.remitente.apellido || ''}`.trim(),
      },
      mensaje: msg.mensaje,
      createdAt: msg.createdAt.toISO(),
    })
    if (viaje.conductorId) {
      const conductor = await Conductor.find(viaje.conductorId)
      if (conductor) {
        emitToDriver(conductor.usuarioId, 'chat:message', {
          id: msg.id,
          tripId: String(msg.viajeId),
          senderId: String(msg.remitente.id),
          viajeId: msg.viajeId,
          remitente: {
            id: msg.remitente.id,
            nombre: `${msg.remitente.nombre || ''} ${msg.remitente.apellido || ''}`.trim(),
          },
          mensaje: msg.mensaje,
          createdAt: msg.createdAt.toISO(),
        })

        const destinatarioId = user.id === viaje.clienteId ? conductor.usuarioId : viaje.clienteId
        const destinatario = await import('#models/user').then((m) =>
          m.default.find(destinatarioId)
        )
        if (destinatario?.fcmToken) {
          await sendToToken(
            destinatario.fcmToken,
            `Nuevo mensaje de ${msg.remitente.nombre || ''}`,
            msg.mensaje
          )
        }
      }
    }

    return serialize.withoutWrapping({
      id: msg.id,
      tripId: String(msg.viajeId),
      senderId: String(msg.remitente.id),
      viajeId: msg.viajeId,
      remitente: {
        id: msg.remitente.id,
        nombre: `${msg.remitente.nombre || ''} ${msg.remitente.apellido || ''}`.trim(),
      },
      mensaje: msg.mensaje,
      createdAt: msg.createdAt.toISO(),
    })
  }
}
