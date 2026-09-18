import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import User from './user.js'
import Viaje from './viaje.js'
import MensajeConversacion from './mensaje_conversacion.js'

export default class Conversacion extends BaseModel {
  static table = 'conversaciones'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare moderadorId: number

  @column()
  declare usuarioId: number

  @column()
  declare viajeId: number | null

  @column()
  declare ciudad: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => User, { foreignKey: 'moderadorId' })
  declare moderador: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'usuarioId' })
  declare usuario: BelongsTo<typeof User>

  @belongsTo(() => Viaje)
  declare viaje: BelongsTo<typeof Viaje>

  @hasMany(() => MensajeConversacion, { foreignKey: 'conversacionId' })
  declare mensajes: HasMany<typeof MensajeConversacion>
}