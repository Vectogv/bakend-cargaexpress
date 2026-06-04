import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

export interface RateLimitConfig {
  max: number
  windowMs: number
}

export default class RateLimitMiddleware {
  private store = new Map<string, { count: number; resetAt: number }>()

  async handle(ctx: HttpContext, next: NextFn, args: RateLimitConfig = { max: 10, windowMs: 60_000 }) {
    const ip = ctx.request.ip()
    const now = Date.now()

    let entry = this.store.get(ip)
    if (!entry || now > entry.resetAt) {
      entry = { count: 0, resetAt: now + args.windowMs }
      this.store.set(ip, entry)
    }

    entry.count++

    if (entry.count > args.max) {
      return ctx.response.status(429).send({ error: 'Demasiadas solicitudes. Intenta de nuevo más tarde.' })
    }

    return next()
  }
}
