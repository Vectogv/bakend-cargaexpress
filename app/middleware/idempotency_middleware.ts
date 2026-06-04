import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'

export default class IdempotencyMiddleware {
  private store = new Map<string, { status: number; body: unknown }>()

  async handle(ctx: HttpContext, next: NextFn) {
    const key = ctx.request.header('X-Idempotency-Key') as string | undefined

    if (!key) {
      return next()
    }

    const existing = this.store.get(key)
    if (existing) {
      return ctx.response.status(existing.status).send(existing.body)
    }

    const response = await next()

    if (ctx.response.response.statusCode >= 200 && ctx.response.response.statusCode < 500) {
      this.store.set(key, {
        status: ctx.response.response.statusCode,
        body: ctx.response.getBody(),
      })

      setTimeout(() => this.store.delete(key), 60_000)
    }

    return response
  }
}
