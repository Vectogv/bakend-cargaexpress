import logger from '@adonisjs/core/services/logger'
import RedisService from '#services/redis_service'
import LogFraude from '#models/log_fraude'

type FraudType = 'COORDENADA_INVALIDA' | 'GPS_SOSPECHOSO' | 'VELOCIDAD_IMPÓSIBLE' | 'TELETRANSPORTE_GPS' | 'GPS_CONGELADO'

const EARTH_RADIUS_KM = 6371
const MAX_SPEED_KMH = 180
const MAX_SPEED_KMS = MAX_SPEED_KMH / 3600
const FREEZE_THRESHOLD_MS = 60_000
const FREEZE_DISTANCE_M = 5

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const PREVIOUS_LOCATION_PREFIX = 'fraud:prev_location:'
const LAST_UPDATE_PREFIX = 'fraud:last_update:'

const FraudDetectionService = {
  async analyzeLocation(conductorId: number, lat: number, lng: number, tripId?: number) {
    const frauds: FraudType[] = []

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      frauds.push('COORDENADA_INVALIDA')
    }

    if (lat === 0 && lng === 0) {
      frauds.push('GPS_SOSPECHOSO')
    }

    const prevLocationRaw = await RedisService.get(`${PREVIOUS_LOCATION_PREFIX}${conductorId}`)
    const lastTimeRaw = await RedisService.get(`${LAST_UPDATE_PREFIX}${conductorId}`)

    if (prevLocationRaw && lastTimeRaw) {
      const [prevLat, prevLng] = prevLocationRaw.split(',').map(Number)
      const prevTime = Number(lastTimeRaw)
      const now = Date.now()
      const elapsed = (now - prevTime) / 1000

      if (elapsed > 0) {
        const distKm = haversineKm(prevLat, prevLng, lat, lng)
        const speedKms = distKm / elapsed

        if (speedKms > MAX_SPEED_KMS) {
          frauds.push('VELOCIDAD_IMPÓSIBLE')
        }

        if (speedKms > 0.5 && elapsed < 5) {
          frauds.push('TELETRANSPORTE_GPS')
        }
      }

      if (elapsed > FREEZE_THRESHOLD_MS / 1000) {
        const distM = haversineKm(prevLat, prevLng, lat, lng) * 1000
        if (distM < FREEZE_DISTANCE_M) {
          frauds.push('GPS_CONGELADO')
        }
      }
    }

    await RedisService.set(`${PREVIOUS_LOCATION_PREFIX}${conductorId}`, `${lat},${lng}`, 300)
    await RedisService.set(`${LAST_UPDATE_PREFIX}${conductorId}`, String(Date.now()), 300)

    const conductorIdNum = Number(conductorId)

    for (const tipoFraude of frauds) {
      logger.warn({ conductorId: conductorIdNum, tipoFraude, lat, lng, tripId }, 'Fraud detected')
      try {
        await LogFraude.create({ conductorId: conductorIdNum, tipo: tipoFraude, latitud: lat, longitud: lng, metadata: tripId ? { viajeId: tripId } : null })
      } catch (err) {
        logger.error({ err, conductorId: conductorIdNum }, 'Failed to log fraud')
      }
    }

    return frauds
  },
}

export default FraudDetectionService
