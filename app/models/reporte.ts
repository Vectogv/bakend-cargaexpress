import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Viaje from './viaje.js'
import Conductor from './conductor.js'
import User from './user.js'

export default class Reporte extends BaseModel {
  static table = 'reportes'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare viajeId: number

  @column()
  declare conductorId: number

  @column()
  declare clienteId: number

  @column()
  declare motivo: string

  @column()
  declare descripcion: string | null

  @column()
  declare estado: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => Viaje, { foreignKey: 'viajeId' })
  declare viaje: BelongsTo<typeof Viaje>

  @belongsTo(() => Conductor, { foreignKey: 'conductorId' })
  declare conductor: BelongsTo<typeof Conductor>

  @belongsTo(() => User, { foreignKey: 'clienteId' })
  declare cliente: BelongsTo<typeof User>
}
