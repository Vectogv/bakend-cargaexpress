import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

export default class ModeratorMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const user = await ctx.auth.getUserOrFail()

    if (!user.esModerador && user.rol !== 'admin') {
      return ctx.response.status(403).send({ error: 'Acceso denegado' })
    }

    // Un moderador sin ciudad asignada vería datos de todas las ciudades: se bloquea.
    if (user.rol !== 'admin' && !user.zonaModerador?.trim()) {
      return ctx.response.status(403).send({ error: 'No tienes ciudad asignada. Contacta al administrador.' })
    }

    return next()
  }
}
