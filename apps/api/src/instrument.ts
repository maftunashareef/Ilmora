import * as Sentry from '@sentry/nestjs'

/**
 * Sentry must be initialised before NestJS is imported. Personal data never leaves the server:
 * sendDefaultPii is off and beforeSend strips headers, cookies, auth/OTP/token fields and query strings.
 */
const SENSITIVE_KEYS = /^(authorization|cookie|set-cookie|x-api-key|code|otp|token|t|refresh|password|phone|phonee164|card|pan|cvv|sign_string|account)$/i

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SENSITIVE_KEYS.test(k) ? '[Filtered]' : scrub(v, depth + 1)
  }
  return out
}

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies
        delete event.request.query_string
        event.request.headers = Object.fromEntries(Object.entries(event.request.headers ?? {}).filter(([k]) => !SENSITIVE_KEYS.test(k)))
        if (event.request.data) event.request.data = scrub(event.request.data) as typeof event.request.data
        if (event.request.url) event.request.url = event.request.url.split('?')[0]
      }
      if (event.user) event.user = { id: event.user.id }
      if (event.extra) event.extra = scrub(event.extra) as typeof event.extra
      if (event.contexts) event.contexts = scrub(event.contexts) as typeof event.contexts
      return event
    },
    beforeBreadcrumb(crumb) {
      if (crumb.data) crumb.data = scrub(crumb.data) as typeof crumb.data
      return crumb
    },
  })
}

export const sentryEnabled = !!process.env.SENTRY_DSN
export { Sentry }
