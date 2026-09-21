import app from '@adonisjs/core/services/app'
import env from '#start/env'
import { defineConfig } from '@adonisjs/cors'

const rawOrigin = app.inDev
  ? true
  : env.get('CORS_ORIGIN', '*').split(',').map((o) => o.trim()).filter(Boolean)

const allowAll = rawOrigin === true || (Array.isArray(rawOrigin) && rawOrigin.includes('*'))
const allowedOrigins = Array.isArray(rawOrigin) ? rawOrigin : []

// Permite probar la app Flutter web desde el PC (flutter run -d chrome usa un
// puerto aleatorio en localhost). Desactivar con CORS_ALLOW_LOCALHOST=false.
const allowLocalhost = env.get('CORS_ALLOW_LOCALHOST', true)
const LOCALHOST = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

const origin = allowAll
  ? '*'
  : (requestOrigin: string) =>
      allowedOrigins.includes(requestOrigin) || (allowLocalhost && LOCALHOST.test(requestOrigin))

const corsConfig = defineConfig({
  enabled: true,
  origin,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  headers: true,
  exposeHeaders: [],
  credentials: false,
  maxAge: 86400,
})

export default corsConfig
