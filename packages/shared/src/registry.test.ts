import { describe, expect, it } from 'vitest'
import { directionKey, hasMarkup, STUDENT_ADDABLE_TYPES } from './registry.js'

describe('directionKey (one row per spelling, ТЗ 3.2)', () => {
  it('ignores case, extra spaces and punctuation', () => {
    expect(directionKey('IT')).toBe('it')
    expect(directionKey('  it ')).toBe('it')
    expect(directionKey(' Web   dasturlash ')).toBe('web dasturlash')
    expect(directionKey('IT-texnologiyalar')).toBe(directionKey('IT texnologiyalar'))
  })

  it('folds Uzbek Cyrillic to Latin', () => {
    expect(directionKey('Дастурлаш')).toBe(directionKey('Dasturlash'))
    expect(directionKey('Иқтисодиёт')).toBe(directionKey('Iqtisodiyot'))
    expect(directionKey('Ёғочсозлик')).toBe(directionKey("Yog'ochsozlik"))
    expect(directionKey('Ҳисобчи')).toBe(directionKey('Hisobchi'))
    expect(directionKey('Тикувчилик')).toBe(directionKey('Tikuvchilik'))
  })

  it('treats every apostrophe and ILMORA letters as the same word', () => {
    const k = directionKey('Oʻqituvchi')
    for (const v of ['O’qituvchi', "O'qituvchi", 'O`qituvchi', 'Oʼqituvchi', 'O‘qituvchi', 'Öqituvçi', 'Ўқитувчи', 'oqituvchi']) expect(directionKey(v)).toBe(k)
    expect(directionKey('Şahar qurilişi')).toBe(directionKey('Shahar qurilishi'))
    expect(directionKey('Ğalla')).toBe(directionKey('G‘alla'))
  })

  it('keeps different words and languages apart (synonyms are merged by a moderator)', () => {
    expect(directionKey('Программирование')).not.toBe(directionKey('Dasturlash'))
    expect(directionKey('Dasturlash')).not.toBe(directionKey('Dizayn'))
  })

  it('returns an empty key for punctuation only', () => {
    expect(directionKey(' -- ')).toBe('')
  })
})

describe('registry helpers', () => {
  it('lets a student add only the types they can choose', () => {
    expect([...STUDENT_ADDABLE_TYPES].sort()).toEqual(['LYCEUM', 'SCHOOL', 'TECHNIKUM', 'UNIVERSITY'])
  })
  it('flags markup in free text', () => {
    expect(hasMarkup('<script>')).toBe(true)
    expect(hasMarkup('IT va aloqa')).toBe(false)
  })
})
