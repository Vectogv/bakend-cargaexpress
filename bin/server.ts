import 'reflect-metadata'
import { Ignitor, prettyPrintError } from '@adonisjs/core'

const APP_ROOT = new URL('../', import.meta.url)

const IMPORTER = (filePath: string) => {
  if (filePath.startsWith('./') || filePath.startsWith('../')) {
    return import(new URL(filePath, APP_ROOT).href)
  }
  return import(filePath)
}

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
}

bootstrap().catch((error) => {
  process.exitCode = 1
  prettyPrintError(error)
})
