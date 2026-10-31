import { describe, expect, it } from 'vitest'
import { formatDate } from './format.js'
import { countLabel, NOUNS } from './i18n.js'
import { dict } from './translations.js'
import * as sample from './sample-data.js'
import { ONLINE_CATEGORIES, ONLINE_COURSES } from './online-courses.js'
import { UNIVERSITIES, UNIVERSITY_PACKAGES } from './university-packages.js'

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

/** Every Uzbek string shown in the interface or seeded as content, with where it comes from. */
function uzbekStrings(): [string, string][] {
  const out: [string, string][] = Object.entries(dict).map(([k, v]) => [`dict:${k}`, v.uz])
  const walk = (path: string, o: unknown) => {
    if (!o || typeof o !== 'object') return
    const r = o as Record<string, unknown>
    if (typeof r.uz === 'string' && typeof r.ru === 'string' && typeof r.en === 'string') return void out.push([path, r.uz])
    for (const [k, v] of Object.entries(r)) walk(`${path}.${k}`, v)
  }
  walk('sample', sample)
  walk('online', { ONLINE_CATEGORIES, ONLINE_COURSES })
  walk('universities', { UNIVERSITIES, UNIVERSITY_PACKAGES })
  return out
}

describe('Uzbek text (modern Latin orthography)', () => {
  const strings = uzbekStrings()

  it('covers the dictionary and the seeded content', () => {
    expect(strings.length).toBeGreaterThan(Object.keys(dict).length + 100)
  })

  it('every dictionary entry exists in Uzbek, Russian and English with the same placeholders', () => {
    // Sentence fragments around a link may be empty where the word order needs nothing there (e.g. Russian).
    const fragment = (k: string) => /\.offer(Before|After)$/.test(k)
    for (const [k, v] of Object.entries(dict)) {
      for (const lang of ['uz', 'ru', 'en'] as const) if (!fragment(k)) expect(v[lang].trim(), `${k} ${lang}`).not.toBe('')
      expect(placeholders(v.uz), `${k} uz`).toEqual(placeholders(v.en))
      expect(placeholders(v.ru), `${k} ru`).toEqual(placeholders(v.en))
    }
  })

  it('has no Cyrillic letters', () => {
    for (const [where, s] of strings) expect(s, where).not.toMatch(/[Ѐ-ӿ]/)
  })

  it('uses only the Uzbek Latin alphabet (no ş, ç, ğ, ñ, ı, ö, ü — Sh, Ch, G‘, Ng are written as such)', () => {
    for (const [where, s] of strings) expect(s, where).not.toMatch(/[şçğñıöüŞÇĞÑİÖÜ]/)
  })

  it('avoids the Russian loanwords replaced in the Uzbek review', () => {
    for (const [where, s] of strings) expect(s, where).not.toMatch(/kartochk|sessiya|skroll|aksent|\blimit|setka|\bbrif\b/i)
  })

  it('writes o‘ and g‘ with the turned comma (‘), not an apostrophe or backtick', () => {
    for (const [where, s] of strings) expect(s, where).not.toMatch(/[oOgG]['’`ʼ´]/)
  })

  it('writes the tutuq belgisi with ’, not with the o‘/g‘ mark or a plain apostrophe', () => {
    for (const [where, s] of strings) {
      const text = s.replace(/https?:\/\/\S+/g, '')
      expect(text, where).not.toMatch(/(?<![oOgG])‘(?=[a-z])/)
      expect(text, where).not.toMatch(/[a-zA-Z]'(?=[a-zA-Z])/)
    }
  })

  it('spells “onlayn” and “oflayn” the Uzbek way', () => {
    for (const [where, s] of strings) expect(s, where).not.toMatch(/\b(online|offline)\b/i)
  })

  it('keeps the noun singular after a number (“0 ta guruh”, never “0 guruhlar”)', () => {
    expect(countLabel('uz', 0, NOUNS.group)).toBe('0 ta guruh')
    expect(countLabel('uz', 3, NOUNS.teacher)).toBe('3 ta o‘qituvchi')
    expect(countLabel('ru', 5, NOUNS.student)).toBe('5 студентов')
    expect(countLabel('en', 1, NOUNS.teacher)).toBe('1 teacher')
  })

  it('writes dates year first', () => {
    expect(formatDate('2026-11-20', 'uz')).toBe('2026-yil 20-noyabr')
  })

  it('spells the product names with o‘', () => {
    expect(dict['finder.title'].uz).toBe('Mening to‘plamim')
    expect(dict['builder.custom'].uz).toBe('O‘z to‘plamingni yarat')
  })
})
