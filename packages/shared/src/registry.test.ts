import { describe, expect, it } from 'vitest'
import { hasMarkup, isStir, matchDistrict, REGISTRY_DISTRICTS, REGISTRY_INDUSTRIES, REGISTRY_REGIONS, registrySearchKey, registrySearchText, STUDENT_ADDABLE_TYPES } from './registry.js'
import { UZ_REGIONS } from './organization.js'

describe('registrySearchText', () => {
  it('joins the normalized names once each and skips empty ones', () => {
    expect(registrySearchText('Andijon texnikumi', 'Андижанский техникум', 'Andijon kolleji')).toBe('andijon texnikumi andijanskiy texnikum andijon kolleji')
    expect(registrySearchText('Dasturlash', 'Дастурлаш', null, undefined, '  ')).toBe('dasturlash')
  })
})

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

  it('maps every region of the web app (UZ_REGIONS) to one SOATO region', () => {
    expect(REGISTRY_REGIONS.map((r) => r.slug).sort()).toEqual(UZ_REGIONS.map((r) => r.id).sort())
  })

  it('has the 206 SOATO districts, each in one of the 14 regions, every region with its own', () => {
    expect(REGISTRY_DISTRICTS).toHaveLength(206)
    expect(new Set(REGISTRY_DISTRICTS.map((d) => d.code)).size).toBe(206)
    const regions = new Set(REGISTRY_REGIONS.map((r) => r.code))
    for (const d of REGISTRY_DISTRICTS) {
      expect(d.code).toMatch(/^17\d{5}$/)
      expect(d.code.startsWith(d.region), d.code).toBe(true)
      expect(regions.has(d.region), d.code).toBe(true)
      expect([d.name.uz, d.name.ru, d.name.en].every((n) => n.trim() === n && n.length > 2 && !/\s{2}/.test(n)), d.code).toBe(true)
      // A district or a city, said the same way in the three languages.
      const city = / (şahri|şahar)$/.test(d.name.uz)
      expect(d.name.uz, d.code).toMatch(city ? / (şahri|şahar)$/ : / tumani$/)
      expect(d.name.ru, d.code).toMatch(city ? /^Город / : / район$/)
      expect(d.name.en, d.code).toMatch(city ? / city$/ : / district$/)
    }
    expect(new Set(REGISTRY_DISTRICTS.map((d) => d.region))).toEqual(regions)
  })

  it('validates a STIR as exactly 9 digits', () => {
    expect(isStir('123456789')).toBe(true)
    expect(isStir('12345678')).toBe(false)
    expect(isStir('1234567890')).toBe(false)
    expect(isStir('12345678a')).toBe(false)
  })
})

describe('matchDistrict', () => {
  const of = (region: string) => REGISTRY_DISTRICTS.filter((d) => d.region === region)
  const code = (region: string, name: string) => matchDistrict(name, of(region))?.code ?? null

  it('finds a district by its name in any alphabet or language, with or without the kind word', () => {
    expect(code('1703', 'Asaka tumani')).toBe('1703224')
    expect(code('1703', 'Асака тумани')).toBe('1703224')
    expect(code('1703', 'Асакинский район')).toBe('1703224')
    expect(code('1703', 'Asaka')).toBe('1703224')
    expect(code('1735', 'Bozatauskiy r-n')).toBe('1735209')
  })

  it('tells a city from the district of the same name', () => {
    expect(code('1703', 'Andijon shahri')).toBe('1703401')
    expect(code('1703', 'Andijonshahri')).toBe('1703401')
    expect(code('1703', 'Andijon tumani')).toBe('1703203')
    expect(code('1703', 'Andijon')).toBeNull()
    expect(code('1710', 'Shaxrisabz shahri')).toBe('1710405')
    expect(code('1710', 'Shaxrisabz tumani')).toBe('1710245')
  })

  it('reads the spellings the lists use: x/h, q/k, initials, a different vowel', () => {
    expect(code('1703', 'Marhamat tumani')).toBe('1703227')
    expect(code('1718', 'Kattaqoʻrgʻon shahri')).toBe('1718406')
    expect(code('1708', 'Sh.Rashidov tumani')).toBe('1708212')
    expect(code('1706', 'Q-bozor tumani')).toBe('1706232')
    expect(code('1726', 'M.Ulugbek tumani')).toBe('1726269')
    expect(code('1718', 'Toyloq tumani')).toBe('1718238')
  })

  it('gives null when not sure: another region, a city that is not a district, a name of nothing', () => {
    expect(code('1706', 'Asaka tumani')).toBeNull()
    expect(code('1712', 'Uchquduq shahri')).toBeNull()
    expect(code('1703', 'Yangi tuman')).toBeNull()
    expect(code('1703', ' ')).toBeNull()
  })
})

describe('registry API rules', () => {
  it('lets a student add only the types they can choose', () => {
    expect([...STUDENT_ADDABLE_TYPES].sort()).toEqual(['LYCEUM', 'SCHOOL', 'TECHNIKUM', 'UNIVERSITY'])
  })
  it('flags markup in free text', () => {
    expect(hasMarkup('<script>')).toBe(true)
    expect(hasMarkup('IT va aloqa')).toBe(false)
  })
})
