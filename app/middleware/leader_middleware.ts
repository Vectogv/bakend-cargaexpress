import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

export default class LeaderMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const user = ctx.auth.user

    if (!user) {
      return ctx.response.status(401).send({ error: 'No autenticado' })
    }

    if (!user.$original || !(user.$original as Record<string, unknown>).esLider) {
      return ctx.response.status(403).send({ error: 'Acceso denegado. Se requiere rol de líder.' })
    }

    return next()
  }
}
