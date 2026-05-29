import User from '#models/user'
import Conductor from '#models/conductor'
import { registerValidator, loginValidator, refreshTokenValidator } from '#validators/auth'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import { randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import { ApiOperation, ApiBody, ApiResponse } from '@foadonis/openapi/decorators'

export default class AuthController {
  @ApiOperation({ summary: 'Register a new user', description: 'Creates a new user account and optionally a conductor profile' })
  @ApiBody({ type: () => registerValidator })
  @ApiResponse({ type: 'object' })
  async register({ request, serialize, response }: HttpContext) {
    const data = await request.validateUsing(registerValidator)

    if (data.rol === 'conductor' && (!data.cedula || !data.placa || !data.tipoVehiculo || !data.capacidad)) {
      return response.status(422).send({ error: 'Cédula, placa, tipo de vehículo y capacidad son requeridas para conductores' })
    }

    const user = await db.transaction(async (trx) => {
      const user = await User.create({
        nombre: data.nombre,
        apellido: data.apellido,
        email: data.email,
        password: data.password,
        telefono: data.telefono || null,
        rol: data.rol,
        edad: data.edad || null,
      }, { client: trx })

      await trx.from('users').where('id', user.id).update({ password: data.password })

      if (data.rol === 'conductor') {
        await Conductor.create({
          usuarioId: user.id,
          cedula: data.cedula || '',
          placa: data.placa || '',
          tipoVehiculo: data.tipoVehiculo || null,
          capacidad: data.capacidad || null,
        }, { client: trx })
      }

      return user
    })

    const token = await User.accessTokens.create(user, [], { expiresIn: '7 days' })
    const refreshTokenValue = randomUUID()
    await db.table('refresh_tokens').insert({
      user_id: user.id,
      token: refreshTokenValue,
      expires_at: DateTime.now().plus({ days: 30 }).toFormat('yyyy-MM-dd HH:mm:ss'),
      created_at: DateTime.now().toFormat('yyyy-MM-dd HH:mm:ss'),
    })

    return serialize.withoutWrapping({
      id: String(user.id),
      nombre: user.nombre,
      apellido: user.apellido,
      email: user.email,
      rol: user.rol,
      token: token.value!.release(),
      refreshToken: refreshTokenValue,
    })
  }

  @ApiOperation({ summary: 'User login', description: 'Authenticates user and returns access token' })
  @ApiBody({ type: () => loginValidator })
  @ApiResponse({ type: 'object' })
  async login({ request, serialize, response }: HttpContext) {
    const { email, password } = await request.validateUsing(loginValidator)
    const user = await User.findBy('email', email)
    if (!user || user.password !== password) {
      return response.status(400).send({ errors: [{ message: 'Invalid user credentials' }] })
    }
    const token = await User.accessTokens.create(user, [], { expiresIn: '7 days' })

    const refreshTokenValue = randomUUID()
    await db.table('refresh_tokens').insert({
      user_id: user.id,
      token: refreshTokenValue,
      expires_at: DateTime.now().plus({ days: 30 }).toFormat('yyyy-MM-dd HH:mm:ss'),
      created_at: DateTime.now().toFormat('yyyy-MM-dd HH:mm:ss'),
    })

    return serialize.withoutWrapping({
      id: String(user.id),
      nombre: user.nombre,
      apellido: user.apellido,
      email: user.email,
      rol: user.rol,
      token: token.value!.release(),
      refreshToken: refreshTokenValue,
    })
  }

  @ApiOperation({ summary: 'Refresh access token', description: 'Refreshes an expired access token using a refresh token' })
  @ApiBody({ type: () => refreshTokenValidator })
  @ApiResponse({ type: 'object' })
  async refreshToken({ request, serialize }: HttpContext) {
    const { refreshToken } = await request.validateUsing(refreshTokenValidator)

    const row = await db
      .from('refresh_tokens')
      .where('token', refreshToken)
      .where('expires_at', '>', DateTime.now().toFormat('yyyy-MM-dd HH:mm:ss'))
      .first()

    if (!row) {
      return serialize.withoutWrapping({ error: 'Invalid or expired refresh token' })
    }

    await db.from('refresh_tokens').where('id', row.id).delete()

    const user = await User.findOrFail(row.user_id)
    const token = await User.accessTokens.create(user, [], { expiresIn: '7 days' })

    const newRefreshTokenValue = randomUUID()
    await db.table('refresh_tokens').insert({
      user_id: user.id,
      token: newRefreshTokenValue,
      expires_at: DateTime.now().plus({ days: 30 }).toFormat('yyyy-MM-dd HH:mm:ss'),
      created_at: DateTime.now().toFormat('yyyy-MM-dd HH:mm:ss'),
    })

    return serialize.withoutWrapping({
      token: token.value!.release(),
      refreshToken: newRefreshTokenValue,
    })
  }
}
