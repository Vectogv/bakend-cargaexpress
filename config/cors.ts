import app from '@adonisjs/core/services/app'
import env from '#start/env'
import { defineConfig } from '@adonisjs/cors'

/**
 * Configuration options to tweak the CORS policy. The following
 * options are documented on the official documentation website.
 *
 * https://docs.adonisjs.com/guides/security/cors
 */
const rawOrigin = app.inDev
  ? true
  : env
      .get('CORS_ORIGIN', '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean)

const origin = rawOrigin === true || (Array.isArray(rawOrigin) && rawOrigin.includes('*'))
  ? true
  : rawOrigin

const corsConfig = defineConfig({
  enabled: true,
  origin,
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
  headers: true,
  exposeHeaders: [],
  credentials: true,
  maxAge: 90,
})

export default corsConfig
