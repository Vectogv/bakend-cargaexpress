import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import Referido from './referido.js'

/** Descuento de comisión ganado por el programa de referidos (invitado o referidor). */
export default class CuponComision extends BaseModel {
  static table = 'cupones_comision'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare conductorId: number

  @column()
  declare referidoId: number

  /** invitado | referidor */
  @column()
  declare tipo: string

  /** Comisión (%) que se cobra en los viajes cubiertos por el cupón. */
  @column({ consume: (v: unknown) => Number(v) })
  declare pct: number

  @column()
  declare usosRestantes: number

  @column.dateTime()
  declare venceEn: DateTime | null

  /** activo | anulado */
  @column()
  declare estado: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => Referido, { foreignKey: 'referidoId' })
  declare referido: BelongsTo<typeof Referido>

  get vigente(): boolean {
    return this.estado === 'activo' && this.usosRestantes > 0 && (!this.venceEn || this.venceEn > DateTime.now())
  }
}
