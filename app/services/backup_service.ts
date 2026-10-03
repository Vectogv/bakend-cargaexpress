import { spawn } from 'node:child_process'
import { createGzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readdir, stat, unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { google, type drive_v3 } from 'googleapis'
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

const CARPETA_DRIVE = 'CargaExpress respaldos'
/** Cuántos respaldos se conservan en Drive. */
export const RESPALDOS_A_CONSERVAR = 30
/** Hora (Colombia) a partir de la cual toca el respaldo del día. */
const HORA_RESPALDO = 3
const ZONA = 'America/Bogota'

/** ¿Toca respaldar ahora? Pasadas las 3:00 a. m. de Colombia y sin un respaldo exitoso de hoy. */
export function tocaRespaldar(ahora: DateTime, ultimoExitoso: DateTime | null): boolean {
  const hoy = ahora.setZone(ZONA)
  if (hoy.hour < HORA_RESPALDO) return false
  return !ultimoExitoso || ultimoExitoso.setZone(ZONA).toISODate() !== hoy.toISODate()
}

/** De una lista (más nuevos primero) devuelve los ids que sobran. */
export function respaldosSobrantes<T extends { id: string }>(nuevosPrimero: T[], conservar = RESPALDOS_A_CONSERVAR): T[] {
  return nuevosPrimero.slice(conservar)
}

export function clienteDrive() {
  const clientId = env.get('GOOGLE_OAUTH_CLIENT_ID', '')
  const clientSecret = env.get('GOOGLE_OAUTH_CLIENT_SECRET', '')
  const refreshToken = env.get('GOOGLE_OAUTH_REFRESH_TOKEN', '')
  if (!clientId || !clientSecret || !refreshToken) return null
  const auth = new google.auth.OAuth2(clientId, clientSecret)
  auth.setCredentials({ refresh_token: refreshToken })
  return google.drive({ version: 'v3', auth })
}

async function carpetaDrive(drive: drive_v3.Drive): Promise<string> {
  const fija = env.get('GOOGLE_DRIVE_FOLDER_ID', '')
  if (fija) return fija
  // Con el alcance drive.file solo se ven las carpetas creadas por esta app.
  const q = `name = '${CARPETA_DRIVE}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  const found = await drive.files.list({ q, fields: 'files(id)', pageSize: 1 })
  const id = found.data.files?.[0]?.id
  if (id) return id
  const created = await drive.files.create({
    requestBody: { name: CARPETA_DRIVE, mimeType: 'application/vnd.google-apps.folder' },
    fields: 'id',
  })
  return created.data.id!
}

/** Deja en la carpeta solo los RESPALDOS_A_CONSERVAR más recientes. */
export async function aplicarRetencion(drive: drive_v3.Drive, folderId: string) {
  const res = await drive.files.list({
    q: `'${folderId}' in parents and name contains 'backup_' and trashed = false`,
    orderBy: 'createdTime desc',
    fields: 'files(id)',
    pageSize: 1000,
  })
  for (const f of respaldosSobrantes((res.data.files ?? []) as { id: string }[])) {
    await drive.files.delete({ fileId: f.id! })
  }
}

async function uploadToDrive(filePath: string): Promise<string | null> {
  const drive = clienteDrive()
  if (!drive) {
    logger.warn('Credenciales OAuth de Google Drive no configuradas: se omite la subida del respaldo')
    return null
  }
  const folderId = await carpetaDrive(drive)
  const response = await drive.files.create({
    requestBody: { name: basename(filePath), parents: [folderId] },
    media: { mimeType: 'application/gzip', body: createReadStream(filePath) },
    fields: 'id',
  })
  await aplicarRetencion(drive, folderId)
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
    // Ya está en Drive: el temporal local sobra (en Railway el disco es efímero).
    if (driveId) await unlink(archivo).catch(() => {})
    await cleanOldBackups()
    await LogRespaldo.create({ fecha, estado: 'exitoso', archivo, driveId, errorMensaje: driveId ? null : 'Sin credenciales de Drive: respaldo solo local' })
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

/** Revisa si toca el respaldo diario y lo ejecuta (lo llama el programador cada hora). */
export async function respaldoDiarioSiToca(ahora = DateTime.now()): Promise<boolean> {
  const ultimo = await LogRespaldo.query().where('estado', 'exitoso').orderBy('fecha', 'desc').first()
  if (!tocaRespaldar(ahora, ultimo?.fecha ?? null)) return false
  await runBackup()
  return true
}
