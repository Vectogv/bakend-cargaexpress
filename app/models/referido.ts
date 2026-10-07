import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Conductor from './conductor.js'

/** Un conductor (referidor) invitó a otro (invitado) con su código. Reglas en referidos_service. */
export default class Referido extends BaseModel {
  static table = 'referidos'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare referidorConductorId: number

  @column()
  declare invitadoConductorId: number

  /** pendiente | activo | vencido | anulado */
  @column()
  declare estado: string

  @column.dateTime()
  declare aprobadoEn: DateTime | null

  @column.dateTime()
  declare venceEn: DateTime | null

  @column.dateTime()
  declare activadoEn: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => Conductor, { foreignKey: 'referidorConductorId' })
  declare referidor: BelongsTo<typeof Conductor>

  @belongsTo(() => Conductor, { foreignKey: 'invitadoConductorId' })
  declare invitado: BelongsTo<typeof Conductor>
}
