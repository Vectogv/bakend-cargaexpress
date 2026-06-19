import * as Sentry from '@sentry/node'
import { nodeProfilingIntegration } from '@sentry/profiling-node'
import sentryConfig from '#config/sentry'
import logger from '@adonisjs/core/services/logger'

const SentryService = {
  initialized: false,

  init() {
    if (!sentryConfig.dsn) {
      logger.info('Sentry DSN not configured — skipping initialization')
      return
    }

    try {
      Sentry.init({
        dsn: sentryConfig.dsn,
        environment: sentryConfig.environment,
        tracesSampleRate: sentryConfig.tracesSampleRate,
        profilesSampleRate: sentryConfig.profilesSampleRate,
        integrations: [nodeProfilingIntegration()],
        attachStacktrace: sentryConfig.attachStacktrace,
        maxBreadcrumbs: sentryConfig.maxBreadcrumbs,
        debug: sentryConfig.debug,
        enabled: sentryConfig.enabled,
      })
      this.initialized = true
      logger.info('Sentry initialized')
    } catch (err) {
      logger.error({ err }, 'Failed to initialize Sentry')
    }
  },

  captureException(error: unknown, context?: Record<string, unknown>) {
    if (!this.initialized) return
    Sentry.withScope((scope) => {
      if (context) scope.setExtras(context)
      Sentry.captureException(error)
    })
  },

  captureMessage(message: string, level: Sentry.SeverityLevel = 'info', context?: Record<string, unknown>) {
    if (!this.initialized) return
    Sentry.withScope((scope) => {
      if (context) scope.setExtras(context)
      Sentry.captureMessage(message, level)
    })
  },

  setUser(userId: number | string, email?: string, username?: string) {
    if (!this.initialized) return
    Sentry.setUser({ id: String(userId), email, username })
  },

  removeUser() {
    if (!this.initialized) return
    Sentry.setUser(null)
  },

  async flush(timeoutMs = 2000) {
    if (!this.initialized) return
    await Sentry.flush(timeoutMs)
  },
}

export default SentryService
