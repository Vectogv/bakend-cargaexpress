import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

/** Código de 6 dígitos para recuperar la contraseña; se guarda solo su hash. */
export default class CodigoRecuperacion extends BaseModel {
  static table = 'codigos_recuperacion'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare codigoHash: string

  @column.dateTime()
  declare expiraAt: DateTime

  @column()
  declare intentos: number

  @column.dateTime()
  declare usadoAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
