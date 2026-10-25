import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { tiyinToClickAmount, somToTiyin, attendanceUrl } from '@ilmora/shared'
import { sha256 } from '../src/common/crypto'
import { testEnv } from './helpers'
import { ClickService, CLICK } from '../src/modules/payments/click/click.service'
import { PaymeService, PAYME, PaymeError } from '../src/modules/payments/payme/payme.service'

describe('Payment protocols & attendance unit tests', () => {
  const env = testEnv({
    PAYME_LOGIN: 'Paycom',
    PAYME_KEY: 'live-key-123456789012345678901234567',
    PAYME_TEST_KEY: 'test-key-12345678901234567890123456',
    CLICK_SERVICE_ID: '77',
    CLICK_MERCHANT_ID: '1',
    CLICK_SECRET_KEY: 'click-secret',
    NODE_ENV: 'test',
  })

  // Dummy PrismaService & PaymentsService for pure methods
  const dummyPrisma = {} as never
  const dummyPayments = {} as never
  const payme = new PaymeService(dummyPrisma, dummyPayments, env)
  const click = new ClickService(dummyPrisma, dummyPayments, env)

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

  describe('Click protocol', () => {
    const md5 = (s: string) => createHash('md5').update(s).digest('hex')
    const signTime = '2026-10-22 18:00:00'

    it('verifies prepare signature (action = 0)', () => {
      const clickTransId = '12345678'
      const merchantTransId = 'pay-001'
      const amount = '50000.00'
      const expectedSign = md5(`${clickTransId}77click-secret${merchantTransId}${amount}0${signTime}`)

      const validForm = {
        click_trans_id: clickTransId,
        service_id: '77',
        merchant_trans_id: merchantTransId,
        amount,
        action: '0',
        sign_time: signTime,
        sign_string: expectedSign,
      }
      expect(click.verifySign(validForm, 0)).toBe(true)

      const invalidForm = { ...validForm, sign_string: 'deadbeef' }
      expect(click.verifySign(invalidForm, 0)).toBe(false)
    })

    it('verifies complete signature (action = 1) including merchant_prepare_id', () => {
      const clickTransId = '12345678'
      const merchantTransId = 'pay-001'
      const prepareId = '999'
      const amount = '50000.00'
      const expectedSign = md5(`${clickTransId}77click-secret${merchantTransId}${prepareId}${amount}1${signTime}`)

      const validForm = {
        click_trans_id: clickTransId,
        service_id: '77',
        merchant_trans_id: merchantTransId,
        merchant_prepare_id: prepareId,
        amount,
        action: '1',
        sign_time: signTime,
        sign_string: expectedSign,
      }
      expect(click.verifySign(validForm, 1)).toBe(true)

      const invalidForm = { ...validForm, merchant_prepare_id: 'wrong-id' }
      expect(click.verifySign(invalidForm, 1)).toBe(false)
    })

    it('converts money between tiyin and click format accurately', () => {
      expect(tiyinToClickAmount(50_000_00n)).toBe('50000.00')
      expect(tiyinToClickAmount(12_345_67n)).toBe('12345.67')
      expect(somToTiyin('50000.00')).toBe(50_000_00n)
      expect(somToTiyin('12345.67')).toBe(12_345_67n)
    })

    it('replies with standard error structures', () => {
      const form = { click_trans_id: '123', merchant_trans_id: 'pay-01' }
      const res = click.reply(form, CLICK.ALREADY_PAID, { merchant_confirm_id: 42 })
      expect(res).toEqual({
        click_trans_id: 123,
        merchant_trans_id: 'pay-01',
        merchant_confirm_id: 42,
        error: -4,
        error_note: 'Already paid',
      })
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
