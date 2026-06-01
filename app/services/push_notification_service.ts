import admin from 'firebase-admin'
import env from '#start/env'

let initialized = false

function ensureInit() {
  if (initialized) return
  const credPath = env.get('FIREBASE_CREDENTIALS_PATH')
  if (!credPath) return

  const serviceAccount = require(credPath)
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
  initialized = true
}

export async function sendToToken(
  token: string,
  title: string,
  body: string,
  data?: Record<string, string>
) {
  ensureInit()
  if (!initialized) return
  try {
    await admin.messaging().send({ token, notification: { title, body }, data })
  } catch (err: any) {
    if (err.code === 'messaging/registration-token-not-registered') {
      return
    }
    console.error('FCM send error:', err.message)
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
  if (!initialized) return
  try {
    await admin
      .messaging()
      .sendEach(tokens.map((token) => ({ token, notification: { title, body }, data })))
  } catch (err: any) {
    console.error('FCM sendAll error:', err.message)
  }
}
