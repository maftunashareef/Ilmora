import { createHmac, randomBytes } from 'node:crypto'
import { safeEqual } from './crypto'

/**
 * Time-based one-time passwords (RFC 6238, the codes of Google Authenticator and the like): HMAC-SHA1 over the number
 * of 30-second steps since the epoch, 6 digits. Pure functions — storage, attempts and replay are the caller's.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
export const TOTP_STEP_SECONDS = 30
export const TOTP_DIGITS = 6

/** RFC 4648 base32 without padding — the form authenticator apps take. */
export function base32Encode(buf: Buffer): string {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of buf) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(s: string): Buffer {
  const clean = s.replace(/[\s=-]/g, '').toUpperCase()
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch)
    if (idx < 0) throw new Error('Invalid base32')
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(out)
}

/** A new shared secret: 160 random bits (RFC 4226 recommends at least 128), base32. */
export const newTotpSecret = (): string => base32Encode(randomBytes(20))

/** The code for one time step (RFC 4226 HOTP with the step as the counter). */
export function totpAt(secretBase32: string, step: number, digits = TOTP_DIGITS): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const mac = createHmac('sha1', base32Decode(secretBase32)).update(counter).digest()
  const offset = mac[mac.length - 1] & 0x0f
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3]
  return String(bin % 10 ** digits).padStart(digits, '0')
}

export const stepOf = (at: Date): number => Math.floor(at.getTime() / 1000 / TOTP_STEP_SECONDS)

/**
 * The step a code matches within ±`window` steps of `at` (clocks drift: ±30 s by default), or null. The caller keeps
 * the step it returns and refuses it next time, so one code opens one session.
 */
export function matchTotp(secretBase32: string, code: string, at: Date, window = 1): number | null {
  const digits = code.replace(/\s/g, '')
  if (!/^\d{6}$/.test(digits)) return null
  const now = stepOf(at)
  for (let d = -window; d <= window; d++) if (safeEqual(totpAt(secretBase32, now + d), digits)) return now + d
  return null
}

/** The link authenticator apps read from the QR code. */
export function otpauthUrl(issuer: string, account: string, secretBase32: string): string {
  const label = encodeURIComponent(`${issuer}:${account}`)
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: 'SHA1', digits: String(TOTP_DIGITS), period: String(TOTP_STEP_SECONDS) })
  return `otpauth://totp/${label}?${params.toString()}`
}

/** Ten one-time recovery codes «xxxx-xxxx» (40 random bits each), for a lost phone. */
export function newRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const s = base32Encode(randomBytes(5)).toLowerCase()
    return `${s.slice(0, 4)}-${s.slice(4, 8)}`
  })
}

/** The form a recovery code is stored and compared in: lower case, no dash or spaces. */
export const normalizeRecoveryCode = (code: string): string => code.replace(/[\s-]/g, '').toLowerCase()
