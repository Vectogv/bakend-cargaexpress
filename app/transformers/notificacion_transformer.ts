import type Notificacion from '#models/notificacion'
import { BaseTransformer } from '@adonisjs/core/transformers'

export default class NotificacionTransformer extends BaseTransformer<Notificacion> {
  toObject() {
    const n = this.resource
    return {
      id: String(n.id),
      tipo: n.tipo,
      titulo: n.titulo,
      mensaje: n.mensaje,
      leido: n.leido,
      createdAt: n.createdAt,
    }
  }
}
