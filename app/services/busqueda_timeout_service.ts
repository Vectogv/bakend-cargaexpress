import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import Viaje from '#models/viaje'
import User from '#models/user'
import Notificacion from '#models/notificacion'
import reservationConfig from '#config/reservations'
import OfferExpiryService from '#services/offer_expiry_service'
import TripStateMachine, { type EstadoViaje } from '#services/trip_state_machine'
import { emitToClient, emitTripStatusChanged } from '#start/socket'
import { sendToToken } from '#services/push_notification_service'
import { emitTripUpdateToModerators } from '#services/moderator_trip_events'

const ESTADOS_BUSQUEDA: EstadoViaje[] = ['buscando_conductor', 'pendiente']
export const MOTIVO_SIN_CONDUCTORES = 'Sin conductores disponibles'
export const TIPO_NOTIFICACION_SIN_CONDUCTOR = 'busqueda_sin_conductor'

/**
 * Búsqueda de conductor vencida.
 *
 * Un viaje en `buscando_conductor` o `pendiente` (ofertas recibidas, ninguna
 * aceptada) se cancela por el sistema cuando pasan `busquedaTimeoutMin`
 * (BUSQUEDA_TIMEOUT_MIN, 15 por defecto) minutos desde que inició la búsqueda:
 * `created_at` en viajes inmediatos y `activacion_at` en reservas (la
 * activación lo fija al momento real en que arrancó la búsqueda).
 *
 * Lo ejecuta el scheduler interno cada minuto. Es seguro con varias réplicas o
 * barridos solapados: la cancelación es un
 * `UPDATE ... WHERE id = ? AND estado IN ('buscando_conductor','pendiente')`,
 * así solo quien realmente cambia la fila notifica.
 *
 * Al cancelar: motivo 'Sin conductores disponibles', se expiran las ofertas
 * pendientes (el conductor recibe `offer:expired`), el cliente recibe
 * `trip:cancelled {id, estado, motivo, canceladoPor: 'sistema'}`, una
 * Notificacion `busqueda_sin_conductor` y un push. No penaliza reputación.
 */
export default class BusquedaTimeoutService {
  /** Cancela las búsquedas vencidas y devuelve los ids que esta llamada canceló. */
  static async expirarBusquedasVencidas(now: DateTime = DateTime.now()): Promise<number[]> {
    const corte = now.minus({ minutes: reservationConfig.busquedaTimeoutMin })

    // Pocos viajes están buscando a la vez: se filtra la fecha en JS para no
    // depender de comparaciones de timestamp por dialecto (igual que las reservas).
    const candidatos = await Viaje.query().whereIn('estado', ESTADOS_BUSQUEDA)
    const vencidos = candidatos.filter((v) => {
      const inicio = this.inicioBusqueda(v)
      return inicio !== null && inicio <= corte
    })

    const cancelados: number[] = []
    for (const viaje of vencidos) {
      try {
        if (await this.cancelar(viaje)) cancelados.push(viaje.id)
      } catch (err) {
        logger.error({ err, viajeId: viaje.id }, 'BusquedaTimeoutService: fallo cancelando viaje')
      }
    }
    return cancelados
  }

  /** Momento en que inició la búsqueda de conductor. */
  private static inicioBusqueda(viaje: Viaje): DateTime | null {
    if (viaje.tipoProgramacion === 'programada' && viaje.activacionAt) return viaje.activacionAt
    return viaje.createdAt ?? null
  }

  private static async cancelar(viaje: Viaje): Promise<boolean> {
    if (!TripStateMachine.validarTransicion(viaje.estado as EstadoViaje, 'cancelado')) return false

    const resultado = await Viaje.query()
      .where('id', viaje.id)
      .whereIn('estado', ESTADOS_BUSQUEDA)
      .update({ estado: 'cancelado' })
    const filas = Array.isArray(resultado) ? Number(resultado[0]) : Number(resultado)
    if (filas !== 1) return false

    viaje.estado = 'cancelado'
    viaje.motivoCancelacion = MOTIVO_SIN_CONDUCTORES
    viaje.canceladoAt = DateTime.now()
    await viaje.save()

    await OfferExpiryService.expirarDelViaje(viaje.id)

    emitTripStatusChanged(viaje.clienteId, null, {
      id: String(viaje.id),
      estado: 'cancelado',
      motivo: viaje.motivoCancelacion,
    })
    emitToClient(viaje.clienteId, 'trip:cancelled', {
      id: String(viaje.id),
      estado: viaje.estado,
      motivo: viaje.motivoCancelacion,
      canceladoPor: 'sistema',
    })
    emitTripUpdateToModerators(viaje)

    const titulo = 'No encontramos conductor'
    const mensaje = `Tu viaje #${viaje.id} se canceló porque no hubo conductores disponibles. Puedes solicitarlo de nuevo.`
    await Notificacion.create({
      usuarioId: viaje.clienteId,
      tipo: TIPO_NOTIFICACION_SIN_CONDUCTOR,
      titulo,
      mensaje,
      leido: false,
    })
    const cliente = await User.find(viaje.clienteId)
    if (cliente?.fcmToken) {
      await sendToToken(cliente.fcmToken, titulo, mensaje, { viajeId: String(viaje.id) }).catch(
        (err: unknown) => logger.warn({ err, viajeId: viaje.id }, 'BusquedaTimeoutService: push falló')
      )
    }
    return true
  }
}
