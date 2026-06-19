import type { HttpContext } from '@adonisjs/core/http'
import type { NextFn } from '@adonisjs/core/types/http'
import MetricsService from '#services/metrics_service'

export default class MetricsMiddleware {
  async handle(ctx: HttpContext, next: NextFn) {
    const start = Date.now()
    const method = ctx.request.method()
    const route = ctx.route?.pattern || ctx.request.url()

    try {
      await next()
    } finally {
      const duration = Date.now() - start
      const status = ctx.response.getStatus()
      MetricsService.observeHttp(method, route, status, duration)
    }
  }
}
