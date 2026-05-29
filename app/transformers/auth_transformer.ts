import type User from '#models/user'
import { BaseTransformer } from '@adonisjs/core/transformers'

export default class AuthTransformer extends BaseTransformer<User> {
  toObject() {
    const user = this.resource
    return {
      id: String(user.id),
      nombre: user.nombre,
      apellido: user.apellido,
      email: user.email,
      rol: user.rol,
    }
  }
}
