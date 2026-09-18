import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import AlertaEmergencia from './alerta_emergencia.js'
import User from './user.js'

export default class MensajeEmergencia extends BaseModel {
  static table = 'mensajes_emergencia'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare alertaId: number

  @column()
  declare remitenteId: number

  @column()
  declare mensaje: string

  @column()
  declare leido: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => AlertaEmergencia)
  declare alerta: BelongsTo<typeof AlertaEmergencia>

  @belongsTo(() => User, { foreignKey: 'remitenteId' })
  declare remitente: BelongsTo<typeof User>
}