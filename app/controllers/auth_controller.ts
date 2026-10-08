import User from '#models/user'
import Conductor from '#models/conductor'
import {
  registerValidator,
  registerValidatorMessages,
  loginValidator,
  refreshTokenValidator,
  forgotPasswordValidator,
  resetPasswordValidator,
  googleLoginValidator,
} from '#validators/auth'
import CodigoRecuperacion from '#models/codigo_recuperacion'
import SessionService from '#services/session_service'
import ReferidosService, { CodigoReferidoInvalido } from '#services/referidos_service'
import EmpresaService from '#services/empresa_service'
import { enviarCorreo } from '#services/mail_service'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'
import type { HttpContext } from '@adonisjs/core/http'
import db from '@adonisjs/lucid/services/db'
import hash from '@adonisjs/core/services/hash'
import { createHash, createHmac, randomInt, randomUUID } from 'node:crypto'
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

// ID de cliente web de Firebase (app-cargaexpress); no es un secreto.
const GOOGLE_WEB_CLIENT_ID_DEFECTO =
  '848686850284-bi6477mo5t1ok3tgrha0vvnfmqcdcfma.apps.googleusercontent.com'

const DUPLICADO = {
  placa: { error: 'Esa placa ya está registrada por otro conductor.', code: 'PLACA_DUPLICADA' },
  cedula: { error: 'Esa cédula ya está registrada por otro conductor.', code: 'CEDULA_DUPLICADA' },
  email: { error: 'Ese correo ya está registrado.', message: 'Ese correo ya está registrado.', code: 'EMAIL_DUPLICADO' },
}

// ── Recuperación de contraseña ────────────────────────────────
const CODIGO_VIGENCIA_MIN = 10
const CODIGO_MAX_INTENTOS = 5
const hashCodigo = (codigo: string) =>
  createHmac('sha256', env.get('APP_KEY').release()).update(codigo).digest('hex')
const CODIGO_INVALIDO = { message: 'Código inválido o vencido' }

/**
 * La app manda al asistente si falta algo: el registro (acepta términos al
 * final, `registro_completo`) o los datos que pide después (teléfono y edad).
 */
export function perfilCompleto(user: User): boolean {
  return Boolean(user.registroCompleto && user.telefono && user.edad)
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

    if (!data.idToken && (!data.email || !data.password)) {
      return response.status(422).send({
        errors: [{ field: data.email ? 'password' : 'email', rule: 'required', message: 'El correo y la contraseña son obligatorios' }],
      })
    }
    // Con idToken el correo sale de Google y no se pide contraseña.
    if (data.idToken) {
      const g = await this.validarGoogle(data.idToken)
      if ('respuesta' in g) return response.status(g.respuesta.status).send(g.respuesta.body)
      data.email = g.correo
    }
    const password = data.password || randomUUID()
    const email = data.email!

    if (
      data.rol === 'conductor' &&
      (!data.cedula || !data.placa || !data.tipoVehiculo || !data.capacidad)
    ) {
      return response.status(422).send({
        error: 'Cédula, placa, tipo de vehículo y capacidad son requeridas para conductores',
      })
    }
    // El cliente completa la edad en el asistente; el conductor la trae al registrarse.
    if (data.rol === 'conductor' && !data.edad) {
      return response.status(422).send({
        errors: [{ field: 'edad', rule: 'required', message: 'La edad es obligatoria' }],
      })
    }

    // ponytail: usuarios viejos con mayúsculas pueden duplicarse; se busca con lower(email), sin migrar datos.
    const correoUsado = await User.query().whereRaw('lower(email) = ?', [email]).first()
    if (correoUsado) return response.status(409).send(DUPLICADO.email)

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
            email,
            password,
            telefono: data.telefono || null,
            rol: data.rol,
            edad: data.edad || null,
            terminosAceptadosAt: data.aceptaTerminos ? DateTime.now() : null,
            // El cliente cierra el registro al aceptar las políticas al final del
            // asistente (PUT /api/users/profile); el conductor lo trae todo aquí.
            registroCompleto: data.rol !== 'cliente' || Boolean(data.aceptaTerminos),
          },
          { client: trx }
        )

        if (nuevo.rol === 'conductor') {
          const conductor = await Conductor.create(
            {
              usuarioId: nuevo.id,
              cedula: data.cedula!,
              placa: data.placa!,
              tipoVehiculo: data.tipoVehiculo || null,
              capacidad: data.capacidad || null,
              modeloVehiculo: data.modeloVehiculo || null,
              ciudad: data.ciudad || null,
              estadoVerificacion: 'pendiente',
              codigoReferido: await ReferidosService.codigoNuevo(data.nombre, data.placa!, trx),
            },
            { client: trx }
          )
          await ReferidosService.registrarInvitacion(trx, conductor, data.codigoReferido)
        }
        return nuevo
      })
    } catch (err: any) {
      if (err instanceof CodigoReferidoInvalido) {
        return response.status(422).send({ error: err.message, message: err.message, code: err.code })
      }
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
      perfilCompleto: perfilCompleto(user),
      empresa: await EmpresaService.empresaDe(user),
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
    const user = await User.query().whereRaw('lower(email) = ?', [email]).first()
    // Se verifica un hash también cuando el email no existe, para que el tiempo de
    // respuesta no revele qué correos están registrados.
    const passwordOk = await hash.verify(user?.password || (await getDummyHash()), password)
    if (!user || !passwordOk) {
      return response.status(400).send({ errors: [{ message: 'Invalid user credentials' }] })
    }
    if (user.estadoCuenta === 'archivada') {
      return response.status(403).send({
        code: 'CUENTA_ARCHIVADA',
        errors: [{ message: 'Esta cuenta fue archivada. Escribe a soporte si quieres recuperarla.' }],
      })
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
      perfilCompleto: perfilCompleto(user),
      empresa: await EmpresaService.empresaDe(user),
    })
  }

  /** Valida el idToken de Google (tokeninfo); devuelve los datos o la respuesta de error. */
  private async validarGoogle(idToken: string) {
    const invalido = { respuesta: { status: 401, body: { message: 'No se pudo validar tu cuenta de Google' } } }
    let info: any
    try {
      const res = await fetch(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`
      )
      if (!res.ok) return invalido
      info = await res.json()
    } catch (err: any) {
      logger.error({ err: err?.message }, 'No se pudo consultar tokeninfo de Google')
      return {
        respuesta: { status: 503, body: { message: 'No pudimos contactar a Google, intenta de nuevo' } },
      }
    }
    const audEsperada = env.get('GOOGLE_WEB_CLIENT_ID', GOOGLE_WEB_CLIENT_ID_DEFECTO)
    const correo = String(info?.email || '').toLowerCase()
    if (info?.aud !== audEsperada || String(info?.email_verified) !== 'true' || !correo) return invalido
    return { info, correo }
  }

  /**
   * Entrar con Google. La app manda el idToken; Google lo valida (tokeninfo) y
   * aquí se comprueba que sea para nuestra app y con el correo verificado.
   * Si el correo ya existe se entra a esa cuenta; si no, 404 CUENTA_NO_EXISTE
   * (la app lleva al registro con los datos de Google).
   */
  async google({ request, serialize, response }: HttpContext) {
    const { idToken } = await request.validateUsing(googleLoginValidator)
    const g = await this.validarGoogle(idToken)
    if ('respuesta' in g) return response.status(g.respuesta.status).send(g.respuesta.body)
    const { info, correo } = g

    let user = await User.query().whereRaw('lower(email) = ?', [correo]).first()
    if (user?.estadoCuenta === 'archivada') {
      return response.status(403).send({
        code: 'CUENTA_ARCHIVADA',
        errors: [{ message: 'Esta cuenta fue archivada. Escribe a soporte si quieres recuperarla.' }],
      })
    }
    if (user?.suspendido) {
      return response.status(403).send({
        code: 'CUENTA_SUSPENDIDA',
        errors: [{ message: 'Tu cuenta ha sido suspendida. Contacta al administrador.' }],
      })
    }
    if (!user) {
      return response.status(404).send({
        code: 'CUENTA_NO_EXISTE',
        message: 'No tienes cuenta. Regístrate primero.',
        error: 'No tienes cuenta. Regístrate primero.',
        google: {
          nombre: info.given_name || null,
          apellido: info.family_name || null,
          email: correo,
          foto: info.picture || null,
        },
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
      cuentaNueva: false,
      perfilCompleto: perfilCompleto(user),
      empresa: await EmpresaService.empresaDe(user),
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
      user.fcmToken = null
      await user.save()
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
    if (!user || user.suspendido || user.estadoCuenta === 'archivada') return invalid()

    const token = await User.accessTokens.create(user, [], { expiresIn: '7 days' })
    const newRefreshTokenValue = await issueRefreshToken(user.id)

    return serialize.withoutWrapping({
      token: token.value!.release(),
      refreshToken: newRefreshTokenValue,
    })
  }

  /** Siempre 200: no revela si el correo está registrado. */
  async forgotPassword({ request, response }: HttpContext) {
    const { email } = await request.validateUsing(forgotPasswordValidator)
    const user = await User.query().whereRaw('lower(email) = ?', [email]).first()
    if (user) {
      const codigo = String(randomInt(0, 1_000_000)).padStart(6, '0')
      await CodigoRecuperacion.query().where('user_id', user.id).whereNull('usado_at').delete()
      await CodigoRecuperacion.create({
        userId: user.id,
        codigoHash: hashCodigo(codigo),
        expiraAt: DateTime.now().plus({ minutes: CODIGO_VIGENCIA_MIN }),
        intentos: 0,
      })
      const enviado = await enviarCorreo(
        user.email,
        'Tu código de CargaExpress',
        `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px;color:#1a1a2e">
          <h2 style="margin:0 0 12px">Recupera tu contraseña</h2>
          <p>Hola ${user.nombre}, tu código de CargaExpress es:</p>
          <p style="font-size:32px;letter-spacing:8px;font-weight:bold;margin:16px 0">${codigo}</p>
          <p>Vence en ${CODIGO_VIGENCIA_MIN} minutos. Si no lo pediste, ignora este correo.</p>
        </div>`
      )
      if (!enviado) logger.error({ userId: user.id }, 'No se pudo enviar el código de recuperación')
    }
    return response.json({ message: 'Si el correo está registrado, te enviamos un código' })
  }

  async resetPassword({ request, response }: HttpContext) {
    const { email, codigo, password } = await request.validateUsing(resetPasswordValidator)
    const user = await User.query().whereRaw('lower(email) = ?', [email]).first()
    if (!user) return response.status(400).send(CODIGO_INVALIDO)

    const registro = await CodigoRecuperacion.query()
      .where('user_id', user.id)
      .whereNull('usado_at')
      .where('expira_at', '>', DateTime.now().toSQL()!)
      .orderBy('id', 'desc')
      .first()
    if (!registro) return response.status(400).send(CODIGO_INVALIDO)

    if (registro.codigoHash !== hashCodigo(codigo)) {
      registro.intentos += 1
      // Al agotar los intentos el código se invalida: hay que pedir otro.
      if (registro.intentos >= CODIGO_MAX_INTENTOS) registro.usadoAt = DateTime.now()
      await registro.save()
      return response.status(400).send(CODIGO_INVALIDO)
    }

    user.password = password
    await user.save()
    registro.usadoAt = DateTime.now()
    await registro.save()
    await SessionService.revokeAll(user)
    return response.json({ message: 'Contraseña actualizada. Inicia sesión con la nueva.' })
  }
}
