import { BaseCommand } from '@adonisjs/core/ace'
import User from '#models/user'
import { DateTime } from 'luxon'
import { sendToToken } from '#services/push_notification_service'
import { emitToAdmin } from '#start/socket'

export default class CheckExpiredDebts extends BaseCommand {
  static commandName = 'check:expired-debts'
  static description = 'Check for expired debts and ban users or send reminders'

  async run() {
    const now = DateTime.now()

    const deudores = await User.query()
      .whereIn('estado_cuenta', ['suspension_por_pago', 'esperando_confirmacion'])
      .whereNotNull('deuda_fecha_limite')
      .whereNotNull('monto_deuda')

    for (const user of deudores) {
      if (!user.deudaFechaLimite) continue
      const diasRestantes = Math.ceil(user.deudaFechaLimite.diff(now, 'days').days)

      // 2 days warning
      if (diasRestantes === 2) {
        if (user.fcmToken) {
          await sendToToken(
            user.fcmToken,
            'Deuda próxima a vencer',
            `Te quedan ${diasRestantes} días para pagar tu deuda de $${user.montoDeuda}. Realiza el pago antes de que venza.`
          )
        }
        continue
      }

      // Expired
      if (diasRestantes <= 0) {
        // If esperando_confirmacion, don't ban, admin handles it
        if (user.estadoCuenta === 'esperando_confirmacion') {
          continue
        }

        user.estadoCuenta = 'baneada'
        user.suspendido = true
        await user.save()

        emitToAdmin('admin:user_banned', {
          userId: user.id,
          nombre: `${user.nombre} ${user.apellido}`.trim(),
          motivo: 'Deuda vencida',
        })

        this.logger.info(`User ${user.id} banned for expired debt`)
      }
    }

    this.logger.info('Expired debt check completed')
  }
}
