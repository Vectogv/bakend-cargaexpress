import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from './user.js'
import Viaje from './viaje.js'

export default class AlertaEmergencia extends BaseModel {
  static table = 'alertas_emergencia'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare viajeId: number | null

  @column()
  declare lat: number | null

  @column()
  declare lng: number | null

  @column()
  declare atendida: boolean

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => User)
  declare usuario: BelongsTo<typeof User>

  @belongsTo(() => Viaje)
  declare viaje: BelongsTo<typeof Viaje>
}
