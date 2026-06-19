import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import RedisService from '#services/redis_service'

export interface RateLimitConfig {
  max: number
  windowMs: number
}

export default class RateLimitMiddleware {
  async handle(ctx: HttpContext, next: NextFn, args: RateLimitConfig = { max: 10, windowMs: 60_000 }) {
    const key = `ratelimit:${ctx.request.ip()}:${Math.floor(Date.now() / args.windowMs)}`

    const result = await RedisService.checkRateLimit(key, args.max, args.windowMs)

    if (!result.allowed) {
      return ctx.response.status(429).send({
        error: 'Demasiadas solicitudes. Intenta de nuevo más tarde.',
        retryAfter: Math.ceil(result.resetMs / 1000),
      })
    }

    return next()
  }
}
