import { createHmac, timingSafeEqual } from 'node:crypto'
import env from '#start/env'

/**
 * Documentos con datos personales (cédula, licencia, comprobantes, soportes de
 * disputa, adjuntos de tickets de soporte). Solo se sirven con una URL firmada de corta duración; el resto de
 * archivos (avatar, fotos de vehículo, banner, foto de entrega) siguen públicos
 * porque la app los muestra a otros usuarios.
 */
const PRIVATE_PREFIXES = ['cedula-', 'licencia-', 'comprobante-', 'dispute-', 'ticket-']

const TTL_SECONDS = 60 * 60 // 1 hora
const UPLOADS_PREFIX = '/storage/uploads/'

const signature = (fileName: string, exp: number) =>
  createHmac('sha256', env.get('APP_KEY').release()).update(`${fileName}:${exp}`).digest('hex')

export default class SignedUploadService {
  static isPrivate(fileName: string): boolean {
    return PRIVATE_PREFIXES.some((p) => fileName.startsWith(p))
  }

  /**
   * Devuelve la ruta con `?exp=&sig=` si el archivo es privado. Acepta rutas
   * `/storage/uploads/x.png`, nombres sueltos, URLs absolutas, null o arrays.
   */
  static sign<T extends string | null | undefined>(path: T): T
  static sign(path: string[]): string[]
  static sign(path: string | string[] | null | undefined): string | string[] | null | undefined {
    if (Array.isArray(path)) return path.map((p) => SignedUploadService.sign(p))
    if (!path || typeof path !== 'string') return path
    if (path.includes('sig=')) return path

    const idx = path.indexOf(UPLOADS_PREFIX)
    const fileName = idx >= 0 ? path.slice(idx + UPLOADS_PREFIX.length) : path.includes('/') ? '' : path
    if (!fileName || !SignedUploadService.isPrivate(fileName)) return path

    const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS
    const base = idx >= 0 ? path : `${UPLOADS_PREFIX}${fileName}`
    return `${base}?exp=${exp}&sig=${signature(fileName, exp)}`
  }

  /**
   * Normaliza rutas que envía un cliente para guardarlas: quita la firma
   * (`?exp=&sig=`), acepta solo archivos de /storage/uploads o URLs http(s) y
   * limita la cantidad. Lo guardado nunca lleva firma; se firma al leer.
   */
  static clean(paths: unknown, max = 10): string[] {
    if (!Array.isArray(paths)) return []
    const out: string[] = []
    for (const p of paths) {
      if (typeof p !== 'string') continue
      const sinQuery = p.trim().split('?')[0]
      const idx = sinQuery.indexOf(UPLOADS_PREFIX)
      if (idx >= 0) out.push(sinQuery.slice(idx))
      else if (/^https?:\/\//.test(sinQuery)) out.push(sinQuery)
      if (out.length >= max) break
    }
    return [...new Set(out)]
  }

  static verify(fileName: string, exp: unknown, sig: unknown): boolean {
    const expNum = Number(exp)
    if (!Number.isFinite(expNum) || expNum < Math.floor(Date.now() / 1000)) return false
    if (typeof sig !== 'string' || !/^[a-f0-9]{64}$/.test(sig)) return false
    const expected = Buffer.from(signature(fileName, expNum), 'hex')
    return timingSafeEqual(expected, Buffer.from(sig, 'hex'))
  }
}
