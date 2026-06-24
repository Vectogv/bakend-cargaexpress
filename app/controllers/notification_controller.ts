import Notificacion from '#models/notificacion'
import type { HttpContext } from '@adonisjs/core/http'
import NotificacionTransformer from '#transformers/notificacion_transformer'
import { ApiOperation, ApiResponse } from '@foadonis/openapi/decorators'

export default class NotificationController {
  @ApiOperation({
    summary: 'List notifications',
    description: 'Returns all notifications for the authenticated user',
  })
  @ApiResponse({ type: 'array' })
  async index({ auth, request, serialize }: HttpContext) {
    const user = auth.getUserOrFail()
    const page = Number.parseInt(request.input('page', '1'))
    const limit = Number.parseInt(request.input('limit', '20'))
    const notificaciones = await Notificacion.query()
      .where('usuario_id', user.id)
      .orderBy('createdAt', 'desc')
      .paginate(page, limit)

    return serialize.withoutWrapping(
      notificaciones.all().map((n) => NotificacionTransformer.transform(n))
    )
  }

  @ApiOperation({
    summary: 'Mark notification as read',
    description: 'Marks a specific notification as read',
  })
  @ApiResponse({ type: 'object' })
  async read({ params, serialize }: HttpContext) {
    const notificacion = await Notificacion.findOrFail(params.id)
    notificacion.leido = true
    await notificacion.save()

    return serialize.withoutWrapping({ id: String(notificacion.id), leido: notificacion.leido })
  }
}
