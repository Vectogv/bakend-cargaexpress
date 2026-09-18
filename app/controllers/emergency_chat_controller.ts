import MensajeEmergencia from '#models/mensaje_emergencia'
import AlertaEmergencia from '#models/alerta_emergencia'
import Viaje from '#models/viaje'
import User from '#models/user'
import type { HttpContext } from '@adonisjs/core/http'
import { emitToModerators, emitToAdmin, getIO } from '#start/socket'
import { resolverZonaAlerta } from '#services/moderator_trip_events'
import { sendToToken } from '#services/push_notification_service'

export default class EmergencyChatController {
  private async esParticipante(alerta: AlertaEmergencia, _viaje: Viaje | null, user: User, zona: string | null) {
    if (user.rol === 'admin') return true
    if (user.id === alerta.userId) return true

    if (user.esModerador && zona && user.zonaModerador === zona) return true

    return false
  }

  private async tomarContexto(alertaId: number) {
    const alerta = await AlertaEmergencia.find(alertaId)
    if (!alerta) return null

    const viaje = alerta.viajeId ? await Viaje.find(alerta.viajeId) : null
    const zona = await resolverZonaAlerta(
      alerta.viajeId,
      typeof alerta.lat === 'string' ? Number(alerta.lat) : alerta.lat,
      typeof alerta.lng === 'string' ? Number(alerta.lng) : alerta.lng
    )
    return { alerta, viaje, zona }
  }

  async index({ auth, params, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const ctx = await this.tomarContexto(params.id)
    if (!ctx) {
      return response.status(404).send(serialize.withoutWrapping({ error: 'Alerta de emergencia no encontrada' }))
    }
    if (!(await this.esParticipante(ctx.alerta, ctx.viaje, user, ctx.zona))) {
      return response.status(403).send(serialize.withoutWrapping({ error: 'No participas en este caso' }))
    }

    const mensajes = await MensajeEmergencia.query()
      .where('alerta_id', ctx.alerta.id)
      .preload('remitente', (q) => q.select('id', 'nombre', 'apellido', 'rol', 'es_moderador', 'zona_moderador'))
      .orderBy('created_at', 'asc')

    return serialize.withoutWrapping(
      mensajes.map((m) => ({
        id: m.id,
        alertaId: m.alertaId,
        remitente: {
          id: m.remitente.id,
          nombre: `${m.remitente.nombre || ''} ${m.remitente.apellido || ''}`.trim(),
          rol: m.remitente.rol,
          esModerador: m.remitente.esModerador,
          zonaModerador: m.remitente.zonaModerador,
        },
        mensaje: m.mensaje,
        leido: m.leido,
        createdAt: m.createdAt.toISO(),
      }))
    )
  }

  async store({ auth, params, request, response, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const ctx = await this.tomarContexto(params.id)
    if (!ctx) {
      return response.status(404).send(serialize.withoutWrapping({ error: 'Alerta de emergencia no encontrada' }))
    }
    if (!(await this.esParticipante(ctx.alerta, ctx.viaje, user, ctx.zona))) {
      return response.status(403).send(serialize.withoutWrapping({ error: 'No participas en este caso' }))
    }

    const texto = request.input('mensaje')
    if (!texto || typeof texto !== 'string' || texto.trim().length === 0) {
      return response.status(422).send(serialize.withoutWrapping({ error: 'El mensaje no puede estar vacío' }))
    }

    const msg = await MensajeEmergencia.create({
      alertaId: ctx.alerta.id,
      remitenteId: user.id,
      mensaje: texto.trim(),
    })

    await msg.load('remitente', (q) => q.select('id', 'nombre', 'apellido', 'rol', 'es_moderador', 'zona_moderador'))

    const payload = {
      id: msg.id,
      alertaId: msg.alertaId,
      remitente: {
        id: msg.remitente.id,
        nombre: `${msg.remitente.nombre || ''} ${msg.remitente.apellido || ''}`.trim(),
        rol: msg.remitente.rol,
        esModerador: msg.remitente.esModerador,
        zonaModerador: msg.remitente.zonaModerador,
      },
      mensaje: msg.mensaje,
      leido: msg.leido,
      createdAt: msg.createdAt.toISO(),
    }

    const solicitante = await User.find(ctx.alerta.userId)
    const esAdminRemitente = user.rol === 'admin'

    if (user.id === ctx.alerta.userId) {
      if (ctx.zona) emitToModerators(ctx.zona, 'emergency:message', payload)
      else emitToAdmin('emergency:message', payload)
    } else if (solicitante) {
      const room =
        solicitante.rol === 'conductor'
          ? `driver:${solicitante.id}`
          : `client:${solicitante.id}`
      try {
        getIO().to(room).emit('emergency:message', payload)
      } catch {
        // socket no disponible
      }
    }

    if (esAdminRemitente && ctx.zona && user.id !== ctx.alerta.userId) {
      emitToModerators(ctx.zona, 'emergency:message', payload)
    }

    if (solicitante && solicitante.id !== user.id && solicitante.fcmToken) {
      try {
        await sendToToken(
          solicitante.fcmToken,
          `Emergencia #${ctx.alerta.id} · ${payload.remitente.nombre}`,
          payload.mensaje
        )
      } catch {
        // push no crítico
      }
    }

    return serialize.withoutWrapping(payload)
  }
}