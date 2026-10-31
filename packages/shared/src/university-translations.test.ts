import { describe, expect, it } from 'vitest'
import { dict } from './translations.js'

const LANGS = ['uz', 'ru', 'en'] as const
const keys = Object.keys(dict).filter((k) => k.startsWith('uni.') || k.startsWith('admin.uni.') || k === 'preset.university' || k === 'admin.presets.nameNotice')
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('university package strings', () => {
  it('cover the browsing and admin screens', () => {
    expect(keys.length).toBeGreaterThan(55)
    for (const k of ['uni.title', 'uni.requiredSubjects', 'uni.source', 'uni.sourceMeta', 'uni.disclaimer', 'admin.uni.publish', 'admin.uni.missingCourse', 'admin.uni.issue.not-verified']) expect(keys).toContain(k)
  })

  it('exist in Uzbek, Russian and English, none empty', () => {
    for (const k of keys) {
      const entry = dict[k as keyof typeof dict]
      for (const lang of LANGS) expect(entry[lang].trim(), `${k} ${lang}`).not.toBe('')
    }
  })

  it('use the same placeholders in every language', () => {
    for (const k of keys) {
      const entry = dict[k as keyof typeof dict]
      expect(placeholders(entry.ru), `${k} ru`).toEqual(placeholders(entry.en))
      expect(placeholders(entry.uz), `${k} uz`).toEqual(placeholders(entry.en))
    }
  })

  it('the Russian and Uzbek versions are really translated (they differ from the English text)', () => {
    for (const k of keys) {
      const entry = dict[k as keyof typeof dict]
      if (/^(uni\.sourceMeta)$/.test(k)) continue
      expect(entry.ru, `${k} ru`).not.toBe(entry.en)
      expect(entry.uz, `${k} uz`).not.toBe(entry.en)
    }
  })

  it('never claim an official affiliation', () => {
    const disclaimer = dict['uni.disclaimer']
    expect(disclaimer.en).toMatch(/not officially affiliated/i)
    expect(disclaimer.uz).toMatch(/rasmiy bog‘liq emas/)
    expect(disclaimer.ru).toMatch(/официально не связаны/)
  })
})
