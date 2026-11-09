import { describe, expect, it } from 'vitest'
import { directionKey, findSameDirection, searchDirections, type Direction } from './directions.js'

const LIST: Direction[] = [
  { id: 'd1', name: 'Dasturlash', industryId: 'it', source: 'USER' },
  { id: 'd2', name: 'Oʻqituvchi', industryId: 'edu', source: 'USER' },
  { id: 'd3', name: 'Elektr montaj', industryId: 'energy', source: 'ADMIN' },
  { id: 'd4', name: 'Программирование', industryId: 'it', source: 'USER' },
]

describe('direction keys (ТЗ 3.2)', () => {
  it('ignore case and extra spaces', () => {
    expect(directionKey('  Elektr   MONTAJ ')).toBe(directionKey('elektr montaj'))
  })

  it('treat Uzbek Cyrillic and Latin alike', () => {
    expect(directionKey('Дастурлаш')).toBe(directionKey('Dasturlash'))
    expect(directionKey('Ўқитувчи')).toBe(directionKey('Oʻqituvchi'))
    expect(directionKey('Энергетика')).toBe(directionKey('Energetika'))
  })

  it('bring every apostrophe and the ILMORA letters to one form', () => {
    const forms = ['Oʻqituvchi', 'O’qituvchi', "O'qituvchi", 'O`qituvchi', 'Oʼqituvchi', 'O‘qituvchi', 'Öqituvçi']
    expect(new Set(forms.map(directionKey)).size).toBe(1)
    expect(directionKey('Qishloq xoʻjaligi')).toBe(directionKey("qishloq xo'jaligi"))
    expect(directionKey('Ğalla')).toBe(directionKey("G'alla"))
  })

  it('keep synonyms in different languages apart (a moderator merges them)', () => {
    expect(directionKey('Программирование')).not.toBe(directionKey('Dasturlash'))
  })
})

describe('direction suggestions', () => {
  it('start after two characters and match in any script', () => {
    expect(searchDirections(LIST, 'd')).toEqual([])
    expect(searchDirections(LIST, 'даст').map((d) => d.id)).toEqual(['d1'])
    expect(searchDirections(LIST, 'oʻqit').map((d) => d.id)).toEqual(['d2'])
    expect(searchDirections(LIST, 'montaj elektr').map((d) => d.id)).toEqual(['d3'])
  })

  it('find the existing direction a new name would duplicate', () => {
    expect(findSameDirection(LIST, 'ДАСТУРЛАШ ')?.id).toBe('d1')
    expect(findSameDirection(LIST, "o'qituvchi")?.id).toBe('d2')
    expect(findSameDirection(LIST, 'Dizayn')).toBeUndefined()
    expect(findSameDirection(LIST, '  ')).toBeUndefined()
  })
})
