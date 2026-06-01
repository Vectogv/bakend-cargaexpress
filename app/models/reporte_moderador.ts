import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from './user.js'
import Conductor from './conductor.js'

export default class ReporteModerador extends BaseModel {
  static table = 'reportes_moderador'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare moderadorId: number

  @column()
  declare conductorId: number

  @column()
  declare descripcion: string

  @column()
  declare estado: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => User, { foreignKey: 'moderadorId' })
  declare moderador: BelongsTo<typeof User>

  @belongsTo(() => Conductor, { foreignKey: 'conductorId' })
  declare conductor: BelongsTo<typeof Conductor>
}
