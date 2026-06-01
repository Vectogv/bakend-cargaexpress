import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class LogRespaldo extends BaseModel {
  static table = 'logs_respaldo'

  @column({ isPrimary: true })
  declare id: number

  @column.dateTime()
  declare fecha: DateTime

  @column()
  declare estado: string

  @column()
  declare archivo: string | null

  @column()
  declare driveId: string | null

  @column()
  declare errorMensaje: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}
