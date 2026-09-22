import type AlertaEmergencia from '#models/alerta_emergencia'
import type Conductor from '#models/conductor'
import type Viaje from '#models/viaje'
import { distanciaKm } from '#services/geo_service'

/**
 * Datos del mapa del SOS (contrato CONTRATO_MAPA_SOS.md): coordenadas del viaje,
 * ubicación del conductor y distancias del punto de pánico. Solo se AÑADEN campos:
 * `viaje.origen` / `viaje.destino` siguen siendo el texto de la dirección.
 */

export interface Coordenada {
  lat: number
  lng: number
}

export interface ConductorUbicacion extends Coordenada {
  actualizadaEn: string | null
}

export interface DistanciasSos {
  distanciaOrigenKm: number
  distanciaDestinoKm: number
  /** 0..1 aproximado: distanciaOrigen / (origen→destino). Null si origen y destino coinciden. */
  avanceRuta: number | null
}

export interface DatosMapaSos {
  origenCoords: Coordenada | null
  destinoCoords: Coordenada | null
  conductorUbicacion: ConductorUbicacion | null
  sos: DistanciasSos | null
}

/**
 * Columnas del viaje necesarias para el mapa. Se añaden al `select` del preload
 * para no disparar consultas extra por alerta.
 */
export const COLUMNAS_VIAJE_MAPA_SOS = [
  'origen_lat',
  'origen_lng',
  'destino_lat',
  'destino_lng',
  'conductor_id',
] as const

/** Columnas del conductor necesarias para pintar su última ubicación. */
export const COLUMNAS_CONDUCTOR_MAPA_SOS = [
  'id',
  'usuario_id',
  'ultima_ubicacion_lat',
  'ultima_ubicacion_lng',
  'ubicacion_actualizada_en',
] as const

/** SQLite/MySQL devuelven los decimales como texto según el driver. */
function numero(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === '') return null
  const n = typeof valor === 'number' ? valor : Number(valor)
  return Number.isFinite(n) ? n : null
}

function redondear(valor: number, decimales: number): number {
  const factor = 10 ** decimales
  return Math.round(valor * factor) / factor
}

/** Devuelve la coordenada solo si ambas componentes son números válidos. */
export function coordenada(lat: unknown, lng: unknown): Coordenada | null {
  const latitud = numero(lat)
  const longitud = numero(lng)
  if (latitud === null || longitud === null) return null
  return { lat: latitud, lng: longitud }
}

/**
 * Construye los campos nuevos del payload de emergencias.
 * Requiere que el viaje venga precargado con `COLUMNAS_VIAJE_MAPA_SOS` y, si se
 * quiere la ubicación del conductor, con `conductor` precargado.
 */
export function datosMapaSos(alerta: AlertaEmergencia): DatosMapaSos {
  const viaje = alerta.viaje as Viaje | null | undefined
  const origenCoords = viaje ? coordenada(viaje.origenLat, viaje.origenLng) : null
  const destinoCoords = viaje ? coordenada(viaje.destinoLat, viaje.destinoLng) : null

  const conductor = viaje ? (viaje.conductor as Conductor | null | undefined) : null
  const conductorCoords = conductor
    ? coordenada(conductor.ultimaUbicacionLat, conductor.ultimaUbicacionLng)
    : null
  const conductorUbicacion: ConductorUbicacion | null =
    conductorCoords && conductor
      ? {
          ...conductorCoords,
          actualizadaEn: conductor.ubicacionActualizadaEn?.toISO() ?? null,
        }
      : null

  const sosCoords = coordenada(alerta.lat, alerta.lng)
  let sos: DistanciasSos | null = null
  if (sosCoords && origenCoords && destinoCoords) {
    const desdeOrigen = distanciaKm(origenCoords.lat, origenCoords.lng, sosCoords.lat, sosCoords.lng)
    const hastaDestino = distanciaKm(
      sosCoords.lat,
      sosCoords.lng,
      destinoCoords.lat,
      destinoCoords.lng
    )
    const ruta = distanciaKm(
      origenCoords.lat,
      origenCoords.lng,
      destinoCoords.lat,
      destinoCoords.lng
    )
    sos = {
      distanciaOrigenKm: redondear(desdeOrigen, 1),
      distanciaDestinoKm: redondear(hastaDestino, 1),
      avanceRuta: ruta > 0 ? redondear(Math.min(1, desdeOrigen / ruta), 2) : null,
    }
  }

  return { origenCoords, destinoCoords, conductorUbicacion, sos }
}
