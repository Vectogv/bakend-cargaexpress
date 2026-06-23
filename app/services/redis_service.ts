import { default as Ioredis } from 'ioredis'
import logger from '@adonisjs/core/services/logger'
import env from '#start/env'

let client: Ioredis | null = null
let fallbackCache = new Map<string, { value: any; expiresAt: number }>()

function createClient(): Ioredis | null {
  try {
    const c = new Ioredis({
      host: env.get('REDIS_HOST', '127.0.0.1'),
      port: Number(env.get('REDIS_PORT', '6379')),
      password: env.get('REDIS_PASSWORD') || undefined,
      maxRetriesPerRequest: 3,
      retryStrategy(times: number) {
        if (times > 3) return null
        return Math.min(times * 100, 500)
      },
      lazyConnect: true,
      enableOfflineQueue: false,
    })
    c.on('error', (err) => logger.warn({ err }, 'Redis connection error (degraded mode)'))
    c.on('ready', () => logger.info('Redis connected'))
    c.on('end', () => logger.warn('Redis connection ended — using in-memory fallback'))
    c.on('close', () => logger.warn('Redis connection closed'))
    return c
  } catch (err) {
    logger.warn({ err }, 'Redis unavailable — using in-memory fallback')
    return null
  }
}

function getClient(): Ioredis | null {
  if (!client) {
    client = createClient()
  }
  return client
}

const RedisService = {
  // ── Connection ──────────────────────────────────────────────────
  async connect(): Promise<boolean> {
    const c = getClient()
    if (!c) return false
    try {
      await c.connect()
      return true
    } catch {
      return false
    }
  },

  async quit(): Promise<void> {
    if (client) {
      try { await client.quit() } catch {}
      client = null
    }
  },

  getClient(): Ioredis | null {
    return getClient()
  },

  isConnected(): boolean {
    return client?.status === 'ready'
  },

  // ── Generic get/set with TTL ────────────────────────────────────
  async get(key: string): Promise<string | null> {
    const c = getClient()
    if (c) {
      try { return await c.get(key) } catch { /* fallback */ }
    }
    const fb = fallbackCache.get(key)
    if (fb && fb.expiresAt > Date.now()) return fb.value
    if (fb) fallbackCache.delete(key)
    return null
  },

  async set(key: string, value: string, ttlSeconds = 0): Promise<void> {
    const c = getClient()
    if (c) {
      try {
        if (ttlSeconds > 0) await c.setex(key, ttlSeconds, value)
        else await c.set(key, value)
        return
      } catch { /* fallback */ }
    }
    fallbackCache.set(key, { value, expiresAt: ttlSeconds > 0 ? Date.now() + ttlSeconds * 1000 : Infinity })
  },

  async del(key: string): Promise<void> {
    const c = getClient()
    if (c) {
      try { await c.del(key) } catch { /* ignore */ }
    }
    fallbackCache.delete(key)
  },

  // ── Rate limiting (GPS) ────────────────────────────────────────
  GPS_MIN_INTERVAL_MS: 4_000,
  GPS_PREFIX: 'gps_rate_limit:',

  async checkGpsRateLimit(conductorId: number): Promise<boolean> {
    const key = `${this.GPS_PREFIX}${conductorId}`
    const now = Date.now()
    const lastStr = await this.get(key)
    if (lastStr) {
      const last = Number(lastStr)
      if (now - last < this.GPS_MIN_INTERVAL_MS) return false
    }
    await this.set(key, String(now), 10)
    return true
  },

  // ── Locking (concurrency) ──────────────────────────────────────
  LOCK_PREFIX: 'lock:',
  LOCK_TTL_MS: 5_000,

  async acquireLock(resource: string, ttlMs = this.LOCK_TTL_MS): Promise<boolean> {
    const c = getClient()
    if (c) {
      try {
        const result = await c.set(`${this.LOCK_PREFIX}${resource}`, '1', 'PX', ttlMs, 'NX')
        return result === 'OK'
      } catch {
        return true // lock degraded: allow pass-through
      }
    }
    // In-memory fallback: simple optimistic lock
    const key = `${this.LOCK_PREFIX}${resource}`
    if (fallbackCache.has(key)) return false
    fallbackCache.set(key, { value: '1', expiresAt: Date.now() + ttlMs })
    return true
  },

  async releaseLock(resource: string): Promise<void> {
    await this.del(`${this.LOCK_PREFIX}${resource}`)
  },

  // ── Cache ──────────────────────────────────────────────────────
  CACHE_PREFIX: 'cache:',
  CACHE_DEFAULT_TTL: 60,

  async cacheGet<T>(key: string): Promise<T | null> {
    const raw = await this.get(`${this.CACHE_PREFIX}${key}`)
    if (!raw) return null
    try { return JSON.parse(raw) as T } catch { return null }
  },

  async cacheSet(key: string, value: any, ttlSeconds = this.CACHE_DEFAULT_TTL): Promise<void> {
    await this.set(`${this.CACHE_PREFIX}${key}`, JSON.stringify(value), ttlSeconds)
  },

  async cacheDel(key: string): Promise<void> {
    await this.del(`${this.CACHE_PREFIX}${key}`)
  },

  // ── Rate limiter genérico (para middleware) ────────────────────
  RATE_LIMIT_PREFIX: 'ratelimit:',

  async checkRateLimit(key: string, maxRequests: number, windowMs: number): Promise<{ allowed: boolean; remaining: number; resetMs: number }> {
    const c = getClient()
    if (c) {
      try {
        const now = Date.now()
        const windowKey = `${this.RATE_LIMIT_PREFIX}${key}:${Math.floor(now / windowMs)}`
        const count = await c.incr(windowKey)
        if (count === 1) await c.pexpire(windowKey, windowMs)
        const ttl = await c.pttl(windowKey)
        return {
          allowed: count <= maxRequests,
          remaining: Math.max(0, maxRequests - count),
          resetMs: ttl > 0 ? ttl : windowMs,
        }
      } catch { /* fallback */ }
    }
    return { allowed: true, remaining: 1, resetMs: windowMs }
  },

  // ── Session / Token blacklist ──────────────────────────────────
  TOKEN_BLACKLIST_PREFIX: 'token:blacklist:',

  async blacklistToken(token: string, expiresInSeconds: number): Promise<void> {
    await this.set(`${this.TOKEN_BLACKLIST_PREFIX}${token}`, '1', expiresInSeconds)
  },

  async isTokenBlacklisted(token: string): Promise<boolean> {
    const val = await this.get(`${this.TOKEN_BLACKLIST_PREFIX}${token}`)
    return val !== null
  },

  // ── Active socket tracking ─────────────────────────────────────
  SOCKET_PREFIX: 'socket:active:',

  async setSocketConnection(userId: number, socketId: string): Promise<void> {
    await this.set(`${this.SOCKET_PREFIX}${userId}`, socketId, 60)
  },

  async removeSocketConnection(userId: number): Promise<void> {
    await this.del(`${this.SOCKET_PREFIX}${userId}`)
  },

  async getSocketConnection(userId: number): Promise<string | null> {
    return this.get(`${this.SOCKET_PREFIX}${userId}`)
  },

  // ── Trip cache ────────────────────────────────────────────────
  TRIP_PREFIX: 'trip:',

  async cacheTrip(tripId: number | string, tripData: object, ttlSeconds = 120): Promise<void> {
    await this.cacheSet(`trip:${tripId}`, tripData, ttlSeconds)
  },

  async getCachedTrip(tripId: number | string): Promise<object | null> {
    return this.cacheGet<object>(`trip:${tripId}`)
  },

  // ── Driver location cache ─────────────────────────────────────
  DRIVER_LOCATION_PREFIX: 'driver:location:',

  async cacheDriverLocation(conductorId: number, lat: number, lng: number): Promise<void> {
    await this.set(`${this.DRIVER_LOCATION_PREFIX}${conductorId}`, `${lat},${lng}`, 30)
  },

  async getCachedDriverLocation(conductorId: number): Promise<{ lat: number; lng: number } | null> {
    const raw = await this.get(`${this.DRIVER_LOCATION_PREFIX}${conductorId}`)
    if (!raw) return null
    const [lat, lng] = raw.split(',').map(Number)
    return { lat, lng }
  },
}

export default RedisService

// Railway deploy marker: 20260619171925
