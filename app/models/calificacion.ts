import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from './user.js'
import Viaje from './viaje.js'

export default class Calificacion extends BaseModel {
  static table = 'calificaciones'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare viajeId: number

  @column()
  declare calificadorId: number

  @column()
  declare calificadoId: number

  @column()
  declare puntaje: number

  @column()
  declare comentario: string | null

  @column()
  declare tipo: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => Viaje)
  declare viaje: BelongsTo<typeof Viaje>

  @belongsTo(() => User, { foreignKey: 'calificadorId' })
  declare calificador: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'calificadoId' })
  declare calificado: BelongsTo<typeof User>
}
