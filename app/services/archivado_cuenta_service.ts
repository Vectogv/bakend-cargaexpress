import db from '@adonisjs/lucid/services/db'
import { DateTime } from 'luxon'
import User from '#models/user'
import SessionService from '#services/session_service'

/** Meses sin uso para archivar una cuenta sola. */
export const MESES_INACTIVIDAD = 6

const ESTADOS_VIAJE_ABIERTOS = [
  'creado',
  'buscando_conductor',
  'pendiente',
  'aceptado',
  'conductor_en_camino',
  'conductor_llegada',
  'en_curso',
  'entregado',
  'esperando_confirmacion',
  'pendiente_confirmacion',
  'sos',
  'disputa',
]

const MSG_SOPORTE = 'soporte revisará tu caso'

/**
 * Archivar = cerrar la cuenta sin borrar nada (decisión del gerente): tokens
 * revocados, fcm_token en null, conductor desconectado y el login la rechaza.
 */
export default class ArchivadoCuentaService {
  /** Mensaje (409) de lo que impide archivar la cuenta, o null si sale limpia. */
  static async bloqueo(user: User): Promise<string | null> {
    if (user.rol !== 'cliente' && user.rol !== 'conductor') {
      return `Esta cuenta no se puede archivar desde la app: ${MSG_SOPORTE}.`
    }
    const conductor = await db.from('conductores').where('usuario_id', user.id).first()
    const conductorId: number | null = conductor?.id ?? null

    const viaje = await db
      .from('viajes')
      .where((q) => {
        q.where('cliente_id', user.id)
        if (conductorId !== null) q.orWhere('conductor_id', conductorId)
      })
      .where((q) => {
        q.whereIn('estado', ESTADOS_VIAJE_ABIERTOS).orWhere((r) =>
          r.where('estado', 'reservado').whereNotNull('conductor_id')
        )
      })
      .first()
    if (viaje) {
      return `No podemos archivar tu cuenta: tienes un viaje o una reserva en curso. Cuando termine, inténtalo de nuevo o escribe a soporte, ${MSG_SOPORTE}.`
    }

    const disputa = await db
      .from('disputas')
      .where((q) => {
        q.where('cliente_id', user.id)
        if (conductorId !== null) q.orWhere('conductor_id', conductorId)
      })
      .whereNot('estado', 'resuelta')
      .first()
    if (disputa) {
      return `No podemos archivar tu cuenta: tienes una disputa abierta. Escribe a soporte, ${MSG_SOPORTE}.`
    }

    if (
      user.estadoCuenta === 'suspension_por_pago' ||
      user.estadoCuenta === 'esperando_confirmacion' ||
      Number(user.montoDeuda ?? 0) > 0
    ) {
      return `No podemos archivar tu cuenta: tienes un pago o una deuda pendiente. Escribe a soporte, ${MSG_SOPORTE}.`
    }
    return null
  }

  /** Archiva si sale limpia. Devuelve el mensaje del bloqueo, o null si quedó archivada. */
  static async archivar(user: User): Promise<string | null> {
    const bloqueo = await this.bloqueo(user)
    if (bloqueo) return bloqueo

    user.estadoCuenta = 'archivada'
    user.archivadaAt = DateTime.now()
    user.fcmToken = null
    await user.save()
    await db.from('conductores').where('usuario_id', user.id).update({ online: false })
    await SessionService.revokeAll(user)
    return null
  }

  /** Última vez que se usó la cuenta: updated_at, sesiones o viajes como cliente. */
  private static async ultimoUso(user: User): Promise<DateTime> {
    const fechas: DateTime[] = [user.updatedAt ?? user.createdAt]
    const consultas = [
      db.from('auth_access_tokens').where('tokenable_id', user.id).max('created_at as f').first(),
      db.from('auth_access_tokens').where('tokenable_id', user.id).max('last_used_at as f').first(),
      db.from('refresh_tokens').where('user_id', user.id).max('created_at as f').first(),
      db.from('viajes').where('cliente_id', user.id).max('created_at as f').first(),
    ]
    for (const fila of await Promise.all(consultas)) {
      if (!fila?.f) continue
      const f = fila.f instanceof Date ? DateTime.fromJSDate(fila.f) : DateTime.fromSQL(String(fila.f))
      if (f.isValid) fechas.push(f)
    }
    return DateTime.max(...fechas) ?? fechas[0]
  }

  /** Archiva las cuentas sin uso en MESES_INACTIVIDAD meses (con los mismos filtros). */
  static async archivarInactivas(ahora = DateTime.now()): Promise<number> {
    const limite = ahora.minus({ months: MESES_INACTIVIDAD })
    const candidatas = await User.query()
      .whereIn('rol', ['cliente', 'conductor'])
      .where('esModerador', false)
      .whereNot('estadoCuenta', 'archivada')
      .where('updatedAt', '<', limite.toSQL({ includeOffset: false })!)
      .orderBy('id')
      .limit(200)

    let archivadas = 0
    for (const user of candidatas) {
      if ((await this.ultimoUso(user)) >= limite) continue
      if ((await this.archivar(user)) === null) archivadas++
    }
    return archivadas
  }
}
