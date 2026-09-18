import app from '@adonisjs/core/services/app'
import env from '#start/env'
import { defineConfig } from '@adonisjs/lucid'

function parseDatabaseUrl(url: string) {
  const parsed = new URL(url)
  return {
    host: parsed.hostname,
    port: Number(parsed.port) || 5432,
    user: parsed.username,
    password: parsed.password,
    database: parsed.pathname.slice(1),
  }
}

function resolveConnection() {
  if (env.get('DB_CONNECTION')) return env.get('DB_CONNECTION')!
  if (env.get('DATABASE_URL')) return 'pg' as const
  if (env.get('DB_HOST')) return 'mysql' as const
  return 'sqlite' as const
}

function resolvePgConnection() {
  if (env.get('DATABASE_URL')) {
    const parsed = parseDatabaseUrl(env.get('DATABASE_URL')!)
    return {
      host: parsed.host,
      port: parsed.port,
      user: parsed.user,
      password: parsed.password,
      database: parsed.database,
      ssl: env.get('DB_SSL', false)
        ? { rejectUnauthorized: false }
        : undefined,
    }
  }
  return {
    host: env.get('DB_HOST', '127.0.0.1'),
    port: env.get('DB_PORT', 5432),
    user: env.get('DB_USER', 'postgres'),
    password: env.get('DB_PASSWORD', ''),
    database: env.get('DB_DATABASE', 'cargaexpress'),
    ssl: env.get('DB_SSL', false)
      ? { rejectUnauthorized: false }
      : undefined,
  }
}

const dbConfig = defineConfig({
  connection: resolveConnection(),

  connections: {
    sqlite: {
      client: 'better-sqlite3',
      connection: {
        filename: app.tmpPath('db.sqlite3'),
      },
      useNullAsDefault: true,
      migrations: {
        naturalSort: true,
        paths: ['database/migrations'],
      },
      schemaGeneration: {
        enabled: true,
        rulesPaths: ['./database/schema_rules.js'],
      },
    },
    mysql: {
      client: 'mysql2',
      connection: {
        host: env.get('DB_HOST', '127.0.0.1'),
        port: env.get('DB_PORT', 3306),
        user: env.get('DB_USER', 'root'),
        password: env.get('DB_PASSWORD', ''),
        database: env.get('DB_DATABASE', 'cargaexpress'),
        ssl: env.get('DB_SSL', false)
          ? { rejectUnauthorized: false }
          : undefined,
      },
      pool: {
        min: 1,
        max: 10,
        acquireTimeoutMillis: 15000,
        createTimeoutMillis: 20000,
        idleTimeoutMillis: 60000,
        reapIntervalMillis: 1000,
        propagateCreateError: false,
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
    pg: {
      client: 'pg',
      connection: resolvePgConnection(),
      pool: {
        min: 1,
        max: 10,
        acquireTimeoutMillis: 15000,
        createTimeoutMillis: 20000,
        idleTimeoutMillis: 60000,
        reapIntervalMillis: 1000,
        propagateCreateError: false,
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
