import { describe, expect, it } from 'vitest'
import { isSafeExternalUrl } from './catalog.js'
import { ONLINE_CATEGORIES, ONLINE_COURSES } from './online-courses.js'

const LANGS = ['uz', 'ru', 'en'] as const

describe('curated online catalog data', () => {
  it('has unique ids and slugs and only known categories', () => {
    expect(new Set(ONLINE_COURSES.map((c) => c.id)).size).toBe(ONLINE_COURSES.length)
    expect(new Set(ONLINE_COURSES.map((c) => c.slug)).size).toBe(ONLINE_COURSES.length)
    const known = new Set<string>([...ONLINE_CATEGORIES.map((c) => c.slug), 'english', 'math'])
    for (const c of ONLINE_COURSES) expect(known.has(c.category), c.id).toBe(true)
    expect(new Set(ONLINE_CATEGORIES.map((c) => c.id)).size).toBe(ONLINE_CATEGORIES.length)
  })

  it('every course has a plain https link to the provider, a provider name and a verification record', () => {
    for (const c of ONLINE_COURSES) {
      expect(isSafeExternalUrl(c.url), c.id).toBe(true)
      expect(c.provider.trim(), c.id).not.toBe('')
      expect(c.source.verifiedOn, c.id).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(c.source.note.trim(), c.id).not.toBe('')
      expect(c.levelBasis.trim(), c.id).not.toBe('')
    }
  })

  it('texts exist in all three languages and the curriculum is not empty', () => {
    for (const c of ONLINE_COURSES) {
      for (const lang of LANGS) {
        expect(c.summary[lang].trim(), `${c.id} summary ${lang}`).not.toBe('')
        expect(c.description[lang].trim(), `${c.id} description ${lang}`).not.toBe('')
        if (c.durationText) expect(c.durationText[lang].trim(), `${c.id} duration ${lang}`).not.toBe('')
      }
      expect(c.curriculum.length, c.id).toBeGreaterThan(0)
      expect(c.curriculum.every((x) => x.trim() !== ''), c.id).toBe(true)
    }
  })

  it('covers each requested subject that has a verified free course', () => {
    const have = new Set(ONLINE_COURSES.map((c) => c.category))
    for (const slug of ['python', 'frontend', 'backend', 'ai-ml', 'ui-ux', 'graphic-design', 'english', 'math']) expect(have.has(slug as never), slug).toBe(true)
    // No official free IELTS course could be verified, so none is listed rather than guessed.
    expect(ONLINE_COURSES.some((c) => /ielts/i.test(c.title))).toBe(false)
  })

  it('never claims a free certificate unless the provider page does, and keeps unknown lengths empty', () => {
    const free = ONLINE_COURSES.filter((c) => c.certificate === 'FREE').map((c) => c.id).sort()
    // CS50: the course's own /certificate/ page offers a free CS50 Certificate; OpenLearn: a free statement of participation.
    expect(free).toEqual(['c-online-cs50ai', 'c-online-cs50p', 'c-online-cs50w', 'c-online-ou-english-skills', 'c-online-ou-everyday-english-1', 'c-online-ou-interaction-design'])
    for (const c of ONLINE_COURSES.filter((x) => x.certificate === 'FREE')) expect(c.source.note).toMatch(/free CS50 Certificate|free statement of participation/)
    expect(ONLINE_COURSES.find((c) => c.id === 'c-online-mdn-learn')?.durationText).toBeNull()
  })
})
