import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import RedisService from '#services/redis_service'

export interface RateLimitConfig {
  max: number
  windowMs: number
}

export default class RateLimitMiddleware {
  async handle(ctx: HttpContext, next: NextFn, args: RateLimitConfig = { max: 10, windowMs: 60_000 }) {
    // Contador independiente por ruta y por usuario (o IP si no hay sesión): así
    // enviar ofertas no consume el cupo de finalizar un viaje ni el del login.
    const route = ctx.route?.pattern || ctx.request.url()
    const who = ctx.auth?.user?.id ? `u:${ctx.auth.user.id}` : `ip:${ctx.request.ip()}`
    const key = `ratelimit:${route}:${who}:${Math.floor(Date.now() / args.windowMs)}`

    const result = await RedisService.checkRateLimit(key, args.max, args.windowMs)

    if (!result.allowed) {
      const retryAfter = Math.ceil(result.resetMs / 1000)
      ctx.response.header('Retry-After', String(retryAfter))
      return ctx.response.status(429).send({
        error: 'Demasiadas solicitudes. Intenta de nuevo más tarde.',
        retryAfter,
      })
    }

    return next()
  }
}
