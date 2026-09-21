import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import Viaje from '#models/viaje'
import User from '#models/user'
import Notificacion from '#models/notificacion'
import antifraudeConfig from '#config/antifraude'
import { sendToMultiple } from '#services/push_notification_service'
import { emitToModerators, emitToAdmin } from '#start/socket'
import { resolverZonaViaje } from '#services/moderator_trip_events'

/**
 * H1: Confirmación de cierre sin respuesta del cliente.
 *
 * Un viaje en `pendiente_confirmacion` debe ser confirmado (o rechazado) por
 * el cliente en un plazo máximo de `confirmacionTimeoutMin` minutos. Si el
 * cliente no responde, se notifica al moderador de la zona (o a los admins si
 * no hay moderador para la zona) para que resuelva manualmente el cierre.
 *
 * El servicio sólo notifica una vez por viaje: `moderador_notificado_en` se
 * rellena la primera vez y el barrido ignora los que ya se notificaron.
 */
export default class ConfirmacionTimeoutService {
  static async notificarConfirmacionesVencidas(): Promise<number> {
    try {
      const corte = DateTime.now().minus({ minutes: antifraudeConfig.confirmacionTimeoutMin })

      const vencidos = await Viaje.query()
        .where('estado', 'pendiente_confirmacion')
        .whereNotNull('pendiente_confirmacion_desde')
        .whereNull('moderador_notificado_en')
        .where('pendiente_confirmacion_desde', '<', corte.toSQL()!)

      let notificados = 0
      for (const viaje of vencidos) {
        try {
          const procesado = await this.notificarViajeVencido(viaje)
          if (procesado) notificados += 1
        } catch (e) {
          logger.error({ err: e, viajeId: viaje.id }, 'ConfirmacionTimeoutService: fallo procesando viaje')
        }
      }
      return notificados
    } catch (err) {
      logger.error({ err }, 'ConfirmacionTimeoutService: fallo en barrido de confirmaciones vencidas')
      return 0
    }
  }

  private static async notificarViajeVencido(viaje: Viaje): Promise<boolean> {
    await viaje.load('cliente', (q) => q.select('id', 'nombre', 'apellido'))

    const zona = await resolverZonaViaje(viaje)
    const destinatarios = await this.obtenerDestinatarios(zona)

    if (destinatarios.length === 0) {
      await this.marcarNotificado(viaje)
      return false
    }

    const minutosRestantes = Math.max(
      1,
      Math.ceil(antifraudeConfig.confirmacionTimeoutMin)
    )
    const titulo = 'Cliente sin confirmar cierre'
    const mensaje = `El viaje #${viaje.id} lleva más de ${minutosRestantes} min. sin confirmar el cierre. Revisa la finalización.`

    // Notificación in-app + FCM a cada moderador/admin destinatario.
    for (const destinatario of destinatarios) {
      await Notificacion.create({
        usuarioId: destinatario.id,
        tipo: 'pendiente_cierre',
        titulo,
        mensaje,
        leido: false,
      })
    }

    const tokens = destinatarios
      .map((u) => u.fcmToken)
      .filter((t): t is string => Boolean(t))
    if (tokens.length > 0) {
      await sendToMultiple(tokens, titulo, mensaje, { viajeId: String(viaje.id), zona: zona || '' })
    }

    // Evento en tiempo real al panel del moderador de la zona (o al admin).
    if (zona) {
      emitToModerators(zona, 'moderator:pending_close', {
        viajeId: String(viaje.id),
        zona,
        cliente: viaje.cliente
          ? {
              id: viaje.cliente.id,
              nombre: `${viaje.cliente.nombre || ''} ${viaje.cliente.apellido || ''}`.trim(),
            }
          : null,
        pendienteDesde: viaje.pendienteConfirmacionDesde?.toISO() ?? null,
      })
    } else {
      emitToAdmin('admin:pending_close', {
        viajeId: String(viaje.id),
        zona: zona || null,
        cliente: viaje.cliente
          ? {
              id: viaje.cliente.id,
              nombre: `${viaje.cliente.nombre || ''} ${viaje.cliente.apellido || ''}`.trim(),
            }
          : null,
        pendienteDesde: viaje.pendienteConfirmacionDesde?.toISO() ?? null,
      })
    }

    await this.marcarNotificado(viaje)
    return true
  }

  private static async obtenerDestinatarios(zona: string | null) {
    if (zona) {
      const moderadores = await User.query()
        .where('es_moderador', true)
        .whereRaw('LOWER(zona_moderador) = ?', [zona.trim().toLowerCase()])
        .select('id', 'fcm_token', 'zona_moderador')
      if (moderadores.length > 0) return moderadores
    }

    return User.query()
      .where('rol', 'admin')
      .select('id', 'fcm_token', 'zona_moderador')
  }

  private static async marcarNotificado(viaje: Viaje) {
    viaje.moderadorNotificadoEn = DateTime.now()
    await viaje.save()
  }
}