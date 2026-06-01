import { BaseCommand } from '@adonisjs/core/ace'
import { runBackup } from '#services/backup_service'

export default class RunBackup extends BaseCommand {
  static commandName = 'backup:run'
  static description = 'Run database backup and upload to Google Drive'

  async run() {
    this.logger.info('Starting backup...')
    await runBackup()
    this.logger.info('Backup completed')
  }
}
