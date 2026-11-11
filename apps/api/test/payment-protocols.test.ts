import { describe, expect, it } from 'vitest'
import { attendanceUrl } from '@ilmora/shared'
import { sha256 } from '../src/common/crypto'
import { testEnv } from './helpers'
import { PaymeService, PAYME, PaymeError } from '../src/modules/payments/payme/payme.service'

describe('Payment protocols & attendance unit tests', () => {
  const env = testEnv({
    PAYME_LOGIN: 'Paycom',
    PAYME_KEY: 'live-key-123456789012345678901234567',
    PAYME_TEST_KEY: 'test-key-12345678901234567890123456',
    NODE_ENV: 'test',
  })

  // Dummy PrismaService & PaymentsService for pure methods
  const dummyPrisma = {} as never
  const dummyPayments = {} as never
  const payme = new PaymeService(dummyPrisma, dummyPayments, env)

  describe('Payme protocol', () => {
    it('authenticates valid Basic authorization with live key', () => {
      const basic = Buffer.from('Paycom:live-key-123456789012345678901234567').toString('base64')
      expect(payme.authenticate(`Basic ${basic}`)).toEqual({ sandbox: false })
    })

    it('authenticates valid Basic authorization with sandbox test key', () => {
      const basic = Buffer.from('Paycom:test-key-12345678901234567890123456').toString('base64')
      expect(payme.authenticate(`Basic ${basic}`)).toEqual({ sandbox: true })
    })

    it('rejects missing or invalid credentials', () => {
      expect(() => payme.authenticate(undefined)).toThrow(PaymeError)
      expect(() => payme.authenticate('')).toThrow(PaymeError)
      const badPass = Buffer.from('Paycom:wrong-key').toString('base64')
      expect(() => payme.authenticate(`Basic ${badPass}`)).toThrow(PaymeError)
      const badLogin = Buffer.from('Other:live-key-123456789012345678901234567').toString('base64')
      expect(() => payme.authenticate(`Basic ${badLogin}`)).toThrow(PaymeError)
    })

    it('produces trilingual error messages for client errors', () => {
      const err = new PaymeError(PAYME.WRONG_AMOUNT, {
        ru: 'Неверная сумма',
        uz: 'Noto‘g‘ri summa',
        en: 'Incorrect amount',
      })
      expect(err.code).toBe(-31001)
      expect(err.messages.uz).toBe('Noto‘g‘ri summa')
      expect(err.messages.en).toBe('Incorrect amount')
    })
  })

  describe('QR attendance security', () => {
    it('creates attendance url with session and token', () => {
      const url = attendanceUrl({ id: 'ses-1', token: 'tok_abc123' }, 'https://ilmora.uz')
      expect(url).toBe('https://ilmora.uz/attend/ses-1?t=tok_abc123')
    })

    it('hashes token using sha256 consistently for database storage', () => {
      const token = 'my-random-attendance-token-24b'
      const hash = sha256(token)
      expect(hash).toHaveLength(64)
      expect(sha256(token)).toBe(hash)
      expect(sha256('different-token')).not.toBe(hash)
    })
  })
})
