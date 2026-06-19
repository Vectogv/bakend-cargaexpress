import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class LogFraude extends BaseModel {
  static table = 'logs_fraude'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare conductorId: number | null

  @column()
  declare tipo: string

  @column()
  declare descripcion: string | null

  @column()
  declare latitud: number | null

  @column()
  declare longitud: number | null

  @column()
  declare velocidad: number | null

  @column()
  declare metadata: Record<string, any> | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime
}