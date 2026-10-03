import type { ApplicationService } from '@adonisjs/core/types'

const HORA_MS = 60 * 60 * 1000
const PRIMER_CHEQUEO_MS = 60_000

/**
 * Respaldo diario: cada hora revisa si ya pasaron las 3:00 a. m. (Colombia) y no hay
 * un respaldo exitoso de hoy en `logs_respaldo`; si es así lo ejecuta. Sobrevive a
 * reinicios (mira el log, no un reloj en memoria). Solo en el proceso web: no en
 * tests ni comandos ace. Se apaga con BACKUP_DIARIO=false.
 */
export default class BackupSchedulerProvider {
  private interval: NodeJS.Timeout | null = null
  private primero: NodeJS.Timeout | null = null
  private enCurso = false

  constructor(protected app: ApplicationService) {}

  async ready() {
    if (this.app.getEnvironment() !== 'web') return

    const logger = (await import('@adonisjs/core/services/logger')).default
    const env = (await import('#start/env')).default
    if (env.get('BACKUP_DIARIO', true) === false) {
      logger.info('Respaldo diario desactivado por configuración')
      return
    }

    const chequear = () => {
      this.tick().catch((err) => logger.error({ err }, 'Falló el chequeo del respaldo diario'))
    }
    this.primero = setTimeout(chequear, PRIMER_CHEQUEO_MS)
    this.primero.unref?.()
    this.interval = setInterval(chequear, HORA_MS)
    this.interval.unref?.()
    logger.info('Respaldo diario programado (revisa cada hora, toca desde las 3:00 a. m. Colombia)')
  }

  async shutdown() {
    if (this.primero) clearTimeout(this.primero)
    if (this.interval) clearInterval(this.interval)
    this.primero = this.interval = null
  }

  private async tick() {
    if (this.enCurso) return
    this.enCurso = true
    try {
      const { respaldoDiarioSiToca } = await import('#services/backup_service')
      await respaldoDiarioSiToca()
    } finally {
      this.enCurso = false
    }
  }
}
