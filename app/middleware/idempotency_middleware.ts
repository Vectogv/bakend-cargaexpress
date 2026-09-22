import { createHash } from 'node:crypto'
import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import RedisService from '#services/redis_service'

const TTL_SECONDS = 60
const MAX_KEY_LENGTH = 128

export default class IdempotencyMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const key = ctx.request.header('X-Idempotency-Key') as string | undefined

    if (!key || key.length > MAX_KEY_LENGTH) {
      return next()
    }

    // La clave se acota al usuario (token) y a la ruta: nadie puede recibir la
    // respuesta cacheada de otro usuario reutilizando su X-Idempotency-Key.
    const owner = createHash('sha256')
      .update(ctx.request.header('authorization') || ctx.request.ip())
      .digest('hex')
      .slice(0, 32)
    const cacheKey = `idempotency:${owner}:${ctx.request.method()}:${ctx.request.url()}:${key}`

    const cached = await RedisService.get(cacheKey)
    if (cached) {
      try {
        const { status, body } = JSON.parse(cached)
        return ctx.response.status(status).send(body)
      } catch {
        // Entrada corrupta: se procesa la petición normalmente.
      }
    }

    const response = await next()

    const statusCode = ctx.response.response.statusCode
    if (statusCode >= 200 && statusCode < 500) {
      const body = ctx.response.getBody()
      await RedisService.set(cacheKey, JSON.stringify({ status: statusCode, body }), TTL_SECONDS)
    }

    return response
  }
}
