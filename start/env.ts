import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  // Nota: el default real lo aplica bin/server.ts (process.env.PORT = '3333').
  // `{ default }` no está soportado por @adonisjs/env v7 (validator-lite 2.x)
  // y haría fallar la validación en tests/consola si PORT no está definido.
  PORT: Env.schema.number.optional(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const),

  APP_KEY: Env.schema.secret(),
  APP_URL: Env.schema.string({ format: 'url', tld: false }),

  SESSION_DRIVER: Env.schema.enum(['cookie', 'memory', 'database'] as const),

  DB_CONNECTION: Env.schema.enum.optional(['mysql', 'sqlite'] as const),
  DB_HOST: Env.schema.string({ format: 'host' }),
  DB_PORT: Env.schema.number(),
  DB_USER: Env.schema.string(),
  DB_PASSWORD: Env.schema.string(),
  DB_DATABASE: Env.schema.string(),
  DB_SSL: Env.schema.boolean.optional(),

  CORS_ORIGIN: Env.schema.string.optional(),

  FIREBASE_CREDENTIALS_PATH: Env.schema.string.optional(),

  GOOGLE_DRIVE_FOLDER_ID: Env.schema.string.optional(),
  GOOGLE_SERVICE_ACCOUNT_KEY: Env.schema.string.optional(),
  BACKUP_EMAIL: Env.schema.string.optional(),
  MAPBOX_ACCESS_TOKEN: Env.schema.string.optional(),

  REDIS_HOST: Env.schema.string.optional(),
  REDIS_PORT: Env.schema.number.optional(),
  REDIS_PASSWORD: Env.schema.string.optional(),

  SENTRY_DSN: Env.schema.string.optional(),
})
