import { spawn } from 'node:child_process'
import { createGzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, stat, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { google } from 'googleapis'
import { DateTime } from 'luxon'
import app from '@adonisjs/core/services/app'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'
import LogRespaldo from '#models/log_respaldo'

const BACKUP_DIR = app.makePath('tmp', 'backups')

/** Tiempo máximo que se deja correr el volcado antes de abortarlo. */
const DUMP_TIMEOUT_MS = 30 * 60 * 1000
/** Máximo de stderr que se conserva para el mensaje de error. */
const STDERR_MAX_CHARS = 4000

async function ensureDir() {
  await mkdir(BACKUP_DIR, { recursive: true })
}

interface PlanVolcado {
  motor: 'pg' | 'mysql'
  comando: string
  args: string[]
  /** Variables para el proceso hijo: la contraseña nunca va por línea de comandos. */
  envExtra: Record<string, string>
}

/** Datos de conexión necesarios para armar el volcado. */
export interface ConfigVolcado {
  conexion?: 'pg' | 'mysql' | 'sqlite'
  databaseUrl?: string
  host: string
  port?: number
  user: string
  password: string
  database: string
}

export function leerConfigDeEntorno(): ConfigVolcado {
  return {
    conexion: env.get('DB_CONNECTION'),
    databaseUrl: env.get('DATABASE_URL'),
    host: env.get('DB_HOST', '127.0.0.1'),
    port: env.get('DB_PORT'),
    user: env.get('DB_USER', ''),
    password: String(env.get('DB_PASSWORD', '')),
    database: env.get('DB_DATABASE', ''),
  }
}

/**
 * Decide la herramienta de volcado según la conexión configurada. Producción usa
 * PostgreSQL (DATABASE_URL); MySQL se mantiene por si se cambia de motor.
 */
export function planDeVolcado(config: ConfigVolcado = leerConfigDeEntorno()): PlanVolcado {
  const { conexion, databaseUrl, host, user, password, database } = config
  const esPg = conexion === 'pg' || (!conexion && Boolean(databaseUrl))

  if (esPg) {
    if (databaseUrl) {
      // pg_dump acepta la URL completa: incluye credenciales, host y base.
      return { motor: 'pg', comando: 'pg_dump', args: ['--no-owner', '--no-acl', databaseUrl], envExtra: {} }
    }
    if (!database) throw new Error('DB_DATABASE no configurado; no se puede generar el respaldo')
    return {
      motor: 'pg',
      comando: 'pg_dump',
      args: [
        `--host=${host}`,
        `--port=${config.port ?? 5432}`,
        `--username=${user || 'postgres'}`,
        '--no-owner',
        '--no-acl',
        database,
      ],
      envExtra: { PGPASSWORD: password },
    }
  }

  if (conexion && conexion !== 'mysql') {
    throw new Error(`Los respaldos solo soportan PostgreSQL y MySQL (DB_CONNECTION=${conexion})`)
  }
  if (!database) throw new Error('DB_DATABASE no configurado; no se puede generar el respaldo')
  return {
    motor: 'mysql',
    comando: 'mysqldump',
    args: [
      `--host=${host}`,
      `--port=${config.port ?? 3306}`,
      `--user=${user || 'root'}`,
      '--single-transaction',
      '--quick',
      '--routines',
      '--triggers',
      // Evita requerir el privilegio PROCESS en bases gestionadas (Railway, etc.)
      '--no-tablespaces',
      database,
    ],
    envExtra: { MYSQL_PWD: password },
  }
}

/**
 * Ejecuta el volcado de forma asíncrona y escribe el resultado comprimido
 * (stdout del volcado → gzip → archivo), sin bloquear el bucle de eventos.
 */
export async function generateDump(): Promise<string> {
  const plan = planDeVolcado()
  await ensureDir()

  const fileName = `backup_${DateTime.now().toFormat('yyyy-MM-dd_HH-mm-ss')}.sql.gz`
  const gzPath = join(BACKUP_DIR, fileName)

  const child = spawn(plan.comando, plan.args, {
    env: { ...process.env, ...plan.envExtra },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk: string) => {
    if (stderr.length < STDERR_MAX_CHARS) stderr += chunk
  })

  const timer = setTimeout(() => {
    logger.error(`${plan.comando} excedió el tiempo máximo, abortando`)
    child.kill('SIGKILL')
  }, DUMP_TIMEOUT_MS)

  const exited = new Promise<void>((resolve, reject) => {
    let settled = false
    child.once('error', (err: NodeJS.ErrnoException) => {
      if (settled) return
      settled = true
      if (err.code === 'ENOENT') {
        const cliente = plan.motor === 'pg' ? 'postgresql-client' : 'cliente MySQL'
        reject(new Error(`${plan.comando} no está instalado en el servidor (falta ${cliente})`))
      } else {
        reject(err)
      }
    })
    child.once('close', (code, signal) => {
      if (settled) return
      settled = true
      if (code === 0) {
        resolve()
      } else {
        const detail = stderr.trim() || `code=${code} signal=${signal}`
        reject(new Error(`${plan.comando} falló: ${detail}`))
      }
    })
  })

  const written = pipeline(child.stdout, createGzip(), createWriteStream(gzPath))

  try {
    await Promise.all([exited, written])
  } catch (err) {
    child.kill('SIGKILL')
    // Evita un unhandled rejection de la promesa que no falló primero.
    await Promise.allSettled([exited, written])
    await unlink(gzPath).catch(() => {})
    throw err
  } finally {
    clearTimeout(timer)
  }

  return gzPath
}

async function uploadToDrive(filePath: string): Promise<string | null> {
  // start.sh escribe la clave en GOOGLE_SERVICE_ACCOUNT_KEY; se acepta también
  // GOOGLE_SERVICE_ACCOUNT_PATH, que es como está nombrada en Railway.
  const keyPath = env.get('GOOGLE_SERVICE_ACCOUNT_KEY', '') || env.get('GOOGLE_SERVICE_ACCOUNT_PATH', '')
  const folderId = env.get('GOOGLE_DRIVE_FOLDER_ID', '')
  if (!keyPath || !folderId) {
    logger.warn('Google Drive credentials not configured, skipping upload')
    return null
  }

  const auth = new google.auth.GoogleAuth({
    keyFile: keyPath,
    scopes: ['https://www.googleapis.com/auth/drive.file'],
  })

  const drive = google.drive({ version: 'v3', auth })
  const fileMetadata = {
    name: basename(filePath),
    parents: [folderId],
  }
  const media = { mimeType: 'application/gzip', body: createReadStream(filePath) }

  const response = await drive.files.create({
    requestBody: fileMetadata,
    media,
    fields: 'id',
  })

  return response.data.id || null
}

async function cleanOldBackups() {
  const sevenDaysAgo = DateTime.now().minus({ days: 7 }).toMillis()
  let files: string[] = []
  try {
    files = await readdir(BACKUP_DIR)
  } catch {
    return
  }
  for (const file of files) {
    const filePath = join(BACKUP_DIR, file)
    try {
      const info = await stat(filePath)
      if (info.mtimeMs < sevenDaysAgo) {
        await unlink(filePath)
      }
    } catch {
      // Archivo ya eliminado o inaccesible: se ignora.
    }
  }
}

let inFlight: Promise<void> | null = null

async function doBackup(): Promise<void> {
  const fecha = DateTime.now()
  let archivo: string | null = null
  let driveId: string | null = null

  try {
    archivo = await generateDump()
    driveId = await uploadToDrive(archivo)
    await cleanOldBackups()
    await LogRespaldo.create({ fecha, estado: 'exitoso', archivo, driveId })
    logger.info(`Backup successful: ${archivo}`)
  } catch (err: any) {
    const errorMensaje = err?.message || String(err)
    logger.error({ err }, `Backup failed: ${errorMensaje}`)
    try {
      await LogRespaldo.create({ fecha, estado: 'fallido', archivo, driveId, errorMensaje })
    } catch (logErr) {
      logger.error({ err: logErr }, 'No se pudo registrar el fallo del respaldo en LogRespaldo')
    }
    throw err
  }
}

/**
 * Genera el respaldo, lo sube a Google Drive (si está configurado) y lo registra
 * en LogRespaldo. Si ya hay un respaldo en curso en este proceso, reutiliza esa
 * misma ejecución en lugar de lanzar otro volcado en paralelo.
 */
export async function runBackup(): Promise<void> {
  if (inFlight) return inFlight
  inFlight = doBackup().finally(() => {
    inFlight = null
  })
  return inFlight
}
