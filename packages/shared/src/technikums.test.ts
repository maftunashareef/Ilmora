import { describe, expect, it } from 'vitest'
import { isUzRegion } from './organization.js'
import { searchTechnikums, TECHNIKUMS, type Technikum } from './technikums.js'

const SAMPLE: Technikum[] = [
  { id: 'a', name: 'Toshkent qurilish texnikumi', region: 'tashkent-city', ownership: 'STATE', district: 'Chilonzor' },
  { id: 'b', name: 'Samarqand tibbiyot texnikumi', region: 'samarkand', ownership: 'STATE' },
  { id: 'c', name: '“Ilm Nur” xususiy texnikumi', region: 'samarkand', ownership: 'PRIVATE' },
]

describe('technikum list', () => {
  it('has unique ids, known regions, an ownership and a name for every entry', () => {
    expect(new Set(TECHNIKUMS.map((t) => t.id)).size).toBe(TECHNIKUMS.length)
    for (const t of TECHNIKUMS) {
      expect(isUzRegion(t.region), t.id).toBe(true)
      expect(['STATE', 'PRIVATE'], t.id).toContain(t.ownership)
      expect(t.name.trim().length, t.id).toBeGreaterThan(2)
      if (t.inn) expect(t.inn, t.id).toMatch(/^\d{9}$/)
    }
  })

  it('narrows by region and ownership', () => {
    expect(searchTechnikums(SAMPLE, '', { region: 'samarkand' }).map((t) => t.id)).toEqual(['b', 'c'])
    expect(searchTechnikums(SAMPLE, '', { region: 'samarkand', ownership: 'PRIVATE' }).map((t) => t.id)).toEqual(['c'])
  })

  it('matches every word in any spelling, including the district', () => {
    expect(searchTechnikums(SAMPLE, 'qurilish').map((t) => t.id)).toEqual(['a'])
    expect(searchTechnikums(SAMPLE, 'quriliş toshkent').map((t) => t.id)).toEqual(['a'])
    expect(searchTechnikums(SAMPLE, 'chilonzor').map((t) => t.id)).toEqual(['a'])
    expect(searchTechnikums(SAMPLE, 'tibbiyot toshkent')).toEqual([])
  })

  it('stops at the limit', () => {
    expect(searchTechnikums(SAMPLE, 'texnikumi', {}, 2)).toHaveLength(2)
  })
})
