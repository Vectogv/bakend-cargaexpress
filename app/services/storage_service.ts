import { mkdirSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import app from '@adonisjs/core/services/app'
import env from '#start/env'

/**
 * Resolución centralizada del directorio de archivos subidos.
 *
 * - Si UPLOADS_DIR está definido (p. ej. el mount path de un Volume de Railway),
 *   se usa esa ruta para que los archivos sobrevivan a los redeploys.
 * - Si no, se usa `storage/uploads` dentro de la app (efímero en Railway).
 *
 * Nota: con varias réplicas, cada réplica tiene su propio disco; se necesita un
 * volumen compartido u object storage para que todas vean los mismos archivos.
 */
let cachedDir: string | null = null

export default class StorageService {
  static uploadsDir(): string {
    if (cachedDir) return cachedDir

    const configured = env.get('UPLOADS_DIR')?.trim()
    const dir = configured
      ? isAbsolute(configured)
        ? configured
        : resolve(app.makePath(), configured)
      : app.makePath('storage', 'uploads')

    mkdirSync(dir, { recursive: true })
    cachedDir = dir
    return dir
  }
}
