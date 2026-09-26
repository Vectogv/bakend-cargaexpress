import env from '#start/env'
import logger from '@adonisjs/core/services/logger'

/**
 * Ruta y tiempo estimado de llegada (ETA) de un viaje, calculados en el
 * backend para que cliente y conductor vean la misma línea y los mismos
 * minutos (antes cada app pedía su ruta a Mapbox y el ETA era la recta a
 * 30 km/h).
 *
 * Ahorro de llamadas a Mapbox: una ruta por fase del viaje (hacia la recogida
 * y hacia el destino), guardada en memoria. Sólo se vuelve a pedir si el
 * conductor se sale de la ruta (> DESVIO_M) o si la ruta tiene más de
 * REFRESCO_MS (tráfico), y nunca más de una vez cada MIN_ENTRE_LLAMADAS_MS por
 * viaje. Entre recálculos el ETA sale de lo que falta del recorrido guardado,
 * sin llamar a Mapbox.
 */

export type Fase = 'recogida' | 'destino'
export type Punto = [number, number] // [lat, lng]

export interface Ruta {
  fase: Fase
  coords: Punto[]
  distanciaM: number
  duracionSeg: number
  fuente: 'mapbox' | 'recta'
  calculadaEn: number
}

export interface EstadoRuta {
  ruta: Ruta
  /** Metros que faltan por la ruta desde la posición del conductor. */
  restanteM: number
  /** Minutos estimados de llegada (mínimo 1). */
  etaMin: number
  /** true si en esta llamada se pidió una ruta nueva (hay que reenviarla). */
  recalculada: boolean
  /** Posición del conductor con la que se calculó (la que ve el cliente). */
  conductor: Punto
}

export const DESVIO_M = 200
export const REFRESCO_MS = 5 * 60_000
export const MIN_ENTRE_LLAMADAS_MS = 30_000
/** Sin Mapbox (sin token o caído): recta a esta velocidad, reintento en 60 s. */
const VELOCIDAD_RECTA_KMH = 30
const REINTENTO_RECTA_MS = 60_000

/** Estado del viaje → hacia dónde va el conductor (null: no se sigue). */
export function faseDe(estado: string): Fase | null {
  if (estado === 'aceptado' || estado === 'conductor_en_camino') return 'recogida'
  if (estado === 'conductor_llegada' || estado === 'en_curso') return 'destino'
  return null
}

// ---------------------------------------------------------------------------
// Geometría (aproximación equirectangular: sobra a escala de ciudad).
// ---------------------------------------------------------------------------

const R = 6_371_000
const rad = (g: number) => (g * Math.PI) / 180

export function distanciaM(a: Punto, b: Punto): number {
  const dLat = rad(b[0] - a[0])
  const dLng = rad(b[1] - a[1])
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

/** Proyección de p sobre el segmento a-b: fracción t (0..1) y distancia. */
function proyectar(p: Punto, a: Punto, b: Punto): { t: number; d: number } {
  const k = Math.cos(rad(p[0]))
  const ax = a[1] * k
  const ay = a[0]
  const bx = b[1] * k
  const by = b[0]
  const px = p[1] * k
  const py = p[0]
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2))
  const q: Punto = [ay + t * dy, (ax + t * dx) / k]
  return { t, d: distanciaM(p, q) }
}

/** Distancia de p a la ruta y metros que faltan desde su proyección. */
export function posicionEnRuta(p: Punto, coords: Punto[]): { desvioM: number; restanteM: number } {
  if (coords.length === 0) return { desvioM: Infinity, restanteM: 0 }
  if (coords.length === 1) {
    const d = distanciaM(p, coords[0])
    return { desvioM: d, restanteM: d }
  }
  let mejor = { i: 0, t: 0, d: Infinity }
  for (let i = 0; i < coords.length - 1; i++) {
    const { t, d } = proyectar(p, coords[i], coords[i + 1])
    if (d < mejor.d) mejor = { i, t, d }
  }
  const segmento = distanciaM(coords[mejor.i], coords[mejor.i + 1])
  let restante = segmento * (1 - mejor.t)
  for (let i = mejor.i + 1; i < coords.length - 1; i++) {
    restante += distanciaM(coords[i], coords[i + 1])
  }
  return { desvioM: mejor.d, restanteM: restante }
}

// ---------------------------------------------------------------------------
// Mapbox Directions (perfil con tráfico en vivo).
// ---------------------------------------------------------------------------

export type ProveedorRuta = (
  desde: Punto,
  hasta: Punto
) => Promise<{ coords: Punto[]; distanciaM: number; duracionSeg: number } | null>

export const mapboxDirections: ProveedorRuta = async (desde, hasta) => {
  const token = env.get('MAPBOX_ACCESS_TOKEN', '')
  if (!token) return null
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/driving-traffic/` +
    `${desde[1]},${desde[0]};${hasta[1]},${hasta[0]}` +
    `?geometries=geojson&overview=full&access_token=${token}`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) {
      logger.warn(`Mapbox Directions respondió ${res.status}`)
      return null
    }
    const body: any = await res.json()
    const r = body?.routes?.[0]
    const linea: [number, number][] | undefined = r?.geometry?.coordinates
    if (!r || !linea || linea.length < 2) return null
    return {
      coords: linea.map(([lng, lat]) => [lat, lng] as Punto),
      distanciaM: Number(r.distance) || 0,
      duracionSeg: Number(r.duration) || 0,
    }
  } catch (err: any) {
    logger.warn(`Mapbox Directions falló: ${err?.message ?? err}`)
    return null
  }
}

// ---------------------------------------------------------------------------
// Caché por viaje.
// ---------------------------------------------------------------------------

const cache = new Map<number, Ruta>()
/** Llamadas a Mapbox hechas (métrica simple para vigilar el consumo). */
export let llamadasMapbox = 0

export function olvidarRuta(viajeId: number) {
  cache.delete(viajeId)
}

/** Sólo para pruebas. */
export function limpiarCacheRutas() {
  cache.clear()
  llamadasMapbox = 0
}

function rutaRecta(fase: Fase, desde: Punto, hasta: Punto, ahora: number): Ruta {
  const d = distanciaM(desde, hasta)
  return {
    fase,
    coords: [desde, hasta],
    distanciaM: d,
    duracionSeg: (d / 1000 / VELOCIDAD_RECTA_KMH) * 3600,
    fuente: 'recta',
    calculadaEn: ahora,
  }
}

function necesitaRecalculo(ruta: Ruta | undefined, fase: Fase, desvioM: number, ahora: number) {
  if (!ruta || ruta.fase !== fase) return true
  const edad = ahora - ruta.calculadaEn
  if (edad < MIN_ENTRE_LLAMADAS_MS) return false
  if (ruta.fuente === 'recta') return edad >= REINTENTO_RECTA_MS
  return desvioM > DESVIO_M || edad >= REFRESCO_MS
}

/**
 * Ruta del conductor hacia el objetivo de la fase actual y su ETA.
 * Devuelve null si el viaje no está en una fase con ruta.
 */
export async function rutaDelViaje(
  viaje: {
    id: number
    estado: string
    origenLat: number
    origenLng: number
    destinoLat: number
    destinoLng: number
  },
  conductor: Punto,
  opts: { proveedor?: ProveedorRuta; ahora?: number } = {}
): Promise<EstadoRuta | null> {
  const fase = faseDe(viaje.estado)
  if (!fase) {
    olvidarRuta(viaje.id)
    return null
  }
  const ahora = opts.ahora ?? Date.now()
  const hasta: Punto =
    fase === 'recogida'
      ? [Number(viaje.origenLat), Number(viaje.origenLng)]
      : [Number(viaje.destinoLat), Number(viaje.destinoLng)]

  let ruta = cache.get(viaje.id)
  let recalculada = false
  const actual = ruta && ruta.fase === fase ? posicionEnRuta(conductor, ruta.coords) : null

  if (necesitaRecalculo(ruta, fase, actual?.desvioM ?? Infinity, ahora)) {
    const proveedor = opts.proveedor ?? mapboxDirections
    llamadasMapbox++
    const r = await proveedor(conductor, hasta)
    ruta = r
      ? { fase, ...r, fuente: 'mapbox', calculadaEn: ahora }
      : rutaRecta(fase, conductor, hasta, ahora)
    cache.set(viaje.id, ruta)
    recalculada = true
  }

  const pos = posicionEnRuta(conductor, ruta!.coords)
  const restanteM = recalculada ? ruta!.distanciaM : pos.restanteM
  const proporcion = ruta!.distanciaM > 0 ? restanteM / ruta!.distanciaM : 0
  const etaMin = Math.max(1, Math.ceil((ruta!.duracionSeg * proporcion) / 60))
  return { ruta: ruta!, restanteM, etaMin, recalculada, conductor }
}

/**
 * Payload común de `trip:eta_update` / `trip:route_update` / GET /trips/:id/route.
 * Trae la posición del conductor con la que se calculó (`conductor: {lat, lng}`
 * y `ubicacionActualizadaEn` si se conoce): con el socket cortado en segundo
 * plano el cliente pierde `driver:location`, y sondeando GET /route recupera
 * dónde va el conductor sin depender del socket.
 */
export function payloadRuta(
  viajeId: number,
  estado: EstadoRuta,
  incluirLinea: boolean,
  ubicacionActualizadaEn?: string | null
) {
  return {
    tripId: String(viajeId),
    fase: estado.ruta.fase,
    minutos: estado.etaMin,
    restanteM: Math.round(estado.restanteM),
    distanciaM: Math.round(estado.ruta.distanciaM),
    aproximada: estado.ruta.fuente === 'recta',
    conductor: { lat: estado.conductor[0], lng: estado.conductor[1] },
    ubicacionActualizadaEn: ubicacionActualizadaEn ?? null,
    ...(incluirLinea ? { coords: estado.ruta.coords } : {}),
  }
}
