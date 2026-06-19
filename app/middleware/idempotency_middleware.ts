import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import RedisService from '#services/redis_service'

const TTL_SECONDS = 60

export default class IdempotencyMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const key = ctx.request.header('X-Idempotency-Key') as string | undefined

    if (!key) {
      return next()
    }

    const cached = await RedisService.get(`idempotency:${key}`)
    if (cached) {
      try {
        const { status, body } = JSON.parse(cached)
        return ctx.response.status(status).send(body)
      } catch {
        // ignore parse error, continue
      }
    }

    const response = await next()

    const statusCode = ctx.response.response.statusCode
    if (statusCode >= 200 && statusCode < 500) {
      const body = ctx.response.getBody()
      await RedisService.set(`idempotency:${key}`, JSON.stringify({ status: statusCode, body }), TTL_SECONDS)
    }

    return response
  }
}
