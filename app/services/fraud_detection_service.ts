import db from '@adonisjs/lucid/services/db'
import logger from '@adonisjs/core/services/logger'
import { DateTime } from 'luxon'

const EARTH_RADIUS_KM = 6371
const MAX_PLAUSIBLE_SPEED_KM_S = 0.45 // ~1600 km/h (supersonic jet)

interface GpsFraudDetectionInput {
  conductorId: number
  userId: number
  lat: number
  lng: number
  speed?: number | null
}

interface LastLocation {
  lat: number
  lng: number
  timestamp: DateTime
}

const lastLocations = new Map<number, LastLocation>()

function haversineDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return EARTH_RADIUS_KM * c
}

// Basic coordinate validity check
function isValidCoordinate(lat: number, lng: number): boolean {
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
}

// Suspicious locations: middle of ocean, Antarctica, etc.
const SUSPICIOUS_ZONES: Array<{ minLat: number; maxLat: number; minLng: number; maxLng: number; name: string }> = [
  { minLat: -90, maxLat: -80, minLng: -180, maxLng: 180, name: 'Antártida' },
  { minLat: -60, maxLat: -50, minLng: -70, maxLng: -40, name: 'Océano Atlántico Sur (frente a Argentina)' },
  { minLat: 0, maxLat: 10, minLng: -50, maxLng: -30, name: 'Océano Atlántico ecuatorial' },
]

// Bogotá reference location for teleport detection
const COLOMBIA_BOUNDS = {
  minLat: -4.5, maxLat: 13.5,
  minLng: -80, maxLng: -66,
}

export default class FraudDetectionService {
  static async analyzeLocation(input: GpsFraudDetectionInput): Promise<void> {
    const { conductorId, userId, lat, lng, speed } = input

    if (!isValidCoordinate(lat, lng)) {
      await this.logFraud(conductorId, userId, 'COORDENADA_INVALIDA', {
        descripcion: `Coordenada fuera de rango: (${lat}, ${lng})`,
        latitud: lat, longitud: lng, velocidad: speed,
      })
      return
    }

    // Check suspicious zones
    const inSuspiciousZone = SUSPICIOUS_ZONES.find(
      (z) => lat >= z.minLat && lat <= z.maxLat && lng >= z.minLng && lng <= z.maxLng
    )
    if (inSuspiciousZone) {
      await this.logFraud(conductorId, userId, 'GPS_SOSPECHOSO', {
        descripcion: `Coordenada en zona sospechosa: ${inSuspiciousZone.name}`,
        latitud: lat, longitud: lng, velocidad: speed,
        metadata: { zona: inSuspiciousZone.name },
      })
      return
    }

    // Speed check (if provided by device)
    if (speed !== null && speed !== undefined && !isNaN(speed)) {
      if (speed > 500) {
        await this.logFraud(conductorId, userId, 'VELOCIDAD_IMPÓSIBLE', {
          descripcion: `Velocidad reportada: ${Math.round(speed)} km/h`,
          latitud: lat, longitud: lng, velocidad: speed,
        })
        return
      }
    }

    // Check last location for impossible movements
    const last = lastLocations.get(conductorId)
    if (last) {
      const now = DateTime.now()
      const secondsSinceLast = now.diff(last.timestamp, 'seconds').seconds
      if (secondsSinceLast > 0) {
        const distanceKm = haversineDistanceKm(last.lat, last.lng, lat, lng)
        const speedKmS = distanceKm / secondsSinceLast

        // Speed above MAX_PLAUSIBLE_SPEED_KM_S (~1600 km/h) is teleportation
        if (speedKmS > MAX_PLAUSIBLE_SPEED_KM_S) {
          await this.logFraud(conductorId, userId, 'TELETRANSPORTE_GPS', {
            descripcion: `Salto de ${distanceKm.toFixed(0)} km en ${secondsSinceLast.toFixed(0)}s (${(speedKmS * 3600).toFixed(0)} km/h)`,
            latitud: lat, longitud: lng, velocidad: speedKmS * 3600,
            metadata: {
              distanciaKm: Math.round(distanceKm * 100) / 100,
              segundos: Math.round(secondsSinceLast),
              origen: { lat: last.lat, lng: last.lng },
              destino: { lat, lng },
            },
          })
        }

        // GPS frozen: same coordinates for more than 5 minutes
        const distanceFromLast = haversineDistanceKm(last.lat, last.lng, lat, lng)
        if (distanceFromLast < 0.001 && secondsSinceLast > 300) {
          await this.logFraud(conductorId, userId, 'GPS_CONGELADO', {
            descripcion: `Misma ubicación por ${secondsSinceLast.toFixed(0)} segundos`,
            latitud: lat, longitud: lng, velocidad: speed ?? 0,
            metadata: { segundosCongelado: Math.round(secondsSinceLast) },
          })
        }

        // Driver outside Colombia entirely
        if (
          lat < COLOMBIA_BOUNDS.minLat || lat > COLOMBIA_BOUNDS.maxLat ||
          lng < COLOMBIA_BOUNDS.minLng || lng > COLOMBIA_BOUNDS.maxLng
        ) {
          await this.logFraud(conductorId, userId, 'GPS_SOSPECHOSO', {
            descripcion: `Conductor fuera de Colombia: (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
            latitud: lat, longitud: lng, velocidad: speed ?? 0,
            metadata: { fueraDeColombia: true },
          })
        }
      }
    }

    // Update last location
    lastLocations.set(conductorId, { lat, lng, timestamp: DateTime.now() })
  }

  private static async logFraud(
    conductorId: number,
    userId: number,
    tipo: string,
    data: {
      descripcion?: string
      latitud?: number
      longitud?: number
      velocidad?: number | null
      metadata?: Record<string, any>
    }
  ): Promise<void> {
    try {
      await db.table('logs_fraude').insert({
        user_id: userId,
        conductor_id: conductorId,
        tipo,
        descripcion: data.descripcion ?? null,
        latitud: data.latitud ?? null,
        longitud: data.longitud ?? null,
        velocidad: data.velocidad ?? null,
        metadata: data.metadata ? JSON.stringify(data.metadata) : null,
        created_at: DateTime.now().toFormat('yyyy-MM-dd HH:mm:ss'),
      })
      logger.warn({ conductorId, tipo, descripcion: data.descripcion }, `Fraud detected: ${tipo}`)
    } catch (err) {
      logger.error({ err, conductorId, tipo }, 'Failed to log fraud event')
    }
  }

  static reset(conductorId?: number) {
    if (conductorId !== undefined) {
      lastLocations.delete(conductorId)
    } else {
      lastLocations.clear()
    }
  }
}