import prometheus from 'prom-client'
import logger from '@adonisjs/core/services/logger'

let initialized = false

const MetricsService = {
  httpRequestDuration: null as prometheus.Histogram<string> | null,
  httpRequestTotal: null as prometheus.Counter<string> | null,
  activeSocketConnections: null as prometheus.Gauge<string> | null,
  gpsUpdatesTotal: null as prometheus.Counter<string> | null,
  tripsCreatedTotal: null as prometheus.Counter<string> | null,
  tripsCompletedTotal: null as prometheus.Counter<string> | null,
  errorsTotal: null as prometheus.Counter<string> | null,
  fraudDetectionsTotal: null as prometheus.Counter<string> | null,
  dbQueryDuration: null as prometheus.Histogram<string> | null,
  redisOperationDuration: null as prometheus.Histogram<string> | null,

  init() {
    if (initialized) return
    try {
      prometheus.collectDefaultMetrics({ register: prometheus.register, prefix: 'cargaexpress_' })

      this.httpRequestDuration = new prometheus.Histogram({
        name: 'cargaexpress_http_request_duration_ms',
        help: 'HTTP request duration in milliseconds',
        labelNames: ['method', 'route', 'status'],
        buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2000, 5000],
      })

      this.httpRequestTotal = new prometheus.Counter({
        name: 'cargaexpress_http_requests_total',
        help: 'Total HTTP requests',
        labelNames: ['method', 'route', 'status'],
      })

      this.activeSocketConnections = new prometheus.Gauge({
        name: 'cargaexpress_active_socket_connections',
        help: 'Number of active Socket.IO connections',
      })

      this.gpsUpdatesTotal = new prometheus.Counter({
        name: 'cargaexpress_gps_updates_total',
        help: 'Total GPS location updates',
        labelNames: ['status'],
      })

      this.tripsCreatedTotal = new prometheus.Counter({
        name: 'cargaexpress_trips_created_total',
        help: 'Total trips created',
      })

      this.tripsCompletedTotal = new prometheus.Counter({
        name: 'cargaexpress_trips_completed_total',
        help: 'Total trips completed',
      })

      this.errorsTotal = new prometheus.Counter({
        name: 'cargaexpress_errors_total',
        help: 'Total errors by type',
        labelNames: ['type'],
      })

      this.fraudDetectionsTotal = new prometheus.Counter({
        name: 'cargaexpress_fraud_detections_total',
        help: 'Total fraud detections',
        labelNames: ['tipo'],
      })

      this.dbQueryDuration = new prometheus.Histogram({
        name: 'cargaexpress_db_query_duration_ms',
        help: 'Database query duration in milliseconds',
        buckets: [1, 5, 10, 25, 50, 100, 250, 500],
      })

      this.redisOperationDuration = new prometheus.Histogram({
        name: 'cargaexpress_redis_operation_duration_ms',
        help: 'Redis operation duration in milliseconds',
        labelNames: ['operation'],
        buckets: [1, 5, 10, 25, 50, 100],
      })

      initialized = true
      logger.info('Prometheus metrics initialized')
    } catch (err) {
      logger.error({ err }, 'Failed to initialize Prometheus metrics')
    }
  },

  async getMetrics(): Promise<string> {
    try {
      return await prometheus.register.metrics()
    } catch {
      return '# Metrics not available'
    }
  },

  getContentType(): string {
    return prometheus.register.contentType
  },

  observeHttp(method: string, route: string, statusCode: number, durationMs: number) {
    this.httpRequestDuration?.observe({ method, route, status: String(statusCode) }, durationMs)
    this.httpRequestTotal?.inc({ method, route, status: String(statusCode) })
  },

  incGpsUpdates(status: 'allowed' | 'rate_limited' | 'error') {
    this.gpsUpdatesTotal?.inc({ status })
  },

  incTripsCreated() {
    this.tripsCreatedTotal?.inc()
  },

  incTripsCompleted() {
    this.tripsCompletedTotal?.inc()
  },

  incErrors(type: string) {
    this.errorsTotal?.inc({ type })
  },

  incFraudDetections(tipo: string) {
    this.fraudDetectionsTotal?.inc({ tipo })
  },

  setActiveSockets(count: number) {
    this.activeSocketConnections?.set(count)
  },

  observeDbQuery(durationMs: number) {
    this.dbQueryDuration?.observe(durationMs)
  },

  observeRedisOp(operation: string, durationMs: number) {
    this.redisOperationDuration?.observe({ operation }, durationMs)
  },
}

export default MetricsService
