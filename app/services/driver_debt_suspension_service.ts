import { DateTime } from 'luxon'
import logger from '@adonisjs/core/services/logger'
import User from '#models/user'
import Conductor from '#models/conductor'
import Notificacion from '#models/notificacion'
import { sendToToken } from '#services/push_notification_service'
import { emitToDriver } from '#start/socket'

/** Estados de cuenta en los que el conductor no puede conectarse ni ofertar. */
export const ESTADOS_SUSPENSION_PAGO = ['suspension_por_pago', 'esperando_confirmacion'] as const

export const CODIGO_SUSPENSION_PAGO = 'CUENTA_SUSPENDIDA_POR_PAGO'

/**
 * Suspensión por pago de conductores: la comisión de cada viaje se acumula en
 * `monto_deuda` con una fecha límite (`deuda_fecha_limite`, 15 días desde el
 * primer viaje sin pagar). Si vence sin pagar, la cuenta pasa a
 * `suspension_por_pago`: puede subir el comprobante (`POST /api/payment/proof`)
 * pero no conectarse ni ofertar hasta que el admin apruebe el pago.
 *
 * Lo usa el scheduler interno (cada minuto) y `node ace debts:suspend`.
 * Seguro con varias réplicas: cada usuario se actualiza con
 * `WHERE id = ? AND estado_cuenta = 'activa'`, así solo quien lo cambia de
 * verdad lo pone offline y lo notifica.
 *
 * La deuda de clientes (acuerdo de pago de disputas) no pasa por aquí.
 */
export default class DriverDebtSuspensionService {
  /** Suspende a los conductores con deuda vencida y devuelve los ids suspendidos. */
  static async suspenderVencidos(): Promise<number[]> {
    const ahora = DateTime.now().toSQL()!
    const candidatos = await User.query()
      .where('rol', 'conductor')
      .where('estado_cuenta', 'activa')
      .where('monto_deuda', '>', 0)
      .whereNotNull('deuda_fecha_limite')
      .where('deuda_fecha_limite', '<', ahora)

    const suspendidos: number[] = []
    for (const candidato of candidatos) {
      try {
        const resultado = await User.query()
          .where('id', candidato.id)
          .where('rol', 'conductor')
          .where('estado_cuenta', 'activa')
          .where('monto_deuda', '>', 0)
          .where('deuda_fecha_limite', '<', ahora)
          .update({ estado_cuenta: 'suspension_por_pago' })
        const filas = Array.isArray(resultado) ? Number(resultado[0]) : Number(resultado)
        if (filas !== 1) continue

        suspendidos.push(candidato.id)
        await this.notificar(candidato)
      } catch (err) {
        logger.error({ err, userId: candidato.id }, 'DriverDebtSuspensionService: fallo suspendiendo')
      }
    }
    return suspendidos
  }

  /** Respuesta 403 si la cuenta está suspendida por pago; `null` si puede operar. */
  static bloqueo(user: Pick<User, 'estadoCuenta'>) {
    if (user.estadoCuenta === 'suspension_por_pago') {
      return {
        error:
          'Tu cuenta está suspendida por falta de pago de la comisión. Sube el comprobante de pago para reactivarla.',
        code: CODIGO_SUSPENSION_PAGO,
        estadoCuenta: user.estadoCuenta,
      }
    }
    if (user.estadoCuenta === 'esperando_confirmacion') {
      return {
        error:
          'Tu comprobante de pago está en revisión. Podrás conectarte y ofertar cuando el administrador lo apruebe.',
        code: CODIGO_SUSPENSION_PAGO,
        estadoCuenta: user.estadoCuenta,
      }
    }
    return null
  }

  static estaSuspendido(estadoCuenta: string | null | undefined) {
    return (ESTADOS_SUSPENSION_PAGO as readonly string[]).includes(estadoCuenta ?? '')
  }

  private static async notificar(user: User) {
    await Conductor.query().where('usuario_id', user.id).update({ online: false })

    const monto = Number(user.montoDeuda) || 0
    const titulo = 'Cuenta suspendida por pago'
    const mensaje = `Tu deuda de comisión de $${monto} venció. No puedes conectarte ni ofertar hasta que subas el comprobante de pago y el administrador lo apruebe.`

    await Notificacion.create({
      usuarioId: user.id,
      tipo: 'suspension_por_pago',
      titulo,
      mensaje,
      leido: false,
    })

    emitToDriver(user.id, 'account:payment_suspended', {
      estadoCuenta: 'suspension_por_pago',
      code: CODIGO_SUSPENSION_PAGO,
      montoDeuda: monto,
      deudaFechaLimite: user.deudaFechaLimite?.toISO() ?? null,
      online: false,
      message: mensaje,
    })

    if (user.fcmToken) {
      try {
        await sendToToken(user.fcmToken, titulo, mensaje)
      } catch (err) {
        logger.warn({ err, userId: user.id }, 'DriverDebtSuspensionService: fallo enviando push')
      }
    }
  }
}
