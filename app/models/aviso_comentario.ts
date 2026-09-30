import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from './user.js'

export default class AvisoComentario extends BaseModel {
  static table = 'aviso_comentarios'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare avisoId: number

  @column()
  declare autorId: number

  @column()
  declare contenido: string

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => User, { foreignKey: 'autorId' })
  declare autor: BelongsTo<typeof User>
}
