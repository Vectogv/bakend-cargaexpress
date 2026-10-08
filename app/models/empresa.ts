import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import User from './user.js'

/** Cuenta de empresa de un cliente (dueño) con sus empleados (`users.empresa_id`). Reglas en empresa_service. */
export default class Empresa extends BaseModel {
  static table = 'empresas'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare ownerUserId: number

  @column()
  declare nombre: string

  /** Solo dígitos. */
  @column()
  declare nit: string

  @column()
  declare direccion: string | null

  @column()
  declare telefono: string | null

  @column()
  declare fotoRut: string | null

  @column()
  declare fotoCamaraComercio: string | null

  /** pendiente | aprobado | rechazado */
  @column()
  declare estadoVerificacion: string

  @column()
  declare notaRechazo: string | null

  /** Código de 8 caracteres con el que se unen los empleados. */
  @column()
  declare codigoUnion: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => User, { foreignKey: 'ownerUserId' })
  declare dueno: BelongsTo<typeof User>

  @hasMany(() => User, { foreignKey: 'empresaId' })
  declare miembros: HasMany<typeof User>
}
