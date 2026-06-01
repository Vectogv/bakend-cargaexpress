import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Viaje from './viaje.js'
import User from './user.js'

export default class MensajeChat extends BaseModel {
  static table = 'mensajes_chat'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare viajeId: number

  @column()
  declare remitenteId: number

  @column()
  declare mensaje: string

  @column()
  declare leido: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => Viaje)
  declare viaje: BelongsTo<typeof Viaje>

  @belongsTo(() => User, { foreignKey: 'remitenteId' })
  declare remitente: BelongsTo<typeof User>
}
