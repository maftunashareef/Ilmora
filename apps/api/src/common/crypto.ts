import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

export const hmacSha256 = (key: string, value: string): string => createHmac('sha256', key).update(value).digest('hex')

/** URL-safe random token (used for refresh tokens and attendance tokens). */
export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url')

export const randomDigits = (length: number): string => {
  let out = ''
  for (let i = 0; i < length; i++) out += String(randomInt(0, 10))
  return out
}

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

function keyFrom(secret: string): Buffer {
  // Accept either a base64 32-byte key or any string (hashed to 32 bytes).
  try {
    const raw = Buffer.from(secret, 'base64')
    if (raw.length === 32) return raw
  } catch {
    /* fall through */
  }
  return createHash('sha256').update(secret).digest()
}

/** AES-256-GCM, output: base64url(iv).base64url(tag).base64url(ciphertext) */
export function encryptString(plain: string, secret: string): string {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), iv)
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${enc.toString('base64url')}`
}

export function decryptString(payload: string, secret: string): string {
  const [iv, tag, data] = payload.split('.')
  if (!iv || !tag || !data) throw new Error('Malformed encrypted payload')
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
}
