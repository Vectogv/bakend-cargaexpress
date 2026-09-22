import ConfiguracionPlataforma from '#models/configuracion_plataforma'
import { distanciaKm, normalizarZonas } from '#services/geo_service'

/**
 * Zonas de operación configuradas por el admin (ConfiguracionPlataforma.zonasCobertura).
 *
 * Formato actual (rectángulo): { clave, nombre, activa, norte, sur, este, oeste }
 *   - norte/sur: latitudes del borde superior/inferior
 *   - este/oeste: longitudes del borde derecho/izquierdo
 * Formatos antiguos aceptados (círculo): { nombre, lat, lng, radio } y
 *   { nombre, centro: { lat, lng }, radio }.
 *
 * `clave` es el identificador de ciudad que usan moderadores (zonaModerador) y
 * conductores (ciudad): minúsculas y sin tildes, p. ej. "popayan".
 */
export interface ZonaRect {
  tipo: 'rect'
  clave: string
  nombre: string
  activa: boolean
  norte: number
  sur: number
  este: number
  oeste: number
}

export interface ZonaCirculo {
  tipo: 'circulo'
  clave: string
  nombre: string
  activa: boolean
  lat: number
  lng: number
  radio: number
}

export type Zona = ZonaRect | ZonaCirculo

export const claveDe = (nombre: string) =>
  String(nombre || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

const num = (v: unknown) => (v === null || v === undefined || v === '' ? Number.NaN : Number(v))

/** Convierte una zona guardada (cualquier formato) al modelo interno; null si es inválida. */
export function normalizarZona(z: any): Zona | null {
  if (!z || typeof z !== 'object') return null
  const nombre = String(z.nombre || z.zona || '').trim()
  if (!nombre) return null
  const base = { clave: claveDe(z.clave || nombre), nombre, activa: z.activa !== false }

  const [norte, sur, este, oeste] = [num(z.norte), num(z.sur), num(z.este), num(z.oeste)]
  if ([norte, sur, este, oeste].every(Number.isFinite)) {
    return { tipo: 'rect', ...base, norte, sur, este, oeste }
  }

  const lat = num(z.lat ?? z.centro?.lat)
  const lng = num(z.lng ?? z.centro?.lng)
  const radio = num(z.radio)
  if ([lat, lng, radio].every(Number.isFinite) && radio > 0) {
    return { tipo: 'circulo', ...base, lat, lng, radio }
  }
  return null
}

export function contiene(zona: Zona, lat: number, lng: number): boolean {
  if (zona.tipo === 'rect') {
    return lat <= zona.norte && lat >= zona.sur && lng <= zona.este && lng >= zona.oeste
  }
  return distanciaKm(lat, lng, zona.lat, zona.lng) <= zona.radio
}

/**
 * Valida y normaliza lo que envía el admin. Devuelve las zonas listas para
 * guardar o un mensaje de error.
 */
export function validarZonasEntrada(entrada: unknown): { zonas: ZonaRect[] } | { error: string } {
  if (!Array.isArray(entrada)) return { error: 'zonasCobertura debe ser una lista' }
  if (entrada.length > 50) return { error: 'Máximo 50 zonas' }

  const zonas: ZonaRect[] = []
  const claves = new Set<string>()
  for (const [i, z] of entrada.entries()) {
    const etiqueta = `Zona ${i + 1}`
    const nombre = String(z?.nombre || '').trim()
    if (!nombre) return { error: `${etiqueta}: el nombre es obligatorio` }
    const clave = claveDe(nombre)
    if (!clave) return { error: `${etiqueta}: nombre inválido` }
    if (claves.has(clave)) return { error: `La zona "${nombre}" está repetida` }
    claves.add(clave)

    const [norte, sur, este, oeste] = [num(z?.norte), num(z?.sur), num(z?.este), num(z?.oeste)]
    if (![norte, sur, este, oeste].every(Number.isFinite)) {
      return { error: `${nombre}: las cuatro coordenadas deben ser números` }
    }
    if (Math.abs(norte) > 90 || Math.abs(sur) > 90) return { error: `${nombre}: latitud fuera de rango (-90 a 90)` }
    if (Math.abs(este) > 180 || Math.abs(oeste) > 180) return { error: `${nombre}: longitud fuera de rango (-180 a 180)` }
    if (norte <= sur) return { error: `${nombre}: el límite norte debe ser mayor que el sur` }
    if (este <= oeste) return { error: `${nombre}: el límite este debe ser mayor que el oeste` }
    if (norte - sur > 5 || este - oeste > 5) return { error: `${nombre}: la zona es demasiado grande (máx. ~5° por lado)` }

    zonas.push({ tipo: 'rect', clave, nombre, activa: z?.activa !== false, norte, sur, este, oeste })
  }
  return { zonas }
}

export default class CoverageService {
  static async zonas(): Promise<Zona[]> {
    const config = await ConfiguracionPlataforma.first()
    return normalizarZonas(config?.zonasCobertura)
      .map(normalizarZona)
      .filter((z): z is Zona => z !== null)
  }

  static async zonasActivas(): Promise<Zona[]> {
    return (await CoverageService.zonas()).filter((z) => z.activa)
  }

  /** Zona activa que contiene el punto (la más pequeña si se solapan). */
  static zonaDeEn(zonas: Zona[], lat: number, lng: number): Zona | null {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    const candidatas = zonas.filter((z) => z.activa && contiene(z, lat, lng))
    if (candidatas.length === 0) return null
    const area = (z: Zona) => (z.tipo === 'rect' ? (z.norte - z.sur) * (z.este - z.oeste) : (z.radio / 111) ** 2 * Math.PI)
    return candidatas.sort((a, b) => area(a) - area(b))[0]
  }

  static async zonaDe(lat: number, lng: number): Promise<Zona | null> {
    return CoverageService.zonaDeEn(await CoverageService.zonas(), lat, lng)
  }

  /**
   * ¿El punto está dentro de alguna zona activa? Si no hay zonas configuradas se
   * considera cubierto (la plataforma aún no restringe cobertura).
   */
  static async estaCubierto(lat: number, lng: number): Promise<boolean> {
    const zonas = await CoverageService.zonas()
    if (zonas.length === 0) return true
    return CoverageService.zonaDeEn(zonas, lat, lng) !== null
  }

  /** Mensaje para el usuario cuando pide un viaje fuera de cobertura. */
  static async mensajeFueraDeCobertura(): Promise<string> {
    const nombres = (await CoverageService.zonasActivas()).map((z) => z.nombre)
    if (nombres.length === 0) return 'Por el momento no hay zonas de operación activas.'
    const lista = nombres.length === 1 ? nombres[0] : `${nombres.slice(0, -1).join(', ')} y ${nombres.at(-1)}`
    return `Lo sentimos, por el momento solo operamos en ${lista}.`
  }
}
