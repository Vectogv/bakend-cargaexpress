import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from './user.js'

export default class Aviso extends BaseModel {
  static table = 'avisos'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare autorId: number

  @column()
  declare zona: string

  @column()
  declare contenido: string

  @column()
  declare fijado: boolean

  @column()
  declare eliminado: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => User, { foreignKey: 'autorId' })
  declare autor: BelongsTo<typeof User>
}
