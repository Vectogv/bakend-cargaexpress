import { assert } from '@japa/assert'
import { apiClient } from '@japa/api-client'
import app from '@adonisjs/core/services/app'
import type { Config } from '@japa/runner/types'
import { rm } from 'node:fs/promises'
import { MigrationRunner } from '@adonisjs/lucid/migration'
import { pluginAdonisJS } from '@japa/plugin-adonisjs'
import { dbAssertions } from '@adonisjs/lucid/plugins/db'
import testUtils from '@adonisjs/core/services/test_utils'
import { authApiClient } from '@adonisjs/auth/plugins/api_client'
import { sessionApiClient } from '@adonisjs/session/plugins/api_client'

/**
 * Nota: no se aumenta `RoutesRegistry` de @japa/api-client con el registry de
 * Tuyau. Estos tests son de caja negra (URLs literales, cuerpos de error 4xx,
 * payloads extra) y los tipos inferidos del registry (`void | {...}`) no
 * describen esas respuestas, lo que producía ~119 falsos errores de tipos.
 */
/**
 * This file is imported by the "bin/test.ts" entrypoint file
 */

/**
 * Configure Japa plugins in the plugins array.
 * Learn more - https://japa.dev/docs/runner-config#plugins-optional
 */
export const plugins: Config['plugins'] = [
  assert(),
  pluginAdonisJS(app),
  dbAssertions(app),
  apiClient(),
  sessionApiClient(app),
  authApiClient(app),
]

/**
 * Configure lifecycle function to run before and after all the
 * tests.
 *
 * The setup functions are executed before all the tests
 * The teardown functions are executed after all the tests
 */
const TEST_DB_FILE = 'test.sqlite3'

/**
 * Prepara una BD SQLite dedicada y limpia (tmp/test.sqlite3) y corre las
 * migraciones. Nunca toca tmp/db.sqlite3 (desarrollo).
 */
async function prepareTestDatabase() {
  const db = await app.container.make('lucid.db')
  const connection = db.primaryConnectionName
  const config = db.getRawConnection(connection)?.config
  const filename = (config?.connection as { filename?: string } | undefined)?.filename

  if (config?.client !== 'better-sqlite3' || !filename?.endsWith(TEST_DB_FILE)) {
    throw new Error(
      `Los tests requieren SQLite en tmp/${TEST_DB_FILE}; conexión actual: ` +
        `${connection} (${config?.client}) ${filename ?? ''}. Revisa .env.test / config/database.ts`
    )
  }

  // Cierra cualquier conexión abierta antes de borrar el archivo (Windows lo bloquea).
  await db.manager.closeAll()
  for (const suffix of ['', '-journal', '-wal', '-shm']) {
    await rm(`${filename}${suffix}`, { force: true })
  }

  /**
   * Se usa MigrationRunner directamente en lugar de `testUtils.db().migrate()`
   * porque éste pasa por el kernel de Ace, que hoy falla al validar los
   * metadatos de los comandos (jsonschema 1.5.0 → "TypeError: Invalid URL").
   * Además así nunca se regenera database/schema.ts desde los tests.
   */
  const runner = new MigrationRunner(db, app, { direction: 'up', connectionName: connection })
  await runner.run()
  if (runner.error) throw runner.error
}

export const runnerHooks: Required<Pick<Config, 'setup' | 'teardown'>> = {
  setup: [prepareTestDatabase],
  teardown: [],
}

/**
 * Configure suites by tapping into the test suite instance.
 * Learn more - https://japa.dev/docs/test-suites#lifecycle-hooks
 */
export const configureSuite: Config['configureSuite'] = (suite) => {
  if (['browser', 'functional', 'e2e'].includes(suite.name)) {
    return suite.setup(async () => {
      const closeHttpServer = await testUtils.httpServer().start()

      /**
       * bin/server.ts adjunta Socket.io al servidor HTTP; replicamos eso aquí
       * para que los tests de sockets (trip_flow, socket_reconnection) puedan
       * conectarse. Sin Redis, el socket funciona en modo instancia única.
       */
      const { default: server } = await import('@adonisjs/core/services/server')
      const { initSocket, getIO } = await import('#start/socket')
      await initSocket(server.getNodeServer() ?? null)

      return async () => {
        try {
          getIO().disconnectSockets(true)
        } catch {
          // socket no inicializado
        }
        await closeHttpServer()
      }
    })
  }
}
