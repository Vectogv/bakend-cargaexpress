import 'reflect-metadata'
import { Ignitor, prettyPrintError } from '@adonisjs/core'

const APP_ROOT = new URL('../', import.meta.url)

const IMPORTER = (filePath: string) => {
  if (filePath.startsWith('./') || filePath.startsWith('../')) {
    return import(new URL(filePath, APP_ROOT).href)
  }
  return import(filePath)
}

// Catch unhandled promise rejections globally (e.g. Redis auth failures)
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason)
  if (msg.includes('NOAUTH') || msg.includes('Redis') || msg.includes('ioredis')) {
    // Suppress Redis-related rejections — service handles fallback internally
    return
  }
  console.error('Unhandled Rejection:', reason)
})

async function bootstrap() {
  const ignitor = new Ignitor(APP_ROOT, { importer: IMPORTER }).tap((app) => {
    app.booting(async () => {
      await import('#start/env')
    })
    app.listen('SIGTERM', () => app.terminate())
    app.listenIf(app.managedByPm2, 'SIGINT', () => app.terminate())
  })

  await ignitor.httpServer().start()

  const { initSocket } = await import('../start/socket.js')
  const { default: server } = await import('@adonisjs/core/services/server')
  const nodeServer = server.getNodeServer()
  initSocket(nodeServer ?? null)

  // Initialize observability
  const SentryService = (await import('#services/sentry_service')).default
  SentryService.init()

  const MetricsService = (await import('#services/metrics_service')).default
  MetricsService.init()
}

bootstrap().catch((error) => {
  process.exitCode = 1
  prettyPrintError(error)
})
