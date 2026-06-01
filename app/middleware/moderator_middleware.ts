import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

export default class ModeratorMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const user = await ctx.auth.getUserOrFail()

    if (!user.esModerador) {
      return ctx.response.status(403).send({ error: 'Acceso denegado' })
    }

    return next()
  }
}
