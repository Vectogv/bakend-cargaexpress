import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from './user.js'
import { ApiProperty } from '@foadonis/openapi/decorators'

export default class Notificacion extends BaseModel {
  static table = 'notificaciones'
  static $columns = ['id', 'usuarioId', 'tipo', 'titulo', 'mensaje', 'leido', 'createdAt'] as const
  $columns = Notificacion.$columns

  @ApiProperty()
  @column({ isPrimary: true })
  declare id: number

  @ApiProperty()
  @column()
  declare usuarioId: number

  @ApiProperty()
  @column()
  declare tipo: string

  @ApiProperty()
  @column()
  declare titulo: string

  @ApiProperty()
  @column()
  declare mensaje: string | null

  @ApiProperty()
  @column()
  declare leido: boolean

  @ApiProperty()
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => User, { foreignKey: 'usuarioId' })
  declare usuario: BelongsTo<typeof User>
}
