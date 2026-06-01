import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from './user.js'

export default class Comunicado extends BaseModel {
  static table = 'comunicados'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare moderadorId: number

  @column()
  declare zona: string

  @column()
  declare titulo: string

  @column()
  declare contenido: string

  @column()
  declare estado: string

  @column()
  declare notaRechazo: string | null

  @column.dateTime()
  declare publicadoAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => User, { foreignKey: 'moderadorId' })
  declare moderador: BelongsTo<typeof User>
}
