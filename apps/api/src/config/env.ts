import { z } from 'zod'

const bool = (def: boolean) =>
  z
    .enum(['true', 'false', '1', '0'])
    .default(def ? 'true' : 'false')
    .transform((v) => v === 'true' || v === '1')

const csv = z
  .string()
  .default('')
  .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))

/**
 * Every environment variable the API reads, validated once at startup.
 * Missing or malformed values fail fast with a readable message (secrets are never echoed).
 * See .env.example for documentation of each variable.
 */
export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  APP_ROLE: z.enum(['api', 'worker', 'all']).default('all'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent']).default('info'),

  /** Public API origin for links and provider callbacks. Render injects RENDER_EXTERNAL_URL, so it needs no manual value there. */
  PUBLIC_API_URL: z.string().url().default(process.env.RENDER_EXTERNAL_URL ?? 'http://localhost:4000'),
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:3000'),
  /** Comma-separated exact origins allowed by CORS (scheme + host + port). No wildcards in production. */
  CORS_ORIGINS: csv,
  /** Express "trust proxy" value: hop count behind nginx (1) or "loopback" when running directly. */
  TRUST_PROXY: z.string().default('loopback'),
  /** Comma-separated additional header names allowed in CORS preflight. */
  API_GLOBAL_PREFIX: z.string().default('v1'),

  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),

  /** redis (default) or off — development only: in-memory limits, inline SMS delivery, no queues/pub-sub. */
  REDIS_MODE: z.enum(['redis', 'off']).default('redis'),
  /** Redis used for BullMQ queues and pub/sub. Must run with maxmemory-policy=noeviction. */
  REDIS_URL: z.string().default('redis://localhost:6379/0'),
  /** Optional separate Redis for rate limiting / disposable caches (may use an eviction policy). */
  REDIS_CACHE_URL: z.string().optional(),
  REDIS_KEY_PREFIX: z.string().default('ilmora'),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_DOMAIN: z.string().optional(),
  COOKIE_SECURE: bool(true),
  /** Key used to encrypt one-time codes while they wait in the SMS queue (base64, 32 bytes). */
  OTP_JOB_ENCRYPTION_KEY: z.string().min(32),
  /**
   * Key that encrypts the authenticator-app secrets of the ministry and the Super Admins (base64, 32 bytes:
   * `openssl rand -base64 32`). Without it the ministry cannot sign in and the Super Admins sign in with a password only.
   */
  TOTP_ENCRYPTION_KEY: z.string().min(32).optional(),

  OTP_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  OTP_LENGTH: z.coerce.number().int().min(4).max(8).default(6),
  OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  /** Per phone number: max OTP requests inside OTP_PHONE_WINDOW_SECONDS. */
  OTP_PHONE_LIMIT: z.coerce.number().int().positive().default(3),
  OTP_PHONE_WINDOW_SECONDS: z.coerce.number().int().positive().default(600),
  /** Development only: echo the code in the API response when the SMS provider is "console". Ignored in production. */
  OTP_DEV_ECHO: bool(false),

  SMS_PROVIDER: z.enum(['console', 'eskiz', 'http']).default('console'),
  /** Demo/staging only: lets the console provider run in production when no SMS contract exists yet (messages are logged, not sent). */
  SMS_ALLOW_CONSOLE_IN_PRODUCTION: bool(false),
  SMS_SENDER: z.string().default('ILMORA'),
  ESKIZ_BASE_URL: z.string().url().default('https://notify.eskiz.uz/api'),
  ESKIZ_EMAIL: z.string().optional(),
  ESKIZ_PASSWORD: z.string().optional(),
  SMS_HTTP_URL: z.string().url().optional(),
  SMS_HTTP_TOKEN: z.string().optional(),

  DEFAULT_TENANT_SLUG: z.string().default('ilmora'),
  SCHEDULE_TIMEZONE: z.string().default('Asia/Tashkent'),
  /** How many days ahead the daily job materializes lesson sessions. */
  SESSION_HORIZON_DAYS: z.coerce.number().int().positive().default(28),
  /** Attendance tokens expire this long after the session's scheduled end (minutes). */
  ATTENDANCE_TOKEN_GRACE_MINUTES: z.coerce.number().int().nonnegative().default(30),
  /** How often the worker records absences for lessons whose check-in window closed. */
  ATTENDANCE_ABSENCE_SWEEP_MINUTES: z.coerce.number().int().positive().default(5),
  /** Days a blocked (PAST_DUE) subscription keeps its seats before it expires and releases them. */
  SUBSCRIPTION_GRACE_DAYS: z.coerce.number().int().nonnegative().default(7),
  /** Days before the period end when the "ending soon" reminder goes out. */
  SUBSCRIPTION_REMIND_DAYS: z.coerce.number().int().positive().default(3),

  PAYME_MERCHANT_ID: z.string().optional(),
  PAYME_KEY: z.string().optional(),
  PAYME_TEST_KEY: z.string().optional(),
  PAYME_LOGIN: z.string().default('Paycom'),
  PAYME_CHECKOUT_URL: z.string().url().default('https://checkout.paycom.uz'),
  PAYME_ALLOWED_IPS: csv,
  CLICK_SERVICE_ID: z.string().optional(),
  CLICK_MERCHANT_ID: z.string().optional(),
  CLICK_MERCHANT_USER_ID: z.string().optional(),
  CLICK_SECRET_KEY: z.string().optional(),
  CLICK_API_URL: z.string().url().default('https://api.click.uz/v2/merchant'),
  CLICK_PAY_URL: z.string().url().default('https://my.click.uz/services/pay'),
  CLICK_ALLOWED_IPS: csv,
  PAYMENT_EXPIRES_HOURS: z.coerce.number().int().positive().default(24),

  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
  SENTRY_RELEASE: z.string().optional(),

  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().optional(),
  /** Private bucket for documents (company and student certificates): no public reads, links live 5 minutes. */
  S3_DOCS_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_PUBLIC_BASE_URL: z.string().url().optional(),
  S3_FORCE_PATH_STYLE: bool(true),

  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_DEFAULT_PER_MINUTE: z.coerce.number().int().positive().default(240),
  RATE_LIMIT_AUTH_PER_MINUTE: z.coerce.number().int().positive().default(6),
  /** Password sign-in: after this many failures for one login the login is locked for LOGIN_LOCK_SECONDS. */
  LOGIN_MAX_FAILURES: z.coerce.number().int().positive().default(10),
  LOGIN_LOCK_SECONDS: z.coerce.number().int().positive().default(900),
  /** Google OAuth credentials (optional; enables Google Sign-In) */
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_CALLBACK_URL: z.string().optional(),
})

export type Env = z.infer<typeof EnvSchema>

export const ENV = Symbol('ENV')

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = EnvSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('\n  ')
    throw new Error(`Invalid environment configuration:\n  ${issues}`)
  }
  const env = parsed.data
  if (env.NODE_ENV === 'production') {
    if (env.CORS_ORIGINS.length === 0) throw new Error('CORS_ORIGINS must list the web origin(s) in production')
    if (env.CORS_ORIGINS.some((o) => o.includes('*'))) throw new Error('CORS_ORIGINS may not contain wildcards in production')
    if (!env.COOKIE_SECURE) throw new Error('COOKIE_SECURE must be true in production')
    if (env.SMS_PROVIDER === 'console' && !env.SMS_ALLOW_CONSOLE_IN_PRODUCTION) throw new Error('SMS_PROVIDER=console is not allowed in production unless SMS_ALLOW_CONSOLE_IN_PRODUCTION=true (demo/staging without an SMS contract)')
    if (env.REDIS_MODE !== 'redis') throw new Error('REDIS_MODE=off is a development convenience and is not allowed in production')
    if (!env.TOTP_ENCRYPTION_KEY) console.warn('TOTP_ENCRYPTION_KEY is not set: the ministry cannot sign in, the Super Admins sign in without the authenticator code')
    // Credentials and signatures still gate every callback; the allowlist is the second lock, so its absence is logged, not fatal.
    if (paymeConfigured(env) && env.PAYME_ALLOWED_IPS.length === 0) console.warn('PAYME_ALLOWED_IPS is empty: Payme callbacks are accepted from any address (credentials are still checked)')
    if (clickConfigured(env) && env.CLICK_ALLOWED_IPS.length === 0) console.warn('CLICK_ALLOWED_IPS is empty: Click callbacks are accepted from any address (the signature is still checked)')
  }
  return env
}

export const isProd = (env: Env) => env.NODE_ENV === 'production'
export const paymeConfigured = (env: Env) => !!(env.PAYME_MERCHANT_ID && (env.PAYME_KEY || env.PAYME_TEST_KEY))
export const clickConfigured = (env: Env) => !!(env.CLICK_SERVICE_ID && env.CLICK_MERCHANT_ID && env.CLICK_SECRET_KEY)
export const s3Configured = (env: Env) => !!(env.S3_ENDPOINT && env.S3_BUCKET && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY)
