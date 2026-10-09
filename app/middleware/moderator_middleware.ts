import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import { claveDe } from '#services/coverage_service'

export default class ModeratorMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const user = await ctx.auth.getUserOrFail()

    if (!user.esModerador && user.rol !== 'admin') {
      return ctx.response.status(403).send({ error: 'Acceso denegado' })
    }

    // Un moderador sin ciudad asignada vería datos de todas las ciudades: se bloquea.
    // 'general' no es una ciudad: la web lo lee como toda la operación (solo admin).
    if (user.rol !== 'admin' && (!user.zonaModerador?.trim() || claveDe(user.zonaModerador) === 'general')) {
      return ctx.response.status(403).send({ error: 'No tienes ciudad asignada. Contacta al administrador.' })
    }

    return next()
  }
}
