import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Conversacion from './conversacion.js'
import User from './user.js'

export default class MensajeConversacion extends BaseModel {
  static table = 'mensajes_conversacion'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare conversacionId: number

  @column()
  declare remitenteId: number

  @column()
  declare mensaje: string

  @column()
  declare leido: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => Conversacion)
  declare conversacion: BelongsTo<typeof Conversacion>

  @belongsTo(() => User, { foreignKey: 'remitenteId' })
  declare remitente: BelongsTo<typeof User>
}