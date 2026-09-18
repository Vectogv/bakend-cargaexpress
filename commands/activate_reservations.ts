import { BaseCommand } from '@adonisjs/core/ace'
import ReservationActivationService from '#services/reservation_activation_service'

export default class ActivateReservations extends BaseCommand {
  static commandName = 'reservations:activate'
  static description =
    'Activa las reservas programadas cuya ventana de búsqueda de conductor ya inició'

  async run() {
    const recordatorios = await ReservationActivationService.enviarRecordatorios()
    if (recordatorios > 0) {
      this.logger.info(`Recordatorios enviados: ${recordatorios}`)
    }

    const reservas = await ReservationActivationService.reservasPorActivar()

    if (reservas.length === 0) {
      this.logger.info('No hay reservas por activar')
      return
    }

    let activadas = 0
    for (const reserva of reservas) {
      const result = await ReservationActivationService.activar(reserva.id)
      if (result === 'activada') activadas++
    }

    this.logger.info(`Reservas activadas: ${activadas}/${reservas.length}`)
  }
}
