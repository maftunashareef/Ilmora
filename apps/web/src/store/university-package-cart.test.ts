import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { presetCartPlan, presetCourses, presetPublishability, presetTotal, sampleData, type Preset } from '@ilmora/shared'
import { api } from '../lib/api'
import type { InitialData } from './useStore'
import { createIlmoraStore, GUEST_STUDENT_ID } from './useStore'

vi.mock('../lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/api')>()), api: vi.fn() }))

const group = (id: string, courseId: string, day: number, start = '10:00', end = '11:00') => ({ id, courseId, name: id, days: [day], start, end, room: '1', capacity: 5 })
const course = (id: string, price: number, groups: ReturnType<typeof group>[]) => ({ id, price, status: 'published' as const, visibility: 'public' as const, groups })
// math (Mon), english (Tue), physics (Wed, two groups), clash (Mon, overlaps math), extra (Thu)
const COURSES = [
  course('math', 550_000, [group('math-g', 'math', 0)]),
  course('eng', 650_000, [group('eng-g', 'eng', 1)]),
  course('phys', 500_000, [group('phys-g1', 'phys', 2), group('phys-g2', 'phys', 3)]),
  course('clash', 400_000, [group('clash-g', 'clash', 0, '10:30', '11:30')]),
  course('extra', 300_000, [group('extra-g', 'extra', 4)]),
]
const initialMock: InitialData = {
  lang: 'uz',
  site: Object.assign({}, sampleData.site, { version: 1 }) as never,
  catalog: { centers: sampleData.centers as never, categories: sampleData.categories as never, teachers: sampleData.teachers as never, subjects: sampleData.subjects as never, courses: COURSES as never },
}

const L = (s: string) => ({ uz: s, ru: s, en: s })
const pkg = (ids: (string | null)[]): Preset => ({
  id: 'p', universityId: 'u', program: L('Program'), name: L('Package'), description: L(''), enabled: true,
  admission: { url: 'https://uni.example.uz/admission', academicYear: '2025/2026', checkedOn: '2026-10-30', status: 'verified', note: '' },
  slots: ids.map((courseId, i) => ({ id: `s${i}`, label: L(`Subject ${i}`), courseId })),
})

let memory: Map<string, string>
beforeEach(() => {
  memory = new Map()
  vi.stubGlobal('localStorage', { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, String(v)), removeItem: (k: string) => void memory.delete(k) })
  vi.mocked(api).mockReset()
})
afterEach(() => vi.unstubAllGlobals())

/** The same steps the builder takes when a package is added: plan, then add each single-group course. */
function addPackage(store: ReturnType<typeof createIlmoraStore>, preset: Preset) {
  const student = store.getState().students[0]
  const plan = presetCartPlan(preset, COURSES, student.builder.groupIds)
  const results = plan.toAdd.filter((c) => c.groups.length === 1).map((c) => store.getState().addBuilderGroup(GUEST_STUDENT_ID, c.groups[0].id))
  return { plan, results }
}

describe('adding a university package to the cart', () => {
  it('fills the existing cart with one group per course, at the plain sum of the course prices', () => {
    const store = createIlmoraStore(initialMock)
    const p = pkg(['math', 'eng'])
    expect(presetPublishability(p, COURSES).ok).toBe(true)
    const { results } = addPackage(store, p)
    expect(results).toEqual([{ ok: true }, { ok: true }])
    expect(store.getState().students[0].builder.groupIds).toEqual(['math-g', 'eng-g'])
    expect(presetTotal(presetCourses(p, COURSES))).toBe(1_200_000)
  })

  it('does not duplicate a course the cart already holds, in any group, and still adds the rest', () => {
    const store = createIlmoraStore(initialMock)
    store.getState().addBuilderGroup(GUEST_STUDENT_ID, 'phys-g2')
    const { plan } = addPackage(store, pkg(['math', 'phys']))
    expect(plan.inCart.map((c) => c.id)).toEqual(['phys'])
    expect(store.getState().students[0].builder.groupIds).toEqual(['phys-g2', 'math-g'])
  })

  it('applies the regular schedule rules: a clashing course is refused by the cart, so the builder adds nothing half-way', () => {
    const store = createIlmoraStore(initialMock)
    store.getState().addBuilderGroup(GUEST_STUDENT_ID, 'math-g')
    expect(store.getState().addBuilderGroup(GUEST_STUDENT_ID, 'clash-g')).toMatchObject({ ok: false, reason: 'conflict' })
    expect(store.getState().students[0].builder.groupIds).toEqual(['math-g'])
  })

  it('keeps Duo and Trio limits: a package never takes a Duo cart past two courses', () => {
    const duo = createIlmoraStore(initialMock)
    duo.getState().setBuilderPackage(GUEST_STUDENT_ID, 'pkg-duo')
    const { results } = addPackage(duo, pkg(['math', 'eng', 'extra']))
    expect(results.map((r) => r.ok)).toEqual([true, true, false])
    expect(duo.getState().students[0].builder.groupIds).toHaveLength(2)

    const trio = createIlmoraStore(initialMock)
    trio.getState().setBuilderPackage(GUEST_STUDENT_ID, 'pkg-trio')
    expect(addPackage(trio, pkg(['math', 'eng', 'extra'])).results.every((r) => r.ok)).toBe(true)
    expect(trio.getState().students[0].builder.groupIds).toEqual(['math-g', 'eng-g', 'extra-g'])
  })

  it('a package with a subject that has no course, or an unavailable one, is not publishable', () => {
    expect(presetPublishability(pkg(['math', null]), COURSES).ok).toBe(false)
    expect(presetPublishability(pkg(['math', 'gone']), COURSES).ok).toBe(false)
    expect(presetPublishability({ ...pkg(['math']), admission: { ...pkg([]).admission!, status: 'needs_review' } }, COURSES).ok).toBe(false)
  })
})
