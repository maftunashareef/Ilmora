import { describe, expect, it } from 'vitest'
import { validateEnv } from '../src/config/env'

/** Production settings that pass every other production check, so each test changes one thing. */
const prod = (over: Record<string, string | undefined> = {}) => ({
  ...process.env,
  NODE_ENV: 'production',
  CORS_ORIGINS: 'https://ilmora.uz',
  COOKIE_SECURE: 'true',
  REDIS_MODE: 'redis',
  SMS_PROVIDER: 'console',
  SMS_ALLOW_CONSOLE_IN_PRODUCTION: 'true',
  TOTP_ENCRYPTION_KEY: 'test-totp-key-test-totp-key-test-totp-key-12',
  ...over,
})

describe('Environment checks (cybersecurity 9.4, 11.11)', () => {
  it('production refuses to start without TOTP_ENCRYPTION_KEY, unless the exception is stated', () => {
    expect(() => validateEnv(prod())).not.toThrow()
    expect(() => validateEnv(prod({ TOTP_ENCRYPTION_KEY: undefined }))).toThrow(/TOTP_ENCRYPTION_KEY must be set in production/)
    expect(() => validateEnv(prod({ TOTP_ENCRYPTION_KEY: undefined, TOTP_ALLOW_MISSING_IN_PRODUCTION: 'true' }))).not.toThrow()
  })

  it('the documents bucket must differ from the public one', () => {
    expect(() => validateEnv(prod({ S3_BUCKET: 'ilmora-media', S3_DOCS_BUCKET: 'ilmora-docs' }))).not.toThrow()
    expect(() => validateEnv(prod({ S3_BUCKET: 'ilmora-media', S3_DOCS_BUCKET: 'ilmora-media' }))).toThrow(/S3_DOCS_BUCKET must differ/)
    expect(() => validateEnv({ ...process.env, S3_BUCKET: 'same', S3_DOCS_BUCKET: 'same' })).toThrow(/S3_DOCS_BUCKET must differ/)
  })

  it('the homework bucket must differ from the public one (ТЗ 18.11, 8.4)', () => {
    expect(() => validateEnv(prod({ S3_BUCKET: 'ilmora-media', S3_HOMEWORK_BUCKET: 'ilmora-homework' }))).not.toThrow()
    expect(() => validateEnv(prod({ S3_BUCKET: 'ilmora-media', S3_HOMEWORK_BUCKET: 'ilmora-media' }))).toThrow(/S3_HOMEWORK_BUCKET must differ/)
    expect(() => validateEnv({ ...process.env, S3_BUCKET: 'same', S3_HOMEWORK_BUCKET: 'same' })).toThrow(/S3_HOMEWORK_BUCKET must differ/)
  })
})
