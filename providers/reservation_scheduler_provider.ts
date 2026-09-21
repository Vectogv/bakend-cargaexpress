import type { ApplicationService } from '@adonisjs/core/types'

const TICK_MS = 60_000
// El lock dura algo menos que el intervalo para que el siguiente tick pueda tomarlo.
const TICK_LOCK_MS = 55_000

/**
 * Ejecuta cada minuto la activación de reservas programadas.
 *
 * Es seguro con múltiples réplicas (Railway corre 2): un lock distribuido en
 * Redis garantiza que solo una instancia haga el barrido en cada ventana.
 * Si Redis no está disponible, el re-chequeo de estado + FOR UPDATE dentro de
 * ReservationActivationService sigue impidiendo activaciones duplicadas.
 *
 * Se puede deshabilitar con RESERVATION_SCHEDULER_ENABLED=false y usar en su
 * lugar `node ace reservations:activate` desde un cron externo.
 *
 * IMPORTANTE: los módulos de la app se importan de forma diferida. Importar los
 * modelos en el nivel superior del provider (durante el registro) rompe el
 * binding del servicio `hash` de Adonis al cargar `#models/user` antes de que
 * los providers base estén registrados.
 */
export default class ReservationSchedulerProvider {
  private interval: NodeJS.Timeout | null = null

  constructor(protected app: ApplicationService) {}

  async ready() {
    if (this.app.getEnvironment() === 'test') return

    const logger = (await import('@adonisjs/core/services/logger')).default
    const env = (await import('#start/env')).default

    if (env.get('RESERVATION_SCHEDULER_ENABLED', true) === false) {
      logger.info('Reservation scheduler disabled by config')
      return
    }

    this.interval = setInterval(() => {
      this.tick().catch((err) => logger.error({ err }, 'reservation scheduler tick failed'))
    }, TICK_MS)
    this.interval.unref?.()
    logger.info('Reservation scheduler started (every 60s)')
  }

  async shutdown() {
    if (this.interval) clearInterval(this.interval)
    this.interval = null
  }

  private async tick() {
    const logger = (await import('@adonisjs/core/services/logger')).default

    try {
      const { default: RedisService } = await import('#services/redis_service')
      const { default: ReservationActivationService } = await import(
        '#services/reservation_activation_service'
      )
      const { default: ConfirmacionTimeoutService } = await import(
        '#services/confirmacion_timeout_service'
      )

      const acquired = await RedisService.acquireLock('reservation:scheduler:tick', TICK_LOCK_MS)
      if (!acquired) return

      try {
        await ReservationActivationService.enviarRecordatorios()

        const reservas = await ReservationActivationService.reservasPorActivar()
        for (const reserva of reservas) {
          await ReservationActivationService.activar(reserva.id)
        }

        // H1: Notificar al moderador de zona cuando un cierre quedó sin confirmar por el cliente.
        await ConfirmacionTimeoutService.notificarConfirmacionesVencidas()
      } finally {
        await RedisService.releaseLock('reservation:scheduler:tick')
      }
    } catch (err) {
      logger.error({ err }, 'reservation scheduler tick failed')
    }
  }
}
