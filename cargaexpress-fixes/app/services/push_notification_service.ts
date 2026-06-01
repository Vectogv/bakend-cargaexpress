import { createRequire } from 'node:module'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'

// ✅ CORREGIDO: En proyectos ESM ("type":"module") no se puede usar require() directamente.
// createRequire permite importar archivos JSON o CJS desde ESM.
const require = createRequire(import.meta.url)

let messaging: import('firebase-admin/messaging').Messaging | null = null

function ensureInit() {
  if (messaging) return

  const credPath = env.get('FIREBASE_CREDENTIALS_PATH')
  if (!credPath) {
    logger.warn('FIREBASE_CREDENTIALS_PATH not set, push notifications disabled')
    return
  }

  try {
    // ✅ CORREGIDO: usar require() seguro vía createRequire para cargar el JSON de credenciales
    const serviceAccount = require(credPath)
    const { initializeApp, cert, getApps } = require('firebase-admin/app')
    const { getMessaging } = require('firebase-admin/messaging')

    if (getApps().length === 0) {
      initializeApp({ credential: cert(serviceAccount) })
    }
    messaging = getMessaging()
  } catch (err: any) {
    logger.error(`Firebase init failed: ${err.message}`)
  }
}

export async function sendToToken(
  token: string,
  title: string,
  body: string,
  data?: Record<string, string>
) {
  ensureInit()
  if (!messaging) return

  try {
    await messaging.send({ token, notification: { title, body }, data })
  } catch (err: any) {
    // Token inválido — no es un error crítico, solo lo ignoramos
    if (err.code === 'messaging/registration-token-not-registered') return
    logger.error(`FCM send error: ${err.message}`)
  }
}

export async function sendToMultiple(
  tokens: string[],
  title: string,
  body: string,
  data?: Record<string, string>
) {
  if (tokens.length === 0) return
  ensureInit()
  if (!messaging) return

  try {
    await messaging.sendEach(
      tokens.map((token) => ({ token, notification: { title, body }, data }))
    )
  } catch (err: any) {
    logger.error(`FCM sendEach error: ${err.message}`)
  }
}
