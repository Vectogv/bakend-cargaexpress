import { BaseCommand } from '@adonisjs/core/ace'
import OfferExpiryService from '#services/offer_expiry_service'

/**
 * Barrido manual de ofertas vencidas. El scheduler interno
 * (reservation_scheduler_provider) ya lo ejecuta cada 30 s; este comando sirve
 * para correrlo a mano o desde un cron externo.
 */
export default class ExpireOffers extends BaseCommand {
  static commandName = 'offers:expire'
  static description = 'Expire pending offers whose expira_at has passed'

  async run() {
    const expiradas = await OfferExpiryService.expirarVencidas()
    if (expiradas.length === 0) {
      this.logger.info('No expired offers to process')
      return
    }
    this.logger.info(`Expired ${expiradas.length} offers`)
  }
}
