import { describe, expect, it } from 'vitest'
import { admissionIssues, emptyAdmission, groupByUniversity, isUniversityPreset, newPreset, presetCartPlan, presetCourses, presetMissingSubjects, presetPublishability, presetReadiness, presetTotal, universityOf, type PresetCourse } from './presets.js'
import type { AdmissionSource, Preset, University } from './types.js'

const course = (id: string, over: Partial<PresetCourse> = {}, groups = 1): PresetCourse => ({
  id,
  status: 'published',
  visibility: 'public',
  groups: Array.from({ length: groups }, (_, i) => ({ id: `${id}-g${i + 1}` })),
  ...over,
})
const preset = (courseIds: (string | null)[]): Preset => ({
  ...newPreset('p'),
  slots: courseIds.map((courseId, i) => ({ id: `s${i}`, label: { uz: '', ru: '', en: '' }, courseId })),
})

describe('a new package', () => {
  it('starts as an unpublished, unverified draft with one blank subject and no course', () => {
    const p = newPreset('x', 'uni-1')
    expect(p.enabled).toBe(false)
    expect(p.universityId).toBe('uni-1')
    expect(p.admission).toEqual(emptyAdmission())
    expect(p.admission?.status).toBe('needs_review')
    expect(p.slots.map((s) => s.courseId)).toEqual([null])
    expect(p.slots.map((s) => s.id)).toEqual(['x-s1'])
    expect(presetReadiness(p, []).ready).toBe(false)
  })
})

describe('presetReadiness', () => {
  const courses = [course('math'), course('eng'), course('phys')]

  it('is ready when every slot has a different, published, public course with a group', () => {
    expect(presetReadiness(preset(['math', 'eng', 'phys']), courses)).toEqual({ ready: true, issues: [] })
  })

  it('marks the whole preset unavailable when any course is missing, unpublished, private, group-less or repeated', () => {
    expect(presetReadiness(preset(['math', null]), courses).issues).toEqual([{ slotId: 's1', reason: 'unset' }])
    expect(presetReadiness(preset(['math', 'gone']), courses).issues).toEqual([{ slotId: 's1', reason: 'missing' }])
    expect(presetReadiness(preset(['math', 'd']), [...courses, course('d', { status: 'draft' })]).issues).toEqual([{ slotId: 's1', reason: 'unavailable' }])
    expect(presetReadiness(preset(['math', 'p']), [...courses, course('p', { visibility: 'private' })]).issues).toEqual([{ slotId: 's1', reason: 'unavailable' }])
    expect(presetReadiness(preset(['math', 'ng']), [...courses, course('ng', {}, 0)]).issues).toEqual([{ slotId: 's1', reason: 'no-groups' }])
    expect(presetReadiness(preset(['math', 'math']), courses)).toEqual({ ready: false, issues: [{ slotId: 's1', reason: 'duplicate' }] })
    expect(presetReadiness(preset([]), courses).ready).toBe(false)
  })
})

describe('adding a preset to a cart', () => {
  const courses = [
    { ...course('math', {}, 2), price: 100 },
    { ...course('eng'), price: 200 },
    { ...course('phys'), price: 300 },
  ]

  it('lists the preset courses once each, in slot order', () => {
    expect(presetCourses(preset(['eng', 'math', 'eng', null, 'gone']), courses).map((c) => c.id)).toEqual(['eng', 'math'])
  })

  it('skips courses already in the cart, in any group, so nothing is duplicated or replaced', () => {
    const plan = presetCartPlan(preset(['math', 'eng', 'phys']), courses, ['math-g2', 'unrelated'])
    expect(plan.inCart.map((c) => c.id)).toEqual(['math'])
    expect(plan.toAdd.map((c) => c.id)).toEqual(['eng', 'phys'])
    expect(presetCartPlan(preset(['math']), courses, ['math-g1']).toAdd).toEqual([])
  })

  it('prices a preset as the plain sum of the current course prices', () => {
    expect(presetTotal(presetCourses(preset(['math', 'eng', 'phys']), courses))).toBe(600)
    expect(presetTotal([])).toBe(0)
  })

  it('counts the active discount of each course in the total, without any extra preset discount', () => {
    const now = new Date('2026-11-01T10:00:00Z')
    const window = (percent: number, start: string, end: string) => ({ percent, startsAt: start, endsAt: end })
    const priced = [
      { price: 1000, discount: window(10, '2026-10-31T00:00:00Z', '2026-11-02T00:00:00Z') }, // active: 900
      { price: 2000, discount: window(15, '2026-11-02T00:00:00Z', '2026-11-03T00:00:00Z') }, // not started yet: 2000
      { price: 3000 }, // no discount: 3000
    ]
    expect(presetTotal(priced, now)).toBe(900 + 2000 + 3000)
  })
})

const VERIFIED: AdmissionSource = { url: 'https://uni.example.uz/admission', academicYear: '2025/2026', checkedOn: '2026-10-30', status: 'verified', note: 'Subjects listed on the official page.' }
const UNIS: University[] = [{ id: 'u-b', name: 'Beta University' }, { id: 'u-a', name: 'Alpha University', shortName: 'AU' }]
const uniPreset = (over: Partial<Preset> = {}, ids: (string | null)[] = ['math', 'eng']): Preset => ({ ...preset(ids), universityId: 'u-a', admission: VERIFIED, ...over })

describe('admission verification', () => {
  it('needs an official https page, the academic year, the checked date and the status "verified"', () => {
    expect(admissionIssues(VERIFIED)).toEqual([])
    expect(admissionIssues(undefined)).toEqual(['no-source', 'no-year', 'no-date', 'not-verified'])
    expect(admissionIssues(emptyAdmission())).toEqual(['no-source', 'no-year', 'no-date', 'not-verified'])
    expect(admissionIssues({ ...VERIFIED, url: 'http://uni.example.uz/admission' })).toEqual(['no-source'])
    expect(admissionIssues({ ...VERIFIED, url: 'javascript:alert(1)' })).toEqual(['no-source'])
    expect(admissionIssues({ ...VERIFIED, academicYear: '  ' })).toEqual(['no-year'])
    expect(admissionIssues({ ...VERIFIED, checkedOn: '30.10.2026' })).toEqual(['no-date'])
    expect(admissionIssues({ ...VERIFIED, status: 'needs_review' })).toEqual(['not-verified'])
  })
})

describe('who can be published', () => {
  const courses = [course('math'), course('eng'), course('hist', {}, 0)]

  it('a university package needs every subject mapped to an available course AND verified admission requirements', () => {
    expect(presetPublishability(uniPreset(), courses)).toMatchObject({ ok: true, ready: true, issues: [], admission: [] })
    expect(presetPublishability(uniPreset({ admission: { ...VERIFIED, status: 'needs_review' } }), courses)).toMatchObject({ ok: false, ready: true, admission: ['not-verified'] })
    expect(presetPublishability(uniPreset({}, ['math', null]), courses)).toMatchObject({ ok: false, ready: false, admission: [] })
    expect(presetPublishability(uniPreset({}, ['math', 'hist']), courses).ok).toBe(false)
    expect(presetPublishability(uniPreset({ admission: undefined }), courses).ok).toBe(false)
  })

  it('a package that is not about a university only needs its courses', () => {
    const generic = { ...preset(['math', 'eng']), admission: undefined }
    expect(isUniversityPreset(generic)).toBe(false)
    expect(presetPublishability(generic, courses).ok).toBe(true)
    expect(isUniversityPreset({ universityId: 'u-a' })).toBe(true)
    expect(isUniversityPreset({ university: 'Old name' })).toBe(true)
    expect(isUniversityPreset({ university: '   ' })).toBe(false)
  })

  it('reports required subjects that no ILMORA course covers', () => {
    const p = uniPreset({}, ['math', null, 'eng', null])
    expect(presetMissingSubjects(p).map((s) => s.id)).toEqual(['s1', 's3'])
    expect(presetMissingSubjects(uniPreset()).length).toBe(0)
  })
})

describe('browsing by university', () => {
  it('groups packages by university, alphabetically, and skips packages without a university', () => {
    const a1 = uniPreset({ id: 'a1' })
    const a2 = uniPreset({ id: 'a2' })
    const b1 = uniPreset({ id: 'b1', universityId: 'u-b' })
    const none = { ...preset(['math']), id: 'n1' }
    const groups = groupByUniversity([b1, a1, none, a2], UNIS)
    expect(groups.map((g) => g.university.name)).toEqual(['Alpha University', 'Beta University'])
    expect(groups[0].presets.map((p) => p.id)).toEqual(['a1', 'a2'])
    expect(groupByUniversity([], UNIS)).toEqual([])
  })

  it('keeps a package whose university record is gone out of the list, and shows older free-text names as their own university', () => {
    expect(groupByUniversity([uniPreset({ universityId: 'u-gone' })], UNIS)).toEqual([])
    const legacy = { ...preset(['math']), id: 'old', university: 'INHA' }
    expect(universityOf(legacy, UNIS)).toEqual({ id: 'legacy:INHA', name: 'INHA' })
    expect(groupByUniversity([legacy], UNIS).map((g) => g.university.name)).toEqual(['INHA'])
  })
})
