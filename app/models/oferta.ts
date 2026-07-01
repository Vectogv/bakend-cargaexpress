import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Conductor from './conductor.js'
import Viaje from './viaje.js'

export default class Oferta extends BaseModel {
  static table = 'ofertas'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare viajeId: number

  @column()
  declare conductorId: number

  @column()
  declare monto: number

  @column()
  declare estado: string

  @column.dateTime()
  declare expiraAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => Conductor, { foreignKey: 'conductorId' })
  declare conductor: BelongsTo<typeof Conductor>

  @belongsTo(() => Viaje, { foreignKey: 'viajeId' })
  declare viaje: BelongsTo<typeof Viaje>
}
