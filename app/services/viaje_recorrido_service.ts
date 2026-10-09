import { DateTime } from 'luxon'
import Viaje from '#models/viaje'
import Conductor from '#models/conductor'
import ViajeRecorrido from '#models/viaje_recorrido'
import ConfiguracionPlataforma from '#models/configuracion_plataforma'
import { distanciaM, mapboxDirections, rutaDelViaje, type Punto } from '#services/trip_route_service'
import { ESTADOS_CONDUCTOR_OCUPADO } from '#services/trip_conflict_service'

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

  // Planeada: en un viaje activo es la de la fase actual (misma caché que la app);
  // en uno cerrado, origen→destino.
  let planeada: { coords: Punto[]; fase: string | null; fuente: string } | null = null
  if (hayCoords) {
    if (activo && ultimoPunto) {
      const estado = await rutaDelViaje(viaje, [ultimoPunto.lat, ultimoPunto.lng])
      if (estado) planeada = { coords: estado.ruta.coords, fase: estado.ruta.fase, fuente: estado.ruta.fuente }
    }
    if (!planeada) {
      const r = await mapboxDirections(origen, destino)
      planeada = r ? { coords: r.coords, fase: null, fuente: 'mapbox' } : null
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
