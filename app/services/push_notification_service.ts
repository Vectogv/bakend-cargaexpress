import { createRequire } from 'node:module'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'

const require = createRequire(import.meta.url)

let messaging: import('firebase-admin/messaging').Messaging | null = null

export interface CuentaServicio {
  project_id: string
  client_email: string
  private_key: string
  [k: string]: unknown
}

/**
 * Credenciales de la cuenta de servicio de Firebase.
 *
 * En Railway no hay dónde dejar un archivo, así que se acepta el JSON completo
 * en FIREBASE_CREDENTIALS_JSON (texto plano o base64) y se conserva
 * FIREBASE_CREDENTIALS_PATH para un archivo local. Devuelve null si no se
 * configuró ninguna (las notificaciones quedan desactivadas, sin romper nada).
 *
 * Ojo con la clave privada: al pegarla en una variable de entorno suele quedar
 * con "\n" literales en lugar de saltos de línea, y firebase-admin la rechaza.
 * Aquí se normaliza.
 */
export function leerCredenciales(
  origen: { json?: string; path?: string },
  cargarArchivo: (p: string) => unknown = (p) => require(p)
): { cuenta: CuentaServicio } | { error: string } | null {
  const crudo = (origen.json || '').trim()
  let cuenta: any = null

  if (crudo) {
    let texto = crudo
    // Base64 (sin llaves ni comillas): se decodifica antes de parsear.
    if (!texto.startsWith('{')) {
      try {
        texto = Buffer.from(texto, 'base64').toString('utf8').trim()
      } catch {
        return { error: 'FIREBASE_CREDENTIALS_JSON no es JSON ni base64 válido' }
      }
    }
    try {
      cuenta = JSON.parse(texto)
    } catch {
      return { error: 'FIREBASE_CREDENTIALS_JSON no contiene un JSON válido' }
    }
  } else if (origen.path) {
    try {
      cuenta = cargarArchivo(origen.path)
    } catch (err: any) {
      return { error: `No se pudo leer FIREBASE_CREDENTIALS_PATH (${err.message})` }
    }
  } else {
    return null
  }

  if (!cuenta || typeof cuenta !== 'object') return { error: 'Las credenciales no son un objeto' }
  if (cuenta.type && cuenta.type !== 'service_account') {
    return {
      error:
        'Ese archivo no es una cuenta de servicio. google-services.json es la configuración de la app Android; ' +
        'genera la clave en Firebase → Configuración del proyecto → Cuentas de servicio',
    }
  }
  for (const campo of ['project_id', 'client_email', 'private_key'] as const) {
    if (!cuenta[campo]) return { error: `Las credenciales no traen ${campo}` }
  }

  return {
    cuenta: { ...cuenta, private_key: String(cuenta.private_key).replace(/\\n/g, '\n') },
  }
}

function ensureInit() {
  if (messaging) return

  const cred = leerCredenciales({
    json: env.get('FIREBASE_CREDENTIALS_JSON'),
    path: env.get('FIREBASE_CREDENTIALS_PATH'),
  })
  if (cred === null) {
    logger.warn('Sin credenciales de Firebase, notificaciones push desactivadas')
    return
  }
  if ('error' in cred) {
    logger.error(`Credenciales de Firebase inválidas: ${cred.error}`)
    return
  }

  try {
    const { initializeApp, cert, getApps } = require('firebase-admin/app')
    const { getMessaging } = require('firebase-admin/messaging')

    if (getApps().length === 0) {
      initializeApp({ credential: cert(cred.cuenta as any) })
    }
    messaging = getMessaging()
    logger.info(`Notificaciones push activas (proyecto ${cred.cuenta.project_id})`)
  } catch (err: any) {
    logger.error(`Firebase init failed: ${err.message}`)
  }
}

export async function sendToToken(
  token: string,
  title: string,
  body: string,
  data?: Record<string, string>,
  sound?: string
) {
  ensureInit()
  if (!messaging) return

  const message: any = { token, notification: { title, body }, data }
  if (sound) {
    message.android = { notification: { sound } }
    message.apns = { payload: { aps: { sound } } }
  }

  try {
    await messaging.send(message)
  } catch (err: any) {
    if (err.code === 'messaging/registration-token-not-registered') return
    logger.error(`FCM send error: ${err.message}`)
  }
}

export async function sendToMultiple(
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, string>,
  sound?: string
) {
  if (tokens.length === 0) return
  ensureInit()
  if (!messaging) return

  try {
    await messaging.sendEach(
      tokens.map((token) => {
        const message: any = { token, notification: { title, body }, data }
        if (sound) {
          message.android = { notification: { sound } }
          message.apns = { payload: { aps: { sound } } }
        }
        return message
      })
    )
  } catch (err: any) {
    logger.error(`FCM sendEach error: ${err.message}`)
  }
}
