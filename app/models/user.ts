import { UserSchema } from '#database/schema'
import hash from '@adonisjs/core/services/hash'
import { compose } from '@adonisjs/core/helpers'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'
import { type AccessToken, DbAccessTokensProvider } from '@adonisjs/auth/access_tokens'
import { column, hasOne, hasMany } from '@adonisjs/lucid/orm'
import type { DateTime } from 'luxon'
import type { HasOne, HasMany } from '@adonisjs/lucid/types/relations'
import Conductor from './conductor.js'
import Viaje from './viaje.js'
import { ApiProperty } from '@foadonis/openapi/decorators'

export default class User extends compose(UserSchema, withAuthFinder(hash)) {
  static accessTokens = DbAccessTokensProvider.forModel(User)
  declare currentAccessToken?: AccessToken

  @ApiProperty()
  @hasOne(() => Conductor, { foreignKey: 'usuarioId' })
  declare conductor: HasOne<typeof Conductor>

  @ApiProperty()
  @hasMany(() => Viaje, { foreignKey: 'clienteId' })
  declare viajes: HasMany<typeof Viaje>

  @column({
    consume: (value: unknown) => (value != null ? Number(value) : 5.0),
  })
  declare reputacion: number

  @column()
  declare visibilidad: string

  @column()
  declare totalReportes: number

  @column()
  declare totalViajesCompletados: number

  @column()
  declare contactoEmergenciaNombre: string | null

  @column()
  declare contactoEmergenciaTelefono: string | null

  @column()
  declare fcmToken: string | null

  @column({
    consume: (value: unknown) => (value != null ? Number(value) : null),
  })
  declare calificacion: number | null

  @column()
  declare tieneDeudaActiva: boolean

  @column()
  declare reportesInfundadosConductor: number

  @column({
    consume: (value: unknown) => (value != null ? Number(value) : null),
  })
  declare montoDeuda: number | null

  @column.dateTime()
  declare deudaFechaLimite: DateTime | null

  @column()
  declare estadoCuenta: string

  @column()
  declare comprobantePago: string | null

  @column()
  declare esModerador: boolean

  @column()
  declare zonaModerador: string | null

  get initials() {
    const nombre = this.nombre || ''
    const apellido = this.apellido || ''
    if (nombre && apellido) {
      return `${nombre.charAt(0)}${apellido.charAt(0)}`.toUpperCase()
    }
    const email = this.email || ''
    return email.slice(0, 2).toUpperCase()
  }

  get displayName() {
    const nombre = this.nombre || ''
    const apellido = this.apellido || ''
    return `${nombre} ${apellido}`.trim() || this.email
  }
}
