import { HttpContext } from '@adonisjs/core/http'

export default class CorsMiddleware {
  async handle({ request, response }: HttpContext, next: () => Promise<void>) {
    const origin = request.header('origin') || '*'

    response.header('Access-Control-Allow-Origin', origin)
    response.header('Access-Control-Allow-Methods', 'GET, HEAD, POST, PUT, PATCH, DELETE')
    response.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With')
    response.header('Access-Control-Allow-Credentials', 'true')
    response.header('Access-Control-Max-Age', '90')

    if (request.method() === 'OPTIONS') {
      return response.status(204).send(null)
    }

    await next()
  }
}
