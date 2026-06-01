import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
  // Node
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.string(),

  // App
  APP_KEY: Env.schema.secret(),
  APP_URL: Env.schema.string({ format: 'url', tld: false }),

  // Session
  SESSION_DRIVER: Env.schema.enum(['cookie', 'memory', 'database'] as const),

  // Database
  DB_HOST: Env.schema.string({ format: 'host' }),
  DB_PORT: Env.schema.number(),
  DB_USER: Env.schema.string(),
  DB_PASSWORD: Env.schema.string(),
  DB_DATABASE: Env.schema.string(),

  // ✅ AGREGADO: CORS para producción (opcional, pero recomendado)
  CORS_ORIGIN: Env.schema.string.optional(),

  // ✅ AGREGADO: Firebase (opcional, la app funciona sin FCM si no está configurado)
  FIREBASE_CREDENTIALS_PATH: Env.schema.string.optional(),

  // ✅ AGREGADO: Google Drive Backup (opcionales)
  GOOGLE_DRIVE_FOLDER_ID: Env.schema.string.optional(),
  GOOGLE_SERVICE_ACCOUNT_KEY: Env.schema.string.optional(),
  BACKUP_EMAIL: Env.schema.string.optional(),
})
