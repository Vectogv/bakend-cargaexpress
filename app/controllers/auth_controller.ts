import User from '#models/user'
import Conductor from '#models/conductor'
import { registerValidator, registerValidatorMessages, loginValidator, refreshTokenValidator } from '#validators/auth'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import hash from '@adonisjs/core/services/hash'
import { createHash, randomUUID } from 'node:crypto'
import { DateTime } from 'luxon'
import { ApiOperation, ApiBody, ApiResponse } from '@foadonis/openapi/decorators'
import { emitToAdmin } from '#start/socket'

// Los refresh tokens se guardan hasheados (SHA-256): una fuga de la base de datos
// no permite suplantar sesiones.
const hashRefreshToken = (value: string) => createHash('sha256').update(value).digest('hex')

// Transición: los tokens emitidos antes de este cambio siguen guardados en claro.
const refreshTokenCandidates = (value: string) => [hashRefreshToken(value), value]

async function issueRefreshToken(userId: number): Promise<string> {
  const value = randomUUID()
  await db.table('refresh_tokens').insert({
    user_id: userId,
    token: hashRefreshToken(value),
    expires_at: DateTime.now().plus({ days: 30 }).toFormat('yyyy-MM-dd HH:mm:ss'),
    created_at: DateTime.now().toFormat('yyyy-MM-dd HH:mm:ss'),
  })
  return value
}

const DUPLICADO = {
  placa: { error: 'Esa placa ya está registrada por otro conductor.', code: 'PLACA_DUPLICADA' },
  cedula: { error: 'Esa cédula ya está registrada por otro conductor.', code: 'CEDULA_DUPLICADA' },
  email: { error: 'Ese correo ya está registrado.', code: 'EMAIL_DUPLICADO' },
}

let dummyHash: string | null = null
async function getDummyHash() {
  dummyHash = dummyHash || (await hash.make(randomUUID()))
  return dummyHash
}

export default class AuthController {
  @ApiOperation({
    summary: 'Registrar un nuevo usuario',
    description: 'Crea una cuenta de usuario nueva y, opcionalmente, un perfil de conductor',
  })
  @ApiBody({ type: () => registerValidator })
  @ApiResponse({ type: 'object' })
  async register({ request, serialize, response }: HttpContext) {
    const data = await request.validateUsing(registerValidator, { messagesProvider: registerValidatorMessages })

    if (
      data.rol === 'conductor' &&
      (!data.cedula || !data.placa || !data.tipoVehiculo || !data.capacidad)
    ) {
      return response.status(422).send({
        error: 'Cédula, placa, tipo de vehículo y capacidad son requeridas para conductores',
      })
    }

    // Placa y cédula son únicas: se responde 409 con un mensaje claro en vez
    // del error de base de datos.
    if (data.rol === 'conductor') {
      const existente = await Conductor.query()
        .where('placa', data.placa!)
        .orWhere('cedula', data.cedula!)
        .select('placa', 'cedula')
        .first()
      if (existente) {
        return response.status(409).send(
          existente.placa === data.placa ? DUPLICADO.placa : DUPLICADO.cedula
        )
      }
    }

    // Usuario y perfil de conductor se crean juntos: si falla el perfil no
    // queda un usuario huérfano (rol conductor sin fila en `conductores`).
    let user: User
    try {
      user = await db.transaction(async (trx) => {
        const nuevo = await User.create(
          {
            nombre: data.nombre,
            apellido: data.apellido,
            email: data.email,
            password: data.password,
            telefono: data.telefono || null,
            rol: data.rol,
            edad: data.edad || null,
          },
          { client: trx }
        )

        if (nuevo.rol === 'conductor') {
          await Conductor.create(
            {
              usuarioId: nuevo.id,
              cedula: data.cedula!,
              placa: data.placa!,
              tipoVehiculo: data.tipoVehiculo || null,
              capacidad: data.capacidad || null,
              ciudad: data.ciudad || null,
              estadoVerificacion: 'pendiente',
            },
            { client: trx }
          )
        }
        return nuevo
      })
    } catch (err: any) {
      // Carrera entre dos registros simultáneos: la restricción UNIQUE de la BD
      // es la última defensa (MySQL ER_DUP_ENTRY / SQLite UNIQUE constraint).
      const mensaje = String(err?.message || '')
      if (err?.code === 'ER_DUP_ENTRY' || mensaje.includes('UNIQUE constraint failed')) {
        if (mensaje.includes('placa')) return response.status(409).send(DUPLICADO.placa)
        if (mensaje.includes('cedula')) return response.status(409).send(DUPLICADO.cedula)
        if (mensaje.includes('email')) return response.status(409).send(DUPLICADO.email)
      }
      throw err
    }

    const token = await User.accessTokens.create(user, [], { expiresIn: '7 days' })
    const refreshTokenValue = await issueRefreshToken(user.id)

    try {
      if (user.rol === 'conductor') {
        emitToAdmin('admin:new_driver', {
          id: String(user.id),
          nombre: user.nombre,
          apellido: user.apellido,
          email: user.email,
        })
      } else {
        emitToAdmin('admin:new_user', {
          id: String(user.id),
          nombre: user.nombre,
          apellido: user.apellido,
          email: user.email,
        })
      }
    } catch {
      // Socket.io may not be initialized in test environment
    }

    return serialize.withoutWrapping({
      id: String(user.id),
      nombre: user.nombre,
      apellido: user.apellido,
      email: user.email,
      rol: user.rol,
      esModerador: Boolean(user.esModerador),
      zonaModerador: user.zonaModerador,
      token: token.value!.release(),
      refreshToken: refreshTokenValue,
    })
  }

  @ApiOperation({
    summary: 'Iniciar sesión',
    description: 'Autentica al usuario y devuelve un token de acceso',
  })
  @ApiBody({ type: () => loginValidator })
  @ApiResponse({ type: 'object' })
  async login({ request, serialize, response }: HttpContext) {
    const { email, password } = await request.validateUsing(loginValidator)
    const user = await User.findBy('email', email)
    // Se verifica un hash también cuando el email no existe, para que el tiempo de
    // respuesta no revele qué correos están registrados.
    const passwordOk = await hash.verify(user?.password || (await getDummyHash()), password)
    if (!user || !passwordOk) {
      return response.status(400).send({ errors: [{ message: 'Invalid user credentials' }] })
    }
    if (user.suspendido) {
      return response
        .status(403)
        .send({
          code: 'CUENTA_SUSPENDIDA',
          errors: [{ message: 'Tu cuenta ha sido suspendida. Contacta al administrador.' }],
        })
    }
    const token = await User.accessTokens.create(user, [], { expiresIn: '7 days' })
    const refreshTokenValue = await issueRefreshToken(user.id)

    return serialize.withoutWrapping({
      id: String(user.id),
      nombre: user.nombre,
      apellido: user.apellido,
      email: user.email,
      rol: user.rol,
      esModerador: Boolean(user.esModerador),
      zonaModerador: user.zonaModerador,
      token: token.value!.release(),
      refreshToken: refreshTokenValue,
    })
  }

  async logout({ auth, request, response }: HttpContext) {
    // El refresh token se revoca aunque el access token ya haya expirado: de lo
    // contrario seguiría sirviendo para obtener sesiones nuevas durante 30 días.
    const refreshToken = request.input('refreshToken')
    if (typeof refreshToken === 'string' && refreshToken) {
      await db.from('refresh_tokens').whereIn('token', refreshTokenCandidates(refreshToken)).delete()
    }
    try {
      const user = await auth.authenticate()
      if (user.currentAccessToken) {
        await User.accessTokens.delete(user, user.currentAccessToken.identifier)
      }
    } catch {
      // El access token puede estar expirado o no enviarse.
    }
    return response.json({ message: 'Sesión cerrada' })
  }

  @ApiOperation({
    summary: 'Renovar token de acceso',
    description: 'Renueva un token de acceso expirado usando un refresh token',
  })
  @ApiBody({ type: () => refreshTokenValidator })
  @ApiResponse({ type: 'object' })
  async refreshToken({ request, serialize, response }: HttpContext) {
    const { refreshToken } = await request.validateUsing(refreshTokenValidator)

    const invalid = () => response.status(401).json({ error: 'Invalid or expired refresh token' })

    const row = await db
      .from('refresh_tokens')
      .whereIn('token', refreshTokenCandidates(refreshToken))
      .where('expires_at', '>', DateTime.now().toFormat('yyyy-MM-dd HH:mm:ss'))
      .first()

    if (!row) return invalid()

    // Borrado atómico: si dos peticiones usan el mismo refresh token a la vez,
    // solo la que logra borrarlo obtiene una sesión nueva.
    const deleted = await db.from('refresh_tokens').where('id', row.id).delete()
    const deletedCount = Array.isArray(deleted) ? Number(deleted[0]) : Number(deleted)
    if (!deletedCount) return invalid()

    const user = await User.find(row.user_id)
    if (!user || user.suspendido) return invalid()

    const token = await User.accessTokens.create(user, [], { expiresIn: '7 days' })
    const newRefreshTokenValue = await issueRefreshToken(user.id)

    return serialize.withoutWrapping({
      token: token.value!.release(),
      refreshToken: newRefreshTokenValue,
    })
  }
}
