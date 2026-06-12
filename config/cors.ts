import app from '@adonisjs/core/services/app'
import env from '#start/env'
import { defineConfig } from '@adonisjs/cors'

const rawOrigin = app.inDev
  ? true
  : env.get('CORS_ORIGIN', '*').split(',').map((o) => o.trim()).filter(Boolean)

const origin = rawOrigin === true || (Array.isArray(rawOrigin) && rawOrigin.includes('*'))
  ? '*'
  : rawOrigin

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
