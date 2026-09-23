import { BaseCommand } from '@adonisjs/core/ace'
import DriverDebtSuspensionService from '#services/driver_debt_suspension_service'

/**
 * Suspensión por pago de conductores con deuda de comisión vencida. El
 * scheduler interno (reservation_scheduler_provider) ya lo ejecuta cada minuto;
 * este comando sirve para correrlo a mano o desde un cron externo.
 */
export default class SuspendOverdueDebts extends BaseCommand {
  static commandName = 'debts:suspend'
  static description = 'Suspend drivers whose commission debt is past its due date'

  async run() {
    const suspendidos = await DriverDebtSuspensionService.suspenderVencidos()
    if (suspendidos.length === 0) {
      this.logger.info('No overdue driver debts')
      return
    }
    this.logger.info(`Suspended ${suspendidos.length} drivers for overdue debt`)
  }
}
