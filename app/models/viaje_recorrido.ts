import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Viaje from './viaje.js'

/** Punto real del conductor durante un viaje (ver viaje_recorrido_service). */
export default class ViajeRecorrido extends BaseModel {
  static table = 'viaje_recorrido'
  static $columns = ['id', 'viajeId', 'lat', 'lng', 'createdAt'] as const
  $columns = ViajeRecorrido.$columns

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare viajeId: number

  @column({ consume: (v) => Number(v) })
  declare lat: number

  @column({ consume: (v) => Number(v) })
  declare lng: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => Viaje, { foreignKey: 'viajeId' })
  declare viaje: BelongsTo<typeof Viaje>
}
