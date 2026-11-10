import { describe, expect, it } from 'vitest'
import { isUzRegion, normalizeUzInn, UZ_REGIONS } from './organization.js'

describe('organization registration rules', () => {
  it('lists the 14 administrative units of Uzbekistan with unique ids and every language', () => {
    expect(UZ_REGIONS).toHaveLength(14)
    expect(new Set(UZ_REGIONS.map((r) => r.id)).size).toBe(14)
    for (const r of UZ_REGIONS) for (const lang of ['uz', 'ru', 'en'] as const) expect(r.name[lang].trim(), `${r.id} ${lang}`).not.toBe('')
    expect(isUzRegion('samarkand')).toBe(true)
    expect(isUzRegion('moscow')).toBe(false)
  })

  it('accepts a 9-digit TIN and ignores spaces and dashes', () => {
    expect(normalizeUzInn('301234567')).toEqual({ ok: true, inn: '301234567' })
    expect(normalizeUzInn(' 301 234-567 ')).toEqual({ ok: true, inn: '301234567' })
  })

  it('rejects an empty, short, long or non-numeric TIN', () => {
    expect(normalizeUzInn('')).toEqual({ ok: false, reason: 'empty' })
    expect(normalizeUzInn('   ')).toEqual({ ok: false, reason: 'empty' })
    expect(normalizeUzInn('12345678')).toEqual({ ok: false, reason: 'invalid' })
    expect(normalizeUzInn('1234567890')).toEqual({ ok: false, reason: 'invalid' })
    expect(normalizeUzInn('30123456a')).toEqual({ ok: false, reason: 'invalid' })
  })
})
