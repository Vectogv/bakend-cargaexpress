import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import type { Authenticators } from '@adonisjs/auth/types'

/**
 * Auth middleware is used authenticate HTTP requests and deny
 * access to unauthenticated users.
 */
export default class AuthMiddleware {
  async handle(
    ctx: HttpContext,
    next: NextFn,
    options: {
      guards?: (keyof Authenticators)[]
    } = {}
  ) {
    await ctx.auth.authenticateUsing(options.guards)

    // Una cuenta suspendida pierde el acceso aunque conserve un token válido.
    const user = ctx.auth.user as { suspendido?: boolean } | undefined
    if (user?.suspendido) {
      return ctx.response.status(403).send({
        code: 'CUENTA_SUSPENDIDA',
        errors: [{ message: 'Tu cuenta ha sido suspendida. Contacta al administrador.' }],
      })
    }

    return next()
  }
}
