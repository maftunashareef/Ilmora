import { describe, expect, it } from 'vitest'
import { formatUzPhone, maskPhone, normalizeUzPhone } from './phone.js'
import { somToTiyin, tiyinToClickAmount, tiyinToSom } from './money.js'

describe('normalizeUzPhone', () => {
  it('accepts the common Uzbek input forms and returns E.164', () => {
    for (const input of ['+998 90 123 45 67', '998901234567', '90 123 45 67', '0901234567', '+998(90)123-45-67', '00998901234567']) {
      expect(normalizeUzPhone(input)).toEqual({ ok: true, e164: '+998901234567', national: '901234567' })
    }
  })
  it('rejects empty, foreign and malformed numbers', () => {
    expect(normalizeUzPhone('')).toEqual({ ok: false, reason: 'empty' })
    expect(normalizeUzPhone('+7 900 000 00 00').ok).toBe(false)
    expect(normalizeUzPhone('99890123456').ok).toBe(false)
    expect(normalizeUzPhone('998101234567').ok).toBe(false)
  })
  it('formats and masks', () => {
    expect(formatUzPhone('+998901234567')).toBe('+998 90 123 45 67')
    expect(maskPhone('+998901234567')).toBe('+998 90 *** ** 67')
    expect(maskPhone('garbage')).toBe('***')
  })
})

describe('money', () => {
  it('converts so‘m to tiyin exactly', () => {
    expect(somToTiyin(1725000)).toBe(172500000n)
    expect(somToTiyin('1725000.50')).toBe(172500050n)
    expect(somToTiyin('0.5')).toBe(50n)
    expect(() => somToTiyin('12.345')).toThrow()
    expect(() => somToTiyin('-1')).toThrow()
  })
  it('renders Click amounts with two decimals and converts back', () => {
    expect(tiyinToClickAmount(172500000n)).toBe('1725000.00')
    expect(tiyinToClickAmount(5n)).toBe('0.05')
    expect(tiyinToSom(172500050n)).toBe(1725000.5)
  })
})
