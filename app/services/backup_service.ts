import { execSync } from 'node:child_process'
import { createGzip } from 'node:zlib'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  unlinkSync,
  readdirSync,
} from 'node:fs'
import { join } from 'node:path'
import { google } from 'googleapis'
import { DateTime } from 'luxon'
import app from '@adonisjs/core/services/app'
import env from '#start/env'
import logger from '@adonisjs/core/services/logger'
import LogRespaldo from '#models/log_respaldo'

const BACKUP_DIR = app.makePath('tmp', 'backups')

function ensureDir() {
  if (!existsSync(BACKUP_DIR)) {
    mkdirSync(BACKUP_DIR, { recursive: true })
  }
}

export async function generateDump(): Promise<string> {
  ensureDir()
  const fileName = `backup_${DateTime.now().toFormat('yyyy-MM-dd')}.sql`
  const sqlPath = join(BACKUP_DIR, fileName)
  const gzPath = sqlPath + '.gz'

  const host = env.get('DB_HOST', '127.0.0.1')
  const port = env.get('DB_PORT', '3306')
  const user = env.get('DB_USER', 'root')
  const password = env.get('DB_PASSWORD', '')
  const database = env.get('DB_DATABASE', '')

  const mysqldump = `mysqldump --host=${host} --port=${port} --user=${user} --password="${password}" --single-transaction --routines --triggers ${database}`
  const sqlBuffer = execSync(mysqldump, { maxBuffer: 100 * 1024 * 1024 })
  const ws = createWriteStream(sqlPath)
  ws.write(sqlBuffer)
  await new Promise<void>((resolve, reject) => {
    ws.on('finish', resolve)
    ws.on('error', reject)
    ws.end()
  })

  const gzPathFinal = await new Promise<string>((resolve, reject) => {
    const gzip = createGzip()
    const input = createReadStream(sqlPath)
    const output = createWriteStream(gzPath)
    input.pipe(gzip).pipe(output)
    output.on('finish', () => resolve(gzPath))
    output.on('error', reject)
  })

  unlinkSync(sqlPath)
  return gzPathFinal
}

async function uploadToDrive(filePath: string): Promise<string | null> {
  const keyPath = env.get('GOOGLE_SERVICE_ACCOUNT_KEY', '')
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
    name: filePath.split('\\').pop() || filePath.split('/').pop() || '',
    parents: [folderId],
  }
  const media = { body: createReadStream(filePath) }

  const response = await drive.files.create({
    requestBody: fileMetadata,
    media,
    fields: 'id',
  })

  return response.data.id || null
}

function cleanOldBackups() {
  const sevenDaysAgo = DateTime.now().minus({ days: 7 }).toMillis()
  const files = readdirSync(BACKUP_DIR)
  for (const file of files) {
    const filePath = join(BACKUP_DIR, file)
    try {
      const stat = (() => {
        const { statSync } = require('node:fs')
        return statSync(filePath)
      })()
      if (stat.mtimeMs < sevenDaysAgo) {
        unlinkSync(filePath)
      }
    } catch {}
  }
}

export async function runBackup(): Promise<void> {
  const fecha = DateTime.now()
  let archivo: string | null = null
  let driveId: string | null = null
  let errorMensaje: string | null = null

  try {
    archivo = await generateDump()
    driveId = await uploadToDrive(archivo)
    cleanOldBackups()
    await LogRespaldo.create({ fecha, estado: 'exitoso', archivo, driveId })
    logger.info(`Backup successful: ${archivo}`)
  } catch (err: any) {
    errorMensaje = err.message || String(err)
    await LogRespaldo.create({ fecha, estado: 'fallido', archivo, driveId, errorMensaje })
    logger.error(`Backup failed: ${errorMensaje}`)
  }
}
