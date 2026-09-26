import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, hasMany } from '@adonisjs/lucid/orm'
import type { BelongsTo, HasMany } from '@adonisjs/lucid/types/relations'
import User from './user.js'
import Viaje from './viaje.js'
import TicketMensaje from './ticket_mensaje.js'

export const TICKET_CATEGORIAS = ['pago', 'viaje', 'cuenta', 'app', 'otro'] as const
export const TICKET_ESTADOS = ['abierto', 'en_proceso', 'resuelto', 'cerrado'] as const

export type TicketCategoria = (typeof TICKET_CATEGORIAS)[number]
export type TicketEstado = (typeof TICKET_ESTADOS)[number]

/**
 * Ticket de soporte abierto por un cliente o conductor. Lo atiende un moderador
 * de la zona del ticket (o el admin) a través de un hilo de `TicketMensaje`.
 */
export default class TicketSoporte extends BaseModel {
  static table = 'tickets_soporte'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare usuarioId: number

  @column()
  declare viajeId: number | null

  @column()
  declare categoria: string

  @column()
  declare asunto: string

  @column()
  declare descripcion: string

  /** Ruta guardada sin firma (`/storage/uploads/ticket-…`); se firma al leer. */
  @column()
  declare adjunto: string | null

  @column()
  declare estado: string

  @column()
  declare moderadorId: number | null

  @column()
  declare zona: string | null

  @column.dateTime()
  declare ultimoMensajeAt: DateTime | null

  @column.dateTime()
  declare resueltoAt: DateTime | null

  @column.dateTime()
  declare cerradoAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @column.dateTime({ autoCreate: true, autoUpdate: true })
  declare updatedAt: DateTime

  @belongsTo(() => User, { foreignKey: 'usuarioId' })
  declare usuario: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'moderadorId' })
  declare moderador: BelongsTo<typeof User>

  @belongsTo(() => Viaje, { foreignKey: 'viajeId' })
  declare viaje: BelongsTo<typeof Viaje>

  @hasMany(() => TicketMensaje, { foreignKey: 'ticketId' })
  declare mensajes: HasMany<typeof TicketMensaje>
}
