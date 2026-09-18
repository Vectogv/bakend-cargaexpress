import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import Viaje from '#models/viaje'
import User from '#models/user'
import RedisService from '#services/redis_service'
import TripDispatchService from '#services/trip_dispatch_service'
import reservationConfig from '#config/reservations'
import { emitToClient } from '#start/socket'
import { sendToToken } from '#services/push_notification_service'
import { emitTripUpdateToModerators } from '#services/moderator_trip_events'

/**
 * Activación de reservas programadas.
 *
 * Una reserva pasa de `reservado` a `buscando_conductor` cuando llega su
 * `activacion_at` (hora programada menos la anticipación configurada).
 *
 * Idempotencia / concurrencia:
 *   • Lock distribuido en Redis por reserva (evita dos workers sobre la misma).
 *   • Re-lectura con SELECT ... FOR UPDATE dentro de una transacción.
 *   • Re-verificación del estado antes de escribir (una reserva = una activación).
 */
export default class ReservationActivationService {
  /**
   * Reservas cuya ventana de activación ya inició.
   *
   * Se ordena por `activacion_at` ascendente y se filtra en JS para evitar
   * comparaciones de timestamp dependientes del dialecto (sqlite/mysql/pg).
   * Al estar ordenado, si la N-ésima más próxima no venció, ninguna posterior
   * tampoco lo hizo.
   */
  static async reservasPorActivar(
    now: DateTime = DateTime.now(),
    limit: number = reservationConfig.activationBatchSize
  ) {
    const candidatas = await Viaje.query()
      .where('tipo_programacion', 'programada')
      .where('estado', 'reservado')
      .whereNotNull('activacion_at')
      .orderBy('activacion_at', 'asc')
      .limit(limit)

    return candidatas.filter((v) => v.activacionAt !== null && v.activacionAt <= now)
  }

  /**
   * Envía el recordatorio "tu viaje está programado para…" una única vez por
   * reserva (usando la columna `recordatorio_enviado` para no duplicar).
   */
  static async enviarRecordatorios(now: DateTime = DateTime.now()): Promise<number> {
    const limite = now.plus({ minutes: reservationConfig.reminderLeadMinutes })

    const candidatas = await Viaje.query()
      .where('tipo_programacion', 'programada')
      .where('estado', 'reservado')
      .where('recordatorio_enviado', false)
      .whereNotNull('activacion_at')
      .orderBy('activacion_at', 'asc')
      .limit(reservationConfig.activationBatchSize)

    const pendientes = candidatas.filter(
      (v) => v.activacionAt !== null && v.activacionAt > now && v.activacionAt <= limite
    )

    let enviados = 0
    for (const viaje of pendientes) {
      // Marca primero: si dos workers compiten, solo uno obtiene la fila.
      const actualizados = await Viaje.query()
        .where('id', viaje.id)
        .where('recordatorio_enviado', false)
        .update({ recordatorio_enviado: true })
      if (Number(actualizados) === 0) continue

      const cliente = await User.find(viaje.clienteId)
      if (cliente?.fcmToken) {
        await sendToToken(
          cliente.fcmToken,
          'Recordatorio de reserva',
          `Tu viaje está programado para el ${viaje.fechaProgramada} a las ${viaje.horaProgramada}.`
        )
      }
      enviados++
    }

    return enviados
  }

  /**
   * Activa una reserva. Devuelve `activada` solo si esta invocación realizó la
   * transición; `omitida` si ya estaba activada o no correspondía.
   */
  static async activar(viajeId: number): Promise<'activada' | 'omitida'> {
    const lockKey = `reservation:activate:${viajeId}`
    const acquired = await RedisService.acquireLock(lockKey, 60_000)
    if (!acquired) return 'omitida'

    try {
      const viaje = await db.transaction(async (trx) => {
        const row = await Viaje.query({ client: trx })
          .where('id', viajeId)
          .forUpdate()
          .first()

        if (!row) return null
        // Re-validación dentro del lock: otra ejecución pudo activarla ya.
        if (row.tipoProgramacion !== 'programada' || row.estado !== 'reservado') {
          return null
        }
        // No activar reservas cuya ventana todavía no llegó.
        if (row.activacionAt !== null && row.activacionAt > DateTime.now()) {
          return null
        }

        row.estado = 'buscando_conductor'
        await row.useTransaction(trx).save()
        return row
      })

      if (!viaje) return 'omitida'

      emitToClient(viaje.clienteId, 'trip:status_changed', {
        id: String(viaje.id),
        estado: 'buscando_conductor',
      })

      emitToClient(viaje.clienteId, 'trip:search_started', {
        id: String(viaje.id),
        estado: viaje.estado,
        tipoProgramacion: viaje.tipoProgramacion,
        fechaProgramada: viaje.fechaProgramada,
        horaProgramada: viaje.horaProgramada,
      })

      emitTripUpdateToModerators(viaje)

      const cliente = await User.find(viaje.clienteId)
      if (cliente?.fcmToken) {
        await sendToToken(
          cliente.fcmToken,
          'Buscando conductor',
          'Estamos buscando un conductor para tu reserva.'
        )
      }

      // Reutiliza exactamente la misma búsqueda que el viaje inmediato.
      await TripDispatchService.buscarConductores(viaje)

      return 'activada'
    } finally {
      await RedisService.releaseLock(lockKey)
    }
  }
}
