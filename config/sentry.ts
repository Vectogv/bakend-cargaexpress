import env from '#start/env'

const sentryConfig = {
  dsn: env.get('SENTRY_DSN', ''),
  environment: env.get('NODE_ENV', 'development'),
  tracesSampleRate: env.get('NODE_ENV') === 'production' ? 0.25 : 0.0,
  profilesSampleRate: env.get('NODE_ENV') === 'production' ? 0.1 : 0.0,
  enabled: !!env.get('SENTRY_DSN'),
  attachStacktrace: true,
  maxBreadcrumbs: 50,
  debug: false,
}

export default sentryConfig
