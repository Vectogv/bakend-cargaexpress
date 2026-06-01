import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import User from './user.js'
import RespuestaEncuesta from './respuesta_encuesta.js'

export default class Encuesta extends BaseModel {
  static table = 'encuestas'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare moderadorId: number

  @column()
  declare zona: string

  @column()
  declare pregunta: string

  @column()
  declare opciones: any

  @column()
  declare estado: string

  @column.dateTime()
  declare fechaCierre: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => User, { foreignKey: 'moderadorId' })
  declare moderador: BelongsTo<typeof User>

  @hasMany(() => RespuestaEncuesta, { foreignKey: 'encuestaId' })
  declare respuestas: HasMany<typeof RespuestaEncuesta>
}
