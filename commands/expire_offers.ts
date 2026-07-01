import { BaseCommand } from '@adonisjs/core/ace'
import Oferta from '#models/oferta'
import Viaje from '#models/viaje'
import { DateTime } from 'luxon'
import { getIO } from '#start/socket'

export default class ExpireOffers extends BaseCommand {
  static commandName = 'offers:expire'
  static description = 'Expire pending offers older than 28 seconds'

  async run() {
    const now = DateTime.now()
    const expiradas = await Oferta.query()
      .where('estado', 'pendiente')
      .whereNotNull('expira_at')
      .where('expira_at', '<', now.toISO())

    if (expiradas.length === 0) {
      this.logger.info('No expired offers to process')
      return
    }

    for (const oferta of expiradas) {
      oferta.estado = 'expirada'
      await oferta.save()

      try {
        const io = getIO()
        io.to(`driver:${oferta.conductor?.usuarioId}`).emit('offer:expired', {
          ofertaId: String(oferta.id),
          viajeId: String(oferta.viajeId),
        })
      } catch { /* no crítico */ }
    }

    this.logger.info(`Expired ${expiradas.length} offers`)
  }
}
