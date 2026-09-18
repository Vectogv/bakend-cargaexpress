import Notificacion from '#models/notificacion'
import type { HttpContext } from '@adonisjs/core/http'
import { emitToUser } from '#start/socket'
import { ApiOperation, ApiResponse } from '@foadonis/openapi/decorators'

export default class NotificationController {
  @ApiOperation({
    summary: 'Listar notificaciones',
    description: 'Devuelve todas las notificaciones del usuario autenticado',
  })
  @ApiResponse({ type: 'array' })
  async index({ auth, request }: HttpContext) {
    const user = auth.getUserOrFail()
    const page = Number.parseInt(request.input('page', '1'))
    const limit = Number.parseInt(request.input('limit', '20'))
    const notificaciones = await Notificacion.query()
      .where('usuario_id', user.id)
      .orderBy('createdAt', 'desc')
      .paginate(page, limit)

    return notificaciones.all().map((n) => ({
      id: String(n.id),
      _id: String(n.id),
      tipo: n.tipo,
      type: n.tipo,
      titulo: n.titulo,
      title: n.titulo,
      mensaje: n.mensaje,
      body: n.mensaje,
      leido: n.leido,
      read: n.leido,
      createdAt: n.createdAt,
    }))
  }

  @ApiOperation({
    summary: 'Crear notificación',
    description: 'Crea una nueva notificación para el usuario autenticado',
  })
  @ApiResponse({ type: 'object' })
  async store({ auth, request, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const payload = request.only(['tipo', 'titulo', 'mensaje'])

    const notificacion = await Notificacion.create({
      usuarioId: user.id,
      tipo: payload.tipo,
      titulo: payload.titulo,
      mensaje: payload.mensaje ?? null,
      leido: false,
    })

    return response.created({
      id: String(notificacion.id),
      _id: String(notificacion.id),
      tipo: notificacion.tipo,
      type: notificacion.tipo,
      titulo: notificacion.titulo,
      title: notificacion.titulo,
      mensaje: notificacion.mensaje,
      body: notificacion.mensaje,
      leido: notificacion.leido,
      read: notificacion.leido,
      createdAt: notificacion.createdAt,
    })
  }

  @ApiOperation({
    summary: 'Marcar notificación como leída',
    description: 'Marca una notificación específica como leída',
  })
  @ApiResponse({ type: 'object' })
  async read({ auth, params, serialize, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const notificacion = await Notificacion.find(params.id)
    if (!notificacion || notificacion.usuarioId !== user.id) {
      return response.status(404).json({ error: 'Notificación no encontrada' })
    }
    notificacion.leido = true
    await notificacion.save()

    // F escucha `notification:read` para refrescar el badge in-app.
    emitToUser(user.id, 'notification:read', {
      id: String(notificacion.id),
      _id: String(notificacion.id),
      leido: true,
      read: true,
    })

    return serialize.withoutWrapping({ id: String(notificacion.id), leido: notificacion.leido })
  }

  @ApiOperation({
    summary: 'Eliminar notificación',
    description: 'Elimina una notificación del usuario autenticado',
  })
  @ApiResponse({ type: 'object' })
  async destroy({ auth, params, response }: HttpContext) {
    const user = auth.getUserOrFail()
    const notificacion = await Notificacion.find(params.id)
    if (!notificacion || notificacion.usuarioId !== user.id) {
      return response.status(404).json({ error: 'Notificación no encontrada' })
    }

    const notificacionId = String(notificacion.id)
    await notificacion.delete()

    try {
      emitToUser(user.id, 'notification:delete', {
        id: notificacionId,
        _id: notificacionId,
      })
    } catch {
      // ignore socket errors
    }

    return response.noContent()
  }
}
