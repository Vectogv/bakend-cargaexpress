import { DateTime } from 'luxon'
import Viaje from '#models/viaje'
import Conductor from '#models/conductor'
import ViajeRecorrido from '#models/viaje_recorrido'
import ConfiguracionPlataforma from '#models/configuracion_plataforma'
import { distanciaM, faseDe, osrmDirections, rutaGuardada, type Punto } from '#services/trip_route_service'
import { ESTADOS_CONDUCTOR_OCUPADO } from '#services/trip_conflict_service'

/**
 * Ruta planeada de un viaje cerrado (origen→destino), o de uno activo sin
 * ruta guardada: el panel de moderación/admin no debe consumir Mapbox (eso
 * lo paga solo la app), así que se pide a OSRM (público, sin token) y se
 * cachea por viajeId con un TTL largo, porque un viaje cerrado no cambia de
 * ruta. Si OSRM falla, queda sin ruta planeada (nunca cae a Mapbox).
 */
const CACHE_CERRADA_TOPE = 500
const CACHE_CERRADA_TTL_MS = 24 * 60 * 60_000
const cacheCerrada = new Map<number, { coords: Punto[]; expiraEn: number }>()

function leerCacheCerrada(viajeId: number): Punto[] | null {
  const entrada = cacheCerrada.get(viajeId)
  if (!entrada) return null
  if (Date.now() > entrada.expiraEn) {
    cacheCerrada.delete(viajeId)
    return null
  }
  return entrada.coords
}

function guardarCacheCerrada(viajeId: number, coords: Punto[]) {
  if (cacheCerrada.size >= CACHE_CERRADA_TOPE && !cacheCerrada.has(viajeId)) {
    const primero = cacheCerrada.keys().next().value
    if (primero !== undefined) cacheCerrada.delete(primero)
  }
  cacheCerrada.set(viajeId, { coords, expiraEn: Date.now() + CACHE_CERRADA_TTL_MS })
}

/** Solo para pruebas. */
export function limpiarCacheRutaCerrada() {
  cacheCerrada.clear()
}

/** Se guarda un punto nuevo solo si pasaron ≥ 15 s o se movió ≥ 30 m. */
export const RECORRIDO_MIN_SEG = 15
export const RECORRIDO_MIN_M = 30

export async function guardarPuntoRecorrido(viajeId: number, lat: number, lng: number) {
  const ultimo = await ViajeRecorrido.query().where('viaje_id', viajeId).orderBy('id', 'desc').first()
  if (ultimo) {
    const seg = DateTime.now().diff(ultimo.createdAt, 'seconds').seconds
    const metros = distanciaM([ultimo.lat, ultimo.lng], [lat, lng])
    if (seg < RECORRIDO_MIN_SEG && metros < RECORRIDO_MIN_M) return null
  }
  return ViajeRecorrido.create({ viajeId, lat, lng })
}

export type PuntoRecorrido = { lat: number; lng: number; at: string | null }

/**
 * Ubicación del conductor solo si está conectado (regla del panel, 2026-10-08):
 * un desconectado no aparece en el mapa ni entrega coordenadas. `activo` permite
 * exigir además un viaje activo (detalle del viaje).
 */
export function ubicacionSiConectado(c: Conductor | null | undefined, activo = true) {
  if (!c || !c.online || !activo || c.ultimaUbicacionLat == null || c.ultimaUbicacionLng == null) return null
  return {
    lat: Number(c.ultimaUbicacionLat),
    lng: Number(c.ultimaUbicacionLng),
    actualizadaEn: c.ubicacionActualizadaEn?.toISO() ?? null,
  }
}

/**
 * Lo que el panel dibuja: A, B, ruta planeada (azul), recorrido real (rojo),
 * último punto con su hora y, si el conductor está conectado, dónde está ahora.
 */
export async function payloadRecorrido(viaje: Viaje, conductor: Conductor | null) {
  const puntos = await ViajeRecorrido.query().where('viaje_id', viaje.id).orderBy('id', 'asc')
  const recorrido: PuntoRecorrido[] = puntos.map((p) => ({ lat: p.lat, lng: p.lng, at: p.createdAt?.toISO() ?? null }))
  const ultimoPunto = recorrido.length ? recorrido[recorrido.length - 1] : null
  const activo = ESTADOS_CONDUCTOR_OCUPADO.includes(viaje.estado)

  const origen: Punto = [Number(viaje.origenLat), Number(viaje.origenLng)]
  const destino: Punto = [Number(viaje.destinoLat), Number(viaje.destinoLng)]
  const hayCoords = origen.every(Number.isFinite) && destino.every(Number.isFinite)

  // Planeada: en un viaje activo, la de la fase actual, pero SOLO leyendo lo
  // que la app ya guardó (sin forzar un recálculo de Mapbox desde el panel);
  // si no hay nada guardado, o el viaje está cerrado, se pide a OSRM.
  let planeada: { coords: Punto[]; fase: string | null; fuente: string } | null = null
  if (hayCoords) {
    if (activo && ultimoPunto) {
      const fase = faseDe(viaje.estado)
      const guardada = fase ? rutaGuardada(viaje.id) : null
      if (guardada && guardada.fase === fase) {
        planeada = { coords: guardada.coords, fase: guardada.fase, fuente: guardada.fuente }
      } else if (fase) {
        const hasta = fase === 'recogida' ? origen : destino
        const r = await osrmDirections([ultimoPunto.lat, ultimoPunto.lng], hasta)
        planeada = r ? { coords: r.coords, fase, fuente: 'osrm' } : null
      }
    }
    if (!planeada) {
      const cacheada = leerCacheCerrada(viaje.id)
      if (cacheada) {
        planeada = { coords: cacheada, fase: null, fuente: 'osrm' }
      } else {
        const r = await osrmDirections(origen, destino)
        if (r) {
          guardarCacheCerrada(viaje.id, r.coords)
          planeada = { coords: r.coords, fase: null, fuente: 'osrm' }
        }
      }
    }
  }

  const conductorUbicacion = ubicacionSiConectado(conductor, activo)

  return {
    viajeId: viaje.id,
    estado: viaje.estado,
    activo,
    origen: hayCoords ? { lat: origen[0], lng: origen[1], direccion: viaje.origenDireccion } : null,
    destino: hayCoords ? { lat: destino[0], lng: destino[1], direccion: viaje.destinoDireccion } : null,
    planeada,
    recorrido,
    ultimoPunto,
    conductorUbicacion,
  }
}

/** Días de inactividad configurados por gerencia (7 si no hay fila). */
export async function diasInactividad() {
  const config = await ConfiguracionPlataforma.unica()
  const n = Number(config?.inactividadDias)
  return Number.isFinite(n) && n >= 1 ? Math.round(n) : 7
}
