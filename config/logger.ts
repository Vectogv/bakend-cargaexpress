import env from '#start/env'
import app from '@adonisjs/core/services/app'
import { defineConfig, syncDestination, targets } from '@adonisjs/core/logger'

const loggerConfig = defineConfig({
  default: 'app',

  loggers: {
    app: {
      enabled: true,
      name: env.get('APP_NAME', 'cargaexpress-gv'),
      level: env.get('LOG_LEVEL', 'info'),

      destination: !app.inProduction
        ? await syncDestination()
        : undefined,

      transport: {
        targets: [
          targets.pretty({
            destination: 1,
            colorize: !app.inProduction,
          }),
        ],
      },
    },
  },
})

export default loggerConfig

declare module '@adonisjs/core/types' {
  export interface LoggersList extends InferLoggers<typeof loggerConfig> {}
}
