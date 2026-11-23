import { describe, expect, it } from 'vitest'
import { logPath } from '../src/common/log-path'

/**
 * What the request log and the 5xx log keep of an address (security review 19.11, №8 and №11): the path only, the
 * center's standing QR code masked. Caddy masks the same in its own log (infra/uzcloud/web/caddy/Caddyfile).
 */
describe('logPath', () => {
  it('masks the center QR code in the API path and on the QR page', () => {
    expect(logPath('/v1/attendance/centers/SECRETCODE123/check-in')).toBe('/v1/attendance/centers/:code/check-in')
    expect(logPath('/attendance/centers/SECRETCODE123')).toBe('/attendance/centers/:code')
    expect(logPath('/uz/attend/c/SECRETCODE123')).toBe('/uz/attend/c/:code')
  })

  it('drops the query string and the fragment', () => {
    expect(logPath('/v1/attendance/sessions/s1/check-in?t=TOKEN')).toBe('/v1/attendance/sessions/s1/check-in')
    expect(logPath('/uz/login?next=/uz/attend/c/SECRET#x')).toBe('/uz/login')
  })

  it('leaves other paths alone', () => {
    expect(logPath('/v1/public/catalog')).toBe('/v1/public/catalog')
    expect(logPath('/v1/attendance/centers')).toBe('/v1/attendance/centers')
    expect(logPath(undefined)).toBe('')
  })
})
