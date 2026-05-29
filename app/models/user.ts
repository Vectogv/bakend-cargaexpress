import { UserSchema } from '#database/schema'
import hash from '@adonisjs/core/services/hash'
import { compose } from '@adonisjs/core/helpers'
import { withAuthFinder } from '@adonisjs/auth/mixins/lucid'
import { type AccessToken, DbAccessTokensProvider } from '@adonisjs/auth/access_tokens'
import { hasOne, hasMany } from '@adonisjs/lucid/orm'
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
