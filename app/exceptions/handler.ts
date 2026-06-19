import app from '@adonisjs/core/services/app'
import { type HttpContext, ExceptionHandler } from '@adonisjs/core/http'
import { errors as authErrors } from '@adonisjs/auth'
import { errors as lucidErrors } from '@adonisjs/lucid'
import SentryService from '#services/sentry_service'
import MetricsService from '#services/metrics_service'
import logger from '@adonisjs/core/services/logger'

export default class HttpExceptionHandler extends ExceptionHandler {
  protected debug = !app.inProduction

  async handle(error: unknown, ctx: HttpContext) {
    if (error instanceof authErrors.E_UNAUTHORIZED_ACCESS) {
      return ctx.response.status(401).send({
        errors: [{ message: 'Token inválido o expirado. Vuelve a iniciar sesión.' }],
      })
    }

    if (error instanceof lucidErrors.E_ROW_NOT_FOUND) {
      return ctx.response.status(404).send({
        errors: [{ message: 'Recurso no encontrado.' }],
      })
    }

    return super.handle(error, ctx)
  }

  async report(error: unknown, ctx: HttpContext) {
    const err = error as any
    MetricsService.incErrors(err?.name || 'Unknown')

    SentryService.captureException(error, {
      method: ctx.request.method(),
      url: ctx.request.url(),
      userId: ctx.auth?.user?.id,
      userRol: ctx.auth?.user?.rol,
    })

    logger.error({
      err: error,
      method: ctx.request.method(),
      url: ctx.request.url(),
      userId: ctx.auth?.user?.id,
    }, 'Unhandled exception')

    return super.report(error, ctx)
  }
}
