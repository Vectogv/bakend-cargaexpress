import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import { getIO } from '#start/socket'
import type User from '#models/user'

/**
 * Invalida todas las sesiones de un usuario: access tokens, refresh tokens y
 * sockets abiertos. Usar al suspender, cambiar contraseña o eliminar la cuenta.
 */
export default class SessionService {
  static async revokeAll(user: User): Promise<void> {
    await db.from('auth_access_tokens').where('tokenable_id', user.id).delete()
    await db.from('refresh_tokens').where('user_id', user.id).delete()

    try {
      getIO().in(`user:${user.id}`).disconnectSockets(true)
    } catch (err) {
      // Socket.io puede no estar inicializado (tests/CLI); los tokens ya quedaron revocados.
      logger.warn({ err, userId: user.id }, 'No se pudieron cerrar los sockets del usuario')
    }
  }
}
