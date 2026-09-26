import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from './user.js'
import TicketSoporte from './ticket_soporte.js'

/** 'usuario' (dueño del ticket), 'moderador' o 'admin'. */
export type TicketRolAutor = 'usuario' | 'moderador' | 'admin'

export default class TicketMensaje extends BaseModel {
  static table = 'ticket_mensajes'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare ticketId: number

  @column()
  declare autorId: number

  @column()
  declare rolAutor: string

  @column()
  declare mensaje: string

  /** Ruta guardada sin firma; se firma al leer. */
  @column()
  declare adjunto: string | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => TicketSoporte, { foreignKey: 'ticketId' })
  declare ticket: BelongsTo<typeof TicketSoporte>

  @belongsTo(() => User, { foreignKey: 'autorId' })
  declare autor: BelongsTo<typeof User>
}
