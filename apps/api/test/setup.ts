// Shared test environment. Database-backed tests run only when TEST_DATABASE_URL is set
// (locally: a Postgres container, in CI: the postgres service). Everything else is unit-tested.
process.env.NODE_ENV = 'test'
process.env.JWT_ACCESS_SECRET ??= 'test-secret-test-secret-test-secret-test-secret'
process.env.OTP_JOB_ENCRYPTION_KEY ??= 'test-otp-key-test-otp-key-test-otp-key-1234'
process.env.REDIS_URL ??= 'redis://localhost:6379/9'
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgresql://ilmora:ilmora@localhost:5432/ilmora_test?schema=public'
process.env.COOKIE_SECURE = 'false'
process.env.OTP_DEV_ECHO = 'true'
process.env.SMS_PROVIDER = 'console'
process.env.LOG_LEVEL = 'silent'
;(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function toJSON(this: bigint) {
  return this.toString()
}
