import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Conductor from './conductor.js'

export default class UbicacionDriver extends BaseModel {
  static table = 'ubicaciones_drivers'
  static $columns = ['id', 'conductorId', 'lat', 'lng', 'createdAt'] as const
  $columns = UbicacionDriver.$columns

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare conductorId: number

  @column()
  declare lat: number

  @column()
  declare lng: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => Conductor, { foreignKey: 'conductorId' })
  declare conductor: BelongsTo<typeof Conductor>
}
