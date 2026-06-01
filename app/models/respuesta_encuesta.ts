import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Encuesta from './encuesta.js'
import Conductor from './conductor.js'

export default class RespuestaEncuesta extends BaseModel {
  static table = 'respuestas_encuesta'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare encuestaId: number

  @column()
  declare conductorId: number

  @column()
  declare opcionElegida: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => Encuesta, { foreignKey: 'encuestaId' })
  declare encuesta: BelongsTo<typeof Encuesta>

  @belongsTo(() => Conductor, { foreignKey: 'conductorId' })
  declare conductor: BelongsTo<typeof Conductor>
}
