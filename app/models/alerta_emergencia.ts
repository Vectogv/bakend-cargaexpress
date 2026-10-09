import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from './user.js'
import Viaje from './viaje.js'

export type EstadoAlerta = 'pendiente' | 'atendida' | 'resuelta'

/**
 * Tipo de caso con el que se cierra un SOS, para la auditoría. Toda alerta
 * resuelta debe quedar con uno de estos (ver `emergencyResolve`/`resolveEmergency`).
 */
export const TIPOS_CIERRE_SOS: Record<string, string> = {
  robo: 'Robo',
  accidente: 'Accidente',
  falla_mecanica: 'Falla mecánica',
  agresion_amenaza: 'Agresión o amenaza',
  salud: 'Salud',
  falsa_alarma: 'Falsa alarma',
  otro: 'Otro',
}

export default class AlertaEmergencia extends BaseModel {
  static table = 'alertas_emergencia'

  @column({ isPrimary: true })
  declare id: number

  @column()
  declare userId: number

  @column()
  declare viajeId: number | null

  @column()
  declare lat: number | null

  @column()
  declare lng: number | null

  @column()
  declare motivo: string | null

  @column()
  declare atendida: boolean

  @column()
  declare estado: string

  @column()
  declare moderadorAtendioId: number | null

  @column()
  declare moderadorResolvioId: number | null

  @column()
  declare observacion: string | null

  @column()
  declare tipoCierre: string | null

  @column.dateTime({ serializeAs: null })
  declare atendidaAt: DateTime | null

  @column.dateTime({ serializeAs: null })
  declare resueltaAt: DateTime | null

  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => User)
  declare usuario: BelongsTo<typeof User>

  @belongsTo(() => Viaje)
  declare viaje: BelongsTo<typeof Viaje>

  @belongsTo(() => User, { foreignKey: 'moderadorAtendioId' })
  declare moderadorAtendio: BelongsTo<typeof User>

  @belongsTo(() => User, { foreignKey: 'moderadorResolvioId' })
  declare moderadorResolvio: BelongsTo<typeof User>
}
