import { DateTime } from 'luxon'
import { BaseModel, column, belongsTo, afterCreate } from '@adonisjs/lucid/orm'
import type { BelongsTo } from '@adonisjs/lucid/types/relations'
import User from './user.js'
import { ApiProperty } from '@foadonis/openapi/decorators'
import { emitToUser } from '#start/socket'

export default class Notificacion extends BaseModel {
  static table = 'notificaciones'
  static $columns = [
    'id',
    'usuarioId',
    'tipo',
    'titulo',
    'mensaje',
    'leido',
    'viajeId',
    'ticketId',
    'createdAt',
  ] as const
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

  /** Viaje al que se refiere el aviso (la app lo abre al tocarlo). */
  @ApiProperty()
  @column()
  declare viajeId: number | null

  /** Ticket de soporte al que se refiere el aviso. */
  @ApiProperty()
  @column()
  declare ticketId: number | null

  @ApiProperty()
  @column.dateTime({ autoCreate: true })
  declare createdAt: DateTime

  @belongsTo(() => User, { foreignKey: 'usuarioId' })
  declare usuario: BelongsTo<typeof User>

  /** Forma que ven la app y el socket (con los alias viejos _id/type/title/body/read). */
  static serializar(n: Notificacion) {
    return {
      id: String(n.id),
      _id: String(n.id),
      tipo: n.tipo,
      type: n.tipo,
      titulo: n.titulo,
      title: n.titulo,
      mensaje: n.mensaje,
      body: n.mensaje,
      leido: n.leido,
      read: n.leido,
      viajeId: n.viajeId == null ? null : String(n.viajeId),
      ticketId: n.ticketId == null ? null : String(n.ticketId),
      createdAt: n.createdAt,
    }
  }

  @afterCreate()
  static async emitNew(notificacion: Notificacion) {
    try {
      emitToUser(notificacion.usuarioId, 'notification:new', Notificacion.serializar(notificacion))
    } catch {
      // ignore socket errors
    }
  }
}
