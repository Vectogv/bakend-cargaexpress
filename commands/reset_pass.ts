import { BaseCommand } from '@adonisjs/core/ace'
import User from '#models/user'
import hash from '@adonisjs/core/services/hash'

export default class ResetPass extends BaseCommand {
  static commandName = 'reset:pass'
  static description = 'Reset password for users 1 and 2'

  async run() {
    const u1 = await User.find(1)
    const u2 = await User.find(2)
    if (u1) { u1.password = await hash.make('diego1210'); await u1.save(); this.logger.info('User 1 OK') }
    if (u2) { u2.password = await hash.make('diego1210'); await u2.save(); this.logger.info('User 2 OK') }
  }
}
