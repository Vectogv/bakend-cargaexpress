import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import Viaje from '#models/viaje'
import User from '#models/user'
import Conductor from '#models/conductor'
import Oferta from '#models/oferta'
import RedisService from '#services/redis_service'
import TripDispatchService from '#services/trip_dispatch_service'
import TripConflictService from '#services/trip_conflict_service'
import DriverDebtSuspensionService from '#services/driver_debt_suspension_service'
import reservationConfig from '#config/reservations'
import { parseScheduledDateTime } from '#services/reservation_time'
import { emitToClient, emitTripStatusChanged } from '#start/socket'
import { sendToToken } from '#services/push_notification_service'
import { emitTripUpdateToModerators } from '#services/moderator_trip_events'
import { viajeActivoDelCliente } from '#controllers/trip_controller'

/** Token FCM del usuario de un conductor (null si no hay conductor o token). */
async function tokenDelConductor(conductorId: number | null): Promise<string | null> {
  if (!conductorId) return null
  const conductor = await Conductor.query().where('id', conductorId).preload('usuario').first()
  return conductor?.usuario?.fcmToken ?? null
}

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
      const tokenConductor = await tokenDelConductor(viaje.conductorId)
      if (tokenConductor) {
        await sendToToken(
          tokenConductor,
          'Recordatorio de reserva',
          `Tienes una reserva el ${viaje.fechaProgramada} a las ${viaje.horaProgramada}.`,
          { tipo: 'reserva', viajeId: String(viaje.id) }
        )
      }
      enviados++
    }

    return enviados
  }

  /**
   * Activa una reserva. Devuelve `activada` solo si esta invocación realizó la
   * transición; `omitida` si ya estaba activada, no correspondía, o el cliente
   * ya tiene otro viaje activo (se reintenta en la siguiente pasada).
   */
  static async activar(viajeId: number): Promise<'activada' | 'omitida'> {
    const lockKey = `reservation:activate:${viajeId}`
    const acquired = await RedisService.acquireLock(lockKey, 60_000)
    if (!acquired) return 'omitida'

    try {
      let pospuesta = false
      let clienteIdPospuesta: number | null = null
      // Reserva con conductor asignado: avisos que se deciden dentro de la
      // transacción y se envían después de confirmarla.
      let conductorPospuestoId: number | null = null
      let conductorLiberadoId: number | null = null
      let conductorAsignadoId: number | null = null

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

        // El cliente ya tiene otro viaje en curso: no se activa todavía, se
        // reintenta en la siguiente pasada del scheduler (cada 60s).
        const otroViajeActivo = await viajeActivoDelCliente(row.clienteId, trx)
        if (otroViajeActivo) {
          if (!row.avisoPospuestoEnviado) {
            row.avisoPospuestoEnviado = true
            await row.useTransaction(trx).save()
            pospuesta = true
            clienteIdPospuesta = row.clienteId
          }
          return null
        }

        // Reserva ya asignada: pasa directo a `aceptado` con su conductor,
        // salvo que él ya no esté habilitado o siga ocupado.
        if (row.conductorId !== null) {
          const conductor = await Conductor.query({ client: trx })
            .where('id', row.conductorId)
            .preload('usuario', (q) => q.select('id', 'suspendido', 'estado_cuenta'))
            .first()
          const habilitado =
            !!conductor &&
            conductor.estadoVerificacion === 'aprobado' &&
            !conductor.usuario?.suspendido &&
            !DriverDebtSuspensionService.estaSuspendido(conductor.usuario?.estadoCuenta)
          const ocupado =
            habilitado && (await TripConflictService.conductorOcupado(row.conductorId, row.id, trx))
          const programada = parseScheduledDateTime(row.fechaProgramada, row.horaProgramada)

          if (ocupado && programada && DateTime.now() < programada) {
            // Todavía hay margen: se reintenta en la siguiente pasada.
            // ponytail: reutiliza la bandera del aviso al cliente (un solo push).
            if (!row.avisoPospuestoEnviado) {
              row.avisoPospuestoEnviado = true
              await row.useTransaction(trx).save()
              conductorPospuestoId = row.conductorId
            }
            return null
          }

          if (habilitado && !ocupado) {
            row.estado = 'aceptado'
            row.aceptadoAt = DateTime.now()
            row.activacionAt = DateTime.now()
            await row.useTransaction(trx).save()
            conductorAsignadoId = row.conductorId
            return row
          }

          // Conductor inhabilitado o sin desocuparse a la hora: se libera la
          // reserva y sigue el flujo normal de búsqueda.
          conductorLiberadoId = row.conductorId
          await Oferta.query({ client: trx })
            .where('viaje_id', row.id)
            .where('estado', 'aceptada')
            .update({ estado: 'cancelada' })
          row.conductorId = null
          row.precioFinal = null
          row.pinEntrega = null
        }

        row.estado = 'buscando_conductor'
        // activacion_at pasa a ser el momento real en que inició la búsqueda
        // (el scheduler pudo activarla tarde); el vencimiento de la búsqueda
        // (BusquedaTimeoutService) cuenta desde aquí.
        row.activacionAt = DateTime.now()
        await row.useTransaction(trx).save()
        return row
      })

      if (!viaje) {
        if (pospuesta && clienteIdPospuesta) {
          const cliente = await User.find(clienteIdPospuesta)
          if (cliente?.fcmToken) {
            await sendToToken(
              cliente.fcmToken,
              'Reserva pospuesta',
              'Tu reserva empieza cuando termine tu envío actual.'
            )
          }
        }
        if (conductorPospuestoId) {
          const token = await tokenDelConductor(conductorPospuestoId)
          const hora = (await Viaje.find(viajeId))?.horaProgramada ?? ''
          if (token) {
            await sendToToken(
              token,
              'Termina tu viaje actual',
              `Termina tu viaje actual: tu reserva empieza a las ${hora}.`,
              { tipo: 'reserva', viajeId: String(viajeId) }
            )
          }
        }
        return 'omitida'
      }

      if (conductorAsignadoId) {
        const conductor = await Conductor.find(conductorAsignadoId)
        emitTripStatusChanged(viaje.clienteId, conductor?.usuarioId, {
          id: String(viaje.id),
          estado: 'aceptado',
        })
        emitTripUpdateToModerators(viaje)
        const datos = { tipo: 'viaje_estado', viajeId: String(viaje.id) }
        const tokenConductor = await tokenDelConductor(conductorAsignadoId)
        if (tokenConductor) {
          await sendToToken(tokenConductor, 'Tu reserva empieza', 'Tu reserva empieza: sal hacia el origen.', datos)
        }
        const cliente = await User.find(viaje.clienteId)
        if (cliente?.fcmToken) {
          await sendToToken(
            cliente.fcmToken,
            'Tu reserva empieza',
            'Tu conductor va en camino a recoger tu carga.',
            datos
          )
        }
        return 'activada'
      }

      if (conductorLiberadoId) {
        const token = await tokenDelConductor(conductorLiberadoId)
        if (token) {
          await sendToToken(
            token,
            'Reserva liberada',
            `Perdiste la reserva del ${viaje.fechaProgramada} ${viaje.horaProgramada}: se asignará a otro conductor.`,
            { tipo: 'reserva', viajeId: String(viaje.id) }
          )
        }
      }

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
