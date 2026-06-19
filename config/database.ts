import app from '@adonisjs/core/services/app'
import env from '#start/env'
import { defineConfig } from '@adonisjs/lucid'

const dbConfig = defineConfig({
  connection: 'mysql',

  connections: {
    mysql: {
      client: 'mysql2',
      connection: {
        host: env.get('DB_HOST'),
        port: env.get('DB_PORT'),
        user: env.get('DB_USER'),
        password: env.get('DB_PASSWORD'),
        database: env.get('DB_DATABASE'),
        ssl: env.get('DB_SSL', false)
          ? { rejectUnauthorized: false }
          : undefined,
      },
      pool: {
        min: env.get('NODE_ENV') === 'production' ? 2 : 1,
        max: env.get('NODE_ENV') === 'production' ? 25 : 5,
        acquireTimeoutMillis: 10000,
        createTimeoutMillis: 15000,
        idleTimeoutMillis: 30000,
        reapIntervalMillis: 1000,
      },
      migrations: {
        naturalSort: true,
        paths: ['database/migrations'],
      },
      schemaGeneration: {
        enabled: true,
        rulesPaths: ['./database/schema_rules.js'],
      },
      debug: app.inDev,
    },
  },
})

export default dbConfig
