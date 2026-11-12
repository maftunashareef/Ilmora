import * as Sentry from '@sentry/nestjs'

/**
 * Sentry must be initialised before NestJS is imported. Personal data never leaves the server:
 * sendDefaultPii is off and beforeSend strips headers, cookies, auth/OTP/token fields and query strings.
 */
const SENSITIVE_KEYS = /^(authorization|cookie|set-cookie|x-api-key|code|otp|t|refresh|card|pan|cvv|sign_string|account|challenge)$/i
/** Any key with these in its name: `currentPassword`, `newPassword`, `idToken`, `contactPhone`… (re-check 11.11 №96). */
const SENSITIVE_PARTS = /password|passwd|secret|token|phone|recovery/i

export const isSensitiveKey = (key: string): boolean => SENSITIVE_KEYS.test(key) || SENSITIVE_PARTS.test(key)

export function scrub(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSensitiveKey(k) ? '[Filtered]' : scrub(v, depth + 1)
  }
  return out
}

/** A request body, which Sentry may hold as an object or as the raw JSON text: scrubbed either way; other text dropped. */
export function scrubBody(data: unknown): unknown {
  if (typeof data !== 'string') return scrub(data)
  try {
    return JSON.stringify(scrub(JSON.parse(data)))
  } catch {
    return '[Filtered]'
  }
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
        event.request.headers = Object.fromEntries(Object.entries(event.request.headers ?? {}).filter(([k]) => !isSensitiveKey(k)))
        if (event.request.data) event.request.data = scrubBody(event.request.data) as typeof event.request.data
        if (event.request.url) event.request.url = event.request.url.split('?')[0]
      }
      if (event.user) event.user = { id: event.user.id }
      if (event.extra) event.extra = scrub(event.extra) as typeof event.extra
      if (event.contexts) event.contexts = scrub(event.contexts) as typeof event.contexts
      return event
    },
    beforeBreadcrumb(crumb) {
      // Outgoing-HTTP breadcrumbs carry the full request URL; the Google `tokeninfo` call puts the id_token in the
      // query string, and key-based scrubbing can't catch a token that lives in the URL value — so drop every
      // breadcrumb query string outright (Ж16).
      if (crumb.data) {
        if (typeof crumb.data.url === 'string') crumb.data.url = crumb.data.url.split('?')[0]
        crumb.data = scrub(crumb.data) as typeof crumb.data
      }
      return crumb
    },
  })
}

export const sentryEnabled = !!process.env.SENTRY_DSN
export { Sentry }
