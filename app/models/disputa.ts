import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Viaje from './viaje.js'
import Conductor from './conductor.js'
import User from './user.js'

export default class Disputa extends BaseModel {
  static table = 'disputas'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare viajeId: number

  @column()
  declare conductorId: number

  @column()
  declare clienteId: number

  @column()
  declare versionConductor: string

  @column()
  declare versionCliente: string | null

  @column()
  declare soporteCliente: string | null

  @column()
  declare estado: string

  @column()
  declare resultado: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime()
  declare resueltaAt: DateTime | null

  @belongsTo(() => Viaje)
  declare viaje: BelongsTo<typeof Viaje>

  @belongsTo(() => Conductor)
  declare conductor: BelongsTo<typeof Conductor>

  @belongsTo(() => User, { foreignKey: 'clienteId' })
  declare cliente: BelongsTo<typeof User>
}
