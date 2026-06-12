import app from '@adonisjs/core/services/app'
import env from '#start/env'
import { defineConfig } from '@adonisjs/cors'

const corsConfig = defineConfig({
  enabled: true,
  origin: app.inDev
    ? true
    : env.get('CORS_ORIGIN', '*').split(',').map((o) => o.trim()).filter(Boolean),
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  headers: true,
  exposeHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
  maxAge: 86400,
})

export default corsConfig
