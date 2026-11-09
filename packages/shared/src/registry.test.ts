import { describe, expect, it } from 'vitest'
import { isStir, REGISTRY_INDUSTRIES, REGISTRY_REGIONS, registrySearchKey } from './registry.js'

describe('registrySearchKey', () => {
  const same = (...names: string[]) => {
    const keys = new Set(names.map(registrySearchKey))
    expect(keys.size, names.join(' | ')).toBe(1)
    return [...keys][0]
  }

  it('folds Cyrillic and Latin spellings of one Uzbek name together', () => {
    expect(same('Dasturlash', 'Дастурлаш', 'DASTURLASH')).toBe('dasturlash')
    expect(same('Shahar', 'Şahar', 'Шаҳар')).toBe('shahar')
    expect(same('Gʻisht', 'Ğişt', 'Ғишт', 'G‘isht')).toBe('gisht')
    expect(same('Mebel', 'Мебель')).toBe('mebel')
  })

  it('treats every apostrophe variant and ILMORA’s letters as one', () => {
    expect(same('Oʻqituvchi', 'O’qituvchi', "O'qituvchi", 'O`qituvchi', 'Oʼqituvchi', 'Öqituvçi', 'Ўқитувчи')).toBe('oqituvchi')
  })

  it('ignores case, extra spaces and punctuation', () => {
    expect(same('IT', ' it ', 'It')).toBe('it')
    expect(same('Elektr-montaj', 'Elektr  montaj', 'elektr montaj ')).toBe('elektr montaj')
    expect(same('Bazis-Mebelshchik', 'Bazis — Mebelshchik')).toBe('bazis mebelshchik')
  })

  it('writes Cyrillic «е» as «ye» at the start of a word and after a vowel', () => {
    expect(same('Ер ости', 'Yer osti')).toBe('yer osti')
    expect(registrySearchKey('Темир')).toBe('temir')
    expect(registrySearchKey('Маъно')).toBe('mano')
  })

  it('keeps different words and synonyms in other languages apart', () => {
    expect(registrySearchKey('Программирование')).not.toBe(registrySearchKey('Dasturlash'))
    expect(registrySearchKey('Tikuvchilik')).not.toBe(registrySearchKey('Tikuvchi'))
    expect(registrySearchKey('1C buxgalteriya')).toBe('1c buxgalteriya')
  })
})

describe('registry reference data', () => {
  it('has unique industry slugs and region SOATO codes', () => {
    expect(new Set(REGISTRY_INDUSTRIES.map((i) => i.slug)).size).toBe(REGISTRY_INDUSTRIES.length)
    expect(REGISTRY_REGIONS).toHaveLength(14)
    expect(new Set(REGISTRY_REGIONS.map((r) => r.code)).size).toBe(14)
    for (const r of REGISTRY_REGIONS) expect(r.code).toMatch(/^17\d{2}$/)
  })

  it('validates a STIR as exactly 9 digits', () => {
    expect(isStir('123456789')).toBe(true)
    expect(isStir('12345678')).toBe(false)
    expect(isStir('1234567890')).toBe(false)
    expect(isStir('12345678a')).toBe(false)
  })
})
