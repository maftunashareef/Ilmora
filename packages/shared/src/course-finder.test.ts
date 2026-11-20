import { describe, expect, it } from 'vitest'
import {
  applyExternalRanking,
  DEFAULT_FINDER_ANSWERS,
  finderAnswersFromParams,
  finderAnswersToParams,
  recommendCourses,
  type FinderAnswers,
  type FinderInput,
} from './course-finder.js'
import { overlaps } from './schedule.js'
import type { Course, Group, Preset } from './types.js'

const L = (s: string) => ({ uz: s, ru: s, en: s })
const NOW = new Date('2026-11-01T00:00:00Z')
const group = (id: string, days: number[], start: string, end: string, capacity = 10, enrolled = 0): Group => ({ id, courseId: id.split('-')[0], name: id, days, start, end, room: '1', capacity, enrolled })
const course = (id: string, over: Partial<Course> = {}): Course => ({
  id, slug: id, title: L(id), categoryId: 'cat-english', centerId: 'ce', teacherId: 't', summary: L(''), description: L(''), curriculum: [],
  level: 'beginner', durationMonths: 3, price: 500_000, coverSeed: 1, groups: [], status: 'published', visibility: 'public',
  audience: { studentIds: [], groupIds: [] }, featured: false, updatedAt: '2026-10-01T00:00:00Z', ...over,
})
const online = (id: string, over: Partial<Course> = {}) => course(id, { learningFormat: 'ONLINE', price: 0, externalUrl: `https://learn.example.org/${id}`, providerName: 'Provider', ...over })

const COURSES: Course[] = [
  course('ielts', { title: L('IELTS Intensive'), level: 'advanced', price: 900_000, discount: { percent: 10, startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-12-01T00:00:00Z' }, groups: [group('ielts-a', [1, 3], '18:30', '20:30')] }),
  course('english', { level: 'intermediate', price: 650_000, groups: [group('english-a', [0, 2, 4], '18:00', '19:30'), group('english-b', [1, 3], '10:00', '12:00')] }),
  course('algebra', { categoryId: 'cat-math', level: 'intermediate', price: 550_000, groups: [group('algebra-a', [0, 2], '17:00', '18:30')] }),
  course('clash', { categoryId: 'cat-math', level: 'intermediate', price: 500_000, groups: [group('clash-a', [0, 2], '17:30', '18:30')] }),
  course('dtm', { title: L('University Entrance Prep (DTM)'), categoryId: 'cat-university', level: 'intermediate', price: 750_000, groups: [group('dtm-a', [5, 6], '09:00', '12:00')] }),
  course('python', { categoryId: 'cat-it', price: 850_000, groups: [group('python-a', [0, 2], '19:00', '20:30')] }),
  course('full', { categoryId: 'cat-it', price: 400_000, groups: [group('full-a', [4], '10:00', '11:00', 5, 5)] }),
  course('draft', { categoryId: 'cat-math', status: 'draft', groups: [group('draft-a', [4], '10:00', '11:00')] }),
  online('calc', { categoryId: 'cat-math', level: 'intermediate' }),
  online('everyday', { categoryId: 'cat-english', certificate: 'FREE' }),
  online('unsafe', { categoryId: 'cat-math', externalUrl: 'http://insecure.example.org' }),
]
const CATEGORIES = [{ id: 'cat-english', slug: 'english' }, { id: 'cat-math', slug: 'math' }, { id: 'cat-university' }, { id: 'cat-it', slug: 'it' }]
const PACKAGES = [{ id: 'pkg-duo', maxCourses: 2, enabled: true }, { id: 'pkg-trio', maxCourses: 3, enabled: true }]

const run = (answers: Partial<FinderAnswers>, over: Partial<FinderInput> = {}) =>
  recommendCourses({ answers: { ...DEFAULT_FINDER_ANSWERS, ...answers }, courses: COURSES, categories: CATEGORIES, packages: PACKAGES, now: NOW, ...over })
const ids = (list: { course: Course }[]) => list.map((m) => m.course.id)

describe('which courses can be suggested', () => {
  it('only published public courses that can actually be taken: a free seat offline, a safe https link online', () => {
    const r = run({})
    const all = [...ids(r.matches), ...ids(r.nearby)]
    expect(all).not.toContain('draft')
    expect(all).not.toContain('full')
    expect(all).not.toContain('unsafe')
    expect(all).toEqual(expect.arrayContaining(['ielts', 'english', 'algebra', 'clash', 'dtm', 'python', 'calc', 'everyday']))
  })

  it('respects the chosen format, and "free only" means online courses', () => {
    expect(ids(run({ format: 'online' }).matches).sort()).toEqual(['calc', 'everyday'])
    expect(ids(run({ format: 'offline' }).matches)).not.toContain('calc')
    const free = run({ budget: 0 })
    expect([...ids(free.matches), ...ids(free.nearby)].sort()).toEqual(['calc', 'everyday'])
    expect(free.matches.every((m) => m.reasons.some((x) => x.code === 'free'))).toBe(true)
    expect(free.plans).toEqual([])
  })

  it('a goal or subject leaves out courses that serve neither', () => {
    const r = run({ goal: 'ielts' })
    expect(ids(r.matches)).not.toContain('algebra')
    expect(ids(r.matches)).not.toContain('python')
  })

  it('uses the seat counts it is given', () => {
    expect(ids(run({}, { seatsLeft: (g) => (g.id === 'algebra-a' ? 0 : 5) }).matches)).not.toContain('algebra')
  })
})

describe('reasons come from the course data', () => {
  it('a course is said to prepare for an exam only when its own title or slug names the exam', () => {
    const r = run({ goal: 'ielts' })
    const ielts = r.matches.find((m) => m.course.id === 'ielts')!
    expect(r.matches[0].course.id).toBe('ielts')
    expect(ielts.reasons).toContainEqual({ code: 'exam', exam: 'ielts' })
    const english = r.matches.find((m) => m.course.id === 'english')!
    expect(english.reasons).toContainEqual({ code: 'goal', goal: 'ielts' })
    expect(english.reasons.some((x) => x.code === 'exam')).toBe(false)
  })

  it('prices include the active discount, and the discount is a reason with its percent and end', () => {
    // the center entered 10% on 900 000: the student sees 5% and pays 855 000
    const ielts = run({ budget: 855_000 }).matches.find((m) => m.course.id === 'ielts')!
    expect(ielts.price).toBe(855_000)
    expect(ielts.reasons).toContainEqual({ code: 'budget', price: 855_000 })
    expect(ielts.reasons).toContainEqual({ code: 'discount', percent: 5, endsAt: '2026-12-01T00:00:00Z' })
    const later = run({ budget: 855_000 }, { now: new Date('2026-12-02T00:00:00Z') })
    expect(later.nearby.find((m) => m.course.id === 'ielts')?.warnings).toEqual([{ code: 'overBudget', price: 900_000 }])
  })

  it('suggests the group with the fewest weekly hours and reports its free seats', () => {
    const english = run({}).matches.find((m) => m.course.id === 'english')!
    expect(english.group?.id).toBe('english-b')
    expect(english.hours).toBe(4)
    expect(english.reasons).toContainEqual({ code: 'seats', left: 10 })
  })

  it('online courses are free and self-paced, and their certificate is reported as the provider states it', () => {
    const everyday = run({ format: 'online' }).matches.find((m) => m.course.id === 'everyday')!
    expect(everyday.price).toBe(0)
    expect(everyday.group).toBeNull()
    expect(everyday.reasons).toEqual(expect.arrayContaining([{ code: 'free' }, { code: 'selfPaced' }, { code: 'certificate', kind: 'FREE' }]))
    const calc = run({ format: 'online' }).matches.find((m) => m.course.id === 'calc')!
    expect(calc.reasons.some((x) => x.code === 'certificate')).toBe(false)
  })
})

describe('close matches miss exactly one of the limits and say which', () => {
  it('over budget, over the weekly hours, or two levels away', () => {
    const r = run({ budget: 750_000, hours: 3, level: 'beginner' })
    const warn = (id: string) => r.nearby.find((m) => m.course.id === id)?.warnings
    expect(warn('python')).toEqual([{ code: 'overBudget', price: 850_000 }])
    expect(warn('english')).toEqual([{ code: 'overHours', hours: 4 }])
    expect(warn('ielts')).toEqual(expect.arrayContaining([{ code: 'levelGap', level: 'advanced' }, { code: 'overBudget', price: 855_000 }, { code: 'overHours', hours: 4 }]))
    const algebra = r.matches.find((m) => m.course.id === 'algebra')!
    expect(algebra.reasons).toEqual(expect.arrayContaining([{ code: 'level', level: 'intermediate', exact: false }, { code: 'budget', price: 550_000 }, { code: 'hours', hours: 3 }]))
  })
})

describe('plans: ready sets for the existing cart', () => {
  it('one group per course, no clashes, every group with a seat, totals from the course prices only', () => {
    const r = run({ format: 'offline' })
    expect(r.plans.map((p) => p.size)).toEqual([1, 2, 3])
    for (const plan of r.plans) {
      expect(new Set(plan.items.map((i) => i.course.id)).size).toBe(plan.size)
      for (let a = 0; a < plan.items.length; a++) for (let b = a + 1; b < plan.items.length; b++) expect(overlaps(plan.items[a].group, plan.items[b].group)).toBe(false)
      const match = (id: string) => r.matches.find((m) => m.course.id === id)!
      expect(plan.total).toBe(plan.items.reduce((n, i) => n + match(i.course.id).price, 0))
      expect(plan.listTotal).toBe(plan.items.reduce((n, i) => n + i.course.price, 0))
    }
  })

  it('never puts two clashing groups together', () => {
    const r = run({ categoryIds: ['cat-math'], format: 'offline' })
    for (const plan of r.plans) expect(plan.items.map((i) => i.course.id).filter((id) => id === 'algebra' || id === 'clash').length).toBeLessThan(2)
  })

  it('uses the enabled package for exactly that many courses, and a custom selection otherwise', () => {
    const r = run({ format: 'offline' })
    expect(r.plans.map((p) => p.packageId)).toEqual([null, 'pkg-duo', 'pkg-trio'])
    const off = run({ format: 'offline' }, { packages: [{ id: 'pkg-duo', maxCourses: 2, enabled: false }] })
    expect(off.plans.map((p) => p.packageId)).toEqual([null, null, null])
  })

  it('stays within the budget and the weekly hours', () => {
    const r = run({ format: 'offline', budget: 1_500_000, hours: 6 })
    expect(r.plans.length).toBeGreaterThan(0)
    for (const plan of r.plans) {
      expect(plan.total).toBeLessThanOrEqual(1_500_000)
      expect(plan.hours).toBeLessThanOrEqual(6)
    }
  })

  it('shows first the largest set made only of strong matches', () => {
    // IELTS names the exam and has the chosen level: strong. General English only relates to the goal: good.
    const one = run({ goal: 'ielts', level: 'advanced', format: 'offline' })
    expect(one.matches.map((m) => [m.course.id, m.fit])).toEqual([['ielts', 'strong'], ['english', 'good']])
    expect(one.plans.map((p) => p.size)).toEqual([1, 2])
    expect(one.recommendedSize).toBe(1)
    // With English as the chosen subject as well, both are strong, so the two-course set comes first.
    expect(run({ goal: 'ielts', categoryIds: ['cat-english'], level: 'advanced', format: 'offline' }).recommendedSize).toBe(2)
  })
})

describe('university packages', () => {
  const pkg = (id: string, courseIds: string[], over: Partial<Preset> = {}): Preset => ({
    id, universityId: 'u', program: L('p'), name: L(id), description: L(''), enabled: true,
    admission: { url: 'https://uni.example.uz/admission', academicYear: '2026/2027', checkedOn: '2026-10-30', status: 'verified', note: '' },
    slots: courseIds.map((courseId, i) => ({ id: `${id}-${i}`, label: L(courseId), courseId })),
    ...over,
  })
  const presets = [pkg('math-eng', ['algebra', 'english']), pkg('draft', ['algebra'], { enabled: false }), pkg('unverified', ['algebra'], { admission: { url: '', academicYear: '', checkedOn: '', status: 'needs_review', note: '' } }), pkg('missing', ['algebra', 'gone'])]

  it('are offered for the university goal only, and only when published, ready and verified', () => {
    expect(run({ goal: 'career' }, { presets }).presets).toEqual([])
    const r = run({ goal: 'university', categoryIds: ['cat-math'] }, { presets })
    expect(r.presets.map((p) => p.preset.id)).toEqual(['math-eng'])
    expect(r.presets[0]).toMatchObject({ total: 1_200_000, subjectMatches: 1, withinBudget: true })
    expect(run({ goal: 'university', budget: 750_000 }, { presets }).presets[0].withinBudget).toBe(false)
  })
})

describe('an external ranking can only reorder what the rules accept', () => {
  it('reorders, ignores unknown or rejected ids, and keeps plans and prices', () => {
    const base = run({ format: 'offline' })
    const ranked = applyExternalRanking(base, { source: 'test-model', courseIds: ['python', 'invented-course', 'draft', 'algebra'] })
    expect(ranked.source).toBe('test-model')
    expect(ids(ranked.matches).slice(0, 2)).toEqual(['python', 'algebra'])
    expect(ids(ranked.matches).sort()).toEqual(ids(base.matches).sort())
    expect(ranked.plans).toBe(base.plans)
    expect(ranked.matches.find((m) => m.course.id === 'python')?.price).toBe(850_000)
  })
})

describe('answers in the URL', () => {
  const categoryIds = CATEGORIES.map((c) => c.id)
  // The same shape as URLSearchParams (this package has no DOM types).
  const query = (r: Record<string, string>) => ({ get: (k: string) => (k in r ? r[k] : null) })

  it('round-trip, and a complete set opens straight on the results', () => {
    const answers: FinderAnswers = { goal: 'university', categoryIds: ['cat-math', 'cat-english'], level: 'intermediate', format: 'offline', budget: 1_500_000, hours: 6 }
    expect(finderAnswersFromParams(query(finderAnswersToParams(answers)), categoryIds)).toEqual({ answers, complete: true })
    const any: FinderAnswers = { ...DEFAULT_FINDER_ANSWERS }
    expect(finderAnswersFromParams(query(finderAnswersToParams(any)), categoryIds)).toEqual({ answers: any, complete: true })
  })

  it('unknown values fall back to the defaults and are not complete; unknown subjects are dropped', () => {
    const r = finderAnswersFromParams(query({ goal: 'rich', subjects: 'cat-math,cat-gone', level: 'expert', format: 'vr', budget: '123', hours: '', x: '1' }), categoryIds)
    expect(r.complete).toBe(false)
    expect(r.answers).toEqual({ ...DEFAULT_FINDER_ANSWERS, categoryIds: ['cat-math'] })
    expect(finderAnswersFromParams(query({}), categoryIds)).toEqual({ answers: DEFAULT_FINDER_ANSWERS, complete: false })
  })
})
