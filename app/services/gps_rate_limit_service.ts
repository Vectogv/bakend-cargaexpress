import logger from '@adonisjs/core/services/logger'

let RedisClient: any = null
try {
  RedisClient = (await import('ioredis')).default
} catch {
  // ioredis not installed — will use in-memory fallback
}

const FALLBACK_STORE = new Map<number, number>()

const PREFIX = 'gps_rate_limit:'
const TTL_SECONDS = 10 // slightly above the 8s window to avoid false negatives
const MIN_INTERVAL_MS = 8_000

let redis: InstanceType<typeof RedisClient> | null = null
try {
  if (RedisClient) {
    redis = new RedisClient({
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: Number(process.env.REDIS_PORT) || 6379,
      password: process.env.REDIS_PASSWORD || undefined,
      keyPrefix: PREFIX,
      maxRetriesPerRequest: 1,
      retryStrategy(times: number) {
        if (times > 3) return null
        return Math.min(times * 100, 1000)
      },
      lazyConnect: true,
    })
  }
} catch {
  logger.warn('Redis unavailable for GPS rate limit — using in-memory fallback')
  redis = null
}

const GPS_RATE_LIMIT_SERVICE = {
  async checkAndMark(conductorId: number): Promise<boolean> {
    const now = Date.now()

    if (redis) {
      try {
        const lastStr = await redis.get(String(conductorId))
        if (lastStr) {
          const last = Number(lastStr)
          if (now - last < MIN_INTERVAL_MS) {
            return false
          }
        }
        await redis.set(String(conductorId), String(now), 'EX', TTL_SECONDS)
        return true
      } catch {
        return this.inMemoryCheckAndMark(conductorId, now)
      }
    }

    return this.inMemoryCheckAndMark(conductorId, now)
  },

  inMemoryCheckAndMark(conductorId: number, now: number): boolean {
    const last = FALLBACK_STORE.get(conductorId)
    if (last && now - last < MIN_INTERVAL_MS) {
      return false
    }
    FALLBACK_STORE.set(conductorId, now)
    return true
  },

  reset(conductorId?: number) {
    if (conductorId !== undefined) {
      FALLBACK_STORE.delete(conductorId)
      if (redis) {
        redis.del(String(conductorId)).catch(() => {})
      }
    } else {
      FALLBACK_STORE.clear()
    }
  },

  async quit() {
    if (redis) {
      try {
        await redis.quit()
      } catch {}
    }
  },
}

export default GPS_RATE_LIMIT_SERVICE