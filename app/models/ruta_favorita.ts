import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from './user.js'

export default class RutaFavorita extends BaseModel {
  static table = 'rutas_favoritas'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare nombre: string

  @column()
  declare origenDireccion: string

  @column()
  declare origenLat: number

  @column()
  declare origenLng: number

  @column()
  declare destinoDireccion: string

  @column()
  declare destinoLat: number

  @column()
  declare destinoLng: number

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => User)
  declare usuario: BelongsTo<typeof User>
}
