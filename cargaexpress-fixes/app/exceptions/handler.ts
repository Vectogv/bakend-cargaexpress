import app from '@adonisjs/core/services/app'
import { type HttpContext, ExceptionHandler } from '@adonisjs/core/http'
import { errors as authErrors } from '@adonisjs/auth'
import { errors as lucidErrors } from '@adonisjs/lucid'

export default class HttpExceptionHandler extends ExceptionHandler {
  protected debug = !app.inProduction

  async handle(error: unknown, ctx: HttpContext) {
    // ✅ AGREGADO: respuestas claras para errores comunes en producción
    // sin revelar stack traces al cliente

    // Token inválido o expirado → 401
    if (error instanceof authErrors.E_UNAUTHORIZED_ACCESS) {
      return ctx.response.status(401).send({
        errors: [{ message: 'Token inválido o expirado. Vuelve a iniciar sesión.' }],
      })
    }

    // Modelo no encontrado (findOrFail) → 404
    if (error instanceof lucidErrors.E_ROW_NOT_FOUND) {
      return ctx.response.status(404).send({
        errors: [{ message: 'Recurso no encontrado.' }],
      })
    }

    return super.handle(error, ctx)
  }

  async report(error: unknown, ctx: HttpContext) {
    return super.report(error, ctx)
  }
}
