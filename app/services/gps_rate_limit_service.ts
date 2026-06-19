import RedisService from '#services/redis_service'

const GPS_RATE_LIMIT_SERVICE = {
  async checkAndMark(conductorId: number): Promise<boolean> {
    return RedisService.checkGpsRateLimit(conductorId)
  },

  reset(conductorId?: number) {
    if (conductorId !== undefined) {
      RedisService.del(`${RedisService.GPS_PREFIX}${conductorId}`)
    }
  },

  async quit() {
    // no-op: RedisService manages its own lifecycle
  },
}

export default GPS_RATE_LIMIT_SERVICE
