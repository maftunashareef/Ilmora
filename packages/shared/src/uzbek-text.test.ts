import { describe, expect, it } from 'vitest'
import { formatDate } from './format.js'
import { countLabel, NOUNS } from './i18n.js'
import { dict } from './translations.js'
import * as sample from './sample-data.js'
import { ONLINE_CATEGORIES, ONLINE_COURSES } from './online-courses.js'
import { UNIVERSITIES, UNIVERSITY_PACKAGES } from './university-packages.js'
import { REGISTRY_DISTRICTS, REGISTRY_INDUSTRIES, REGISTRY_REGIONS } from './registry.js'

/**
 * ILMORA writes Uzbek with its own alphabet: Ğ ğ (for G‘ g‘), Ö ö (O‘ o‘), Ş ş (Sh sh) and Ç ç (Ch ch). English words,
 * names and links inside Uzbek text keep their own spelling. The course finder and the custom package are called
 * “Mening töplamim”; until 2026-11-13 the owner kept that one name as “Mening to’plamim”. See docs/uz-glossary.md.
 */
const MY_SET = 'Mening töplamim'
const ENGLISH_WORDS = new Set(['Charles', 'English', 'Etch-a-Sketch', 'Michigan'])

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

/** Every Uzbek string shown in the interface or seeded as content: where it comes from, the text and its English twin. */
function uzbekStrings(): [string, string, string][] {
  const out: [string, string, string][] = Object.entries(dict).map(([k, v]) => [`dict:${k}`, v.uz, v.en])
  const walk = (path: string, o: unknown) => {
    if (!o || typeof o !== 'object') return
    const r = o as Record<string, unknown>
    if (typeof r.uz === 'string' && typeof r.ru === 'string' && typeof r.en === 'string') return void out.push([path, r.uz, r.en])
    for (const [k, v] of Object.entries(r)) walk(`${path}.${k}`, v)
  }
  walk('sample', sample)
  walk('online', { ONLINE_CATEGORIES, ONLINE_COURSES })
  walk('universities', { UNIVERSITIES, UNIVERSITY_PACKAGES })
  walk('registry', { REGISTRY_INDUSTRIES, REGISTRY_REGIONS, REGISTRY_DISTRICTS })
  return out
}

/** The Uzbek words of a string: links, {placeholders} and English words (also present in the English twin) removed. */
function uzbekWords(uz: string, en: string): string[] {
  const words = uz.replace(/https?:\/\/\S+/g, ' ').replace(/\{\w+\}/g, ' ').match(/[A-Za-zĞğÖöŞşÇç’'-]+/g) ?? []
  return words.filter((w) => !ENGLISH_WORDS.has(w) && !new RegExp(`(^|[^A-Za-z])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Za-z]|$)`).test(en))
}

describe('Uzbek text (ILMORA alphabet: Ğ, Ö, Ş, Ç)', () => {
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

  it('uses Ö and Ğ, never the old o‘ / g‘ marks (‘ ʻ or an apostrophe after o or g)', () => {
    for (const [where, s] of strings) {
      expect(s, where).not.toMatch(/[‘ʻ]/)
      expect(s.replace(/https?:\/\/\S+/g, ''), where).not.toMatch(/[oOgG]['`´]/)
    }
  })

  it('uses Ş and Ç in Uzbek words, never the digraphs sh / ch (English words and names keep theirs)', () => {
    for (const [where, s, en] of strings) {
      const old = uzbekWords(s, en).filter((w) => /sh|ch/i.test(w))
      expect(old, where).toEqual([])
    }
  })

  it('uses only ILMORA’s accented letters, precomposed (Unicode NFC) and with no stray combining marks', () => {
    for (const [where, s] of strings) {
      expect(s, where).toBe(s.normalize('NFC'))
      expect(s, where).not.toMatch(/[̀-ͯ]/)
      expect(s, where).not.toMatch(/[ñıüÜÑİșȘőŐ]/)
    }
    expect(strings.some(([, s]) => /[ĞğÖöŞşÇç]/.test(s))).toBe(true)
  })

  it('writes the tutuq belgisi with ’, never a plain apostrophe inside a word', () => {
    for (const [where, s] of strings) expect(s.replace(/https?:\/\/\S+/g, ''), where).not.toMatch(/[A-Za-z]'(?=[A-Za-z])/)
  })

  it('avoids the Russian loanwords replaced in the Uzbek review', () => {
    for (const [where, s] of strings) expect(s, where).not.toMatch(/kartoçk|kartochk|sessiya|skroll|aksent|\blimit|setka|\bbrif\b/i)
  })

  it('keeps the noun singular after a number (“0 ta guruh”, never “0 guruhlar”)', () => {
    expect(countLabel('uz', 0, NOUNS.group)).toBe('0 ta guruh')
    expect(countLabel('uz', 3, NOUNS.teacher)).toBe('3 ta öqituvçi')
    expect(countLabel('ru', 5, NOUNS.student)).toBe('5 студентов')
    expect(countLabel('en', 1, NOUNS.teacher)).toBe('1 teacher')
  })

  it('writes dates year first', () => {
    expect(formatDate('2026-11-20', 'uz')).toBe('2026-yil 20-noyabr')
  })

  it('calls the course finder and the custom package “Mening töplamim” and spells key words in the ILMORA alphabet', () => {
    expect(dict['finder.title'].uz).toBe(MY_SET)
    expect(dict['builder.custom'].uz).toBe(MY_SET)
    for (const [where, s] of strings) expect(s, where).not.toMatch(/to’plam|tőplam|t[öő]plamingni yarat/)
    expect(dict['footer.city']).toEqual({ uz: 'Toşkent şahri', ru: 'г. Ташкент', en: 'Tashkent, Uzbekistan' })
    expect(dict['builder.custom']).toEqual({ uz: MY_SET, ru: 'Собрать свой набор', en: 'Build your own package' })
    expect(dict['common.som'].uz).toBe('söm')
  })

  it('leaves Russian and English untouched', () => {
    for (const v of Object.values(dict)) expect(`${v.ru} ${v.en}`).not.toMatch(/[ĞğÖöŞş]/)
  })
})
