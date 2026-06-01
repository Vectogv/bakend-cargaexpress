import { DateTime } from 'luxon'
import { BaseModel, column } from '@adonisjs/lucid/orm'

export default class ConfiguracionPlataforma extends BaseModel {
  static table = 'configuracion_plataforma'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare nequiNumero: string | null

  @column()
  declare nequiNombre: string | null

  @column()
  declare zonasCobertura: any

  @column()
  declare bannerActivo: boolean

  @column()
  declare bannerImagenUrl: string | null

  @column()
  declare bannerLink: string | null

  @column()
  declare bannerTexto: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime
}
