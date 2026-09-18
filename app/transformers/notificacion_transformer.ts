import type Notificacion from '#models/notificacion'
import { BaseTransformer } from '@adonisjs/core/transformers'

export default class NotificacionTransformer extends BaseTransformer<Notificacion> {
  toObject() {
    const n = this.resource
    return {
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
    }
  }
}
