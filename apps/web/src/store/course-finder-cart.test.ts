import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { finalPriceSom, FINDER_BUDGETS, FINDER_HOURS, recommendCourses, sampleData, type FinderAnswers, type FinderGoal, type FinderPlan } from '@ilmora/shared'
import { api } from '../lib/api'
import { seatsLeft } from '../lib/enrollment'
import type { Course } from '../types'
import type { InitialData } from './useStore'
import { createIlmoraStore, GUEST_STUDENT_ID } from './useStore'

vi.mock('../lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/api')>()), api: vi.fn() }))

const COURSES = sampleData.courses as Course[]
const initialMock: InitialData = {
  lang: 'uz',
  site: Object.assign({}, sampleData.site, { version: 1 }) as never,
  catalog: { centers: sampleData.centers as never, categories: sampleData.categories as never, teachers: sampleData.teachers as never, subjects: sampleData.subjects as never, courses: COURSES as never },
}

let memory: Map<string, string>
beforeEach(() => {
  memory = new Map()
  vi.stubGlobal('localStorage', { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, String(v)), removeItem: (k: string) => void memory.delete(k) })
  vi.mocked(api).mockReset()
})
afterEach(() => vi.unstubAllGlobals())

/** The page's inputs: the store's catalog, packages and seat counts. */
function suggest(store: ReturnType<typeof createIlmoraStore>, answers: Partial<FinderAnswers>) {
  const s = store.getState()
  return recommendCourses({
    answers: { goal: 'personal', categoryIds: [], level: 'any', format: 'offline', budget: 'any', hours: 'any', ...answers },
    courses: s.courses,
    categories: s.categories,
    packages: s.site.packages,
    presets: s.site.presets,
    seatsLeft: (g) => seatsLeft(g, s.students, GUEST_STUDENT_ID),
  })
}

/** The same steps the page takes for "Add the set to cart": empty the cart, pick the package, add one group per course. */
function applyPlan(store: ReturnType<typeof createIlmoraStore>, plan: FinderPlan<Course>) {
  const st = () => store.getState().students.find((x) => x.id === GUEST_STUDENT_ID)!
  for (const c of store.getState().courses.filter((c) => c.groups.some((g) => st().builder.groupIds.includes(g.id)))) store.getState().removeBuilderCourse(GUEST_STUDENT_ID, c.id)
  store.getState().setBuilderPackage(GUEST_STUDENT_ID, plan.packageId)
  return plan.items.map((it) => store.getState().addBuilderGroup(GUEST_STUDENT_ID, it.group.id))
}

describe('"My set" plans go into the existing cart unchanged', () => {
  it('a suggested set is accepted by the cart rules, uses the matching package, and its total is the cart total', () => {
    const store = createIlmoraStore(initialMock)
    const result = suggest(store, {})
    expect(result.plans.map((p) => p.size)).toEqual([1, 2, 3])
    expect(result.plans.map((p) => p.packageId)).toEqual([null, 'pkg-duo', 'pkg-trio'])
    for (const plan of result.plans) {
      expect(applyPlan(store, plan).every((r) => r.ok)).toBe(true)
      const me = store.getState().students.find((x) => x.id === GUEST_STUDENT_ID)!
      expect(me.builder.packageId).toBe(plan.packageId)
      expect(me.builder.groupIds).toEqual(plan.items.map((it) => it.group.id))
      const cartTotal = me.builder.groupIds.reduce((n, id) => n + finalPriceSom(COURSES.find((c) => c.groups.some((g) => g.id === id))!), 0)
      expect(cartTotal).toBe(plan.total)
    }
  })

  it('replacing a cart never leaves a duplicate course or a course from the old cart', () => {
    const store = createIlmoraStore(initialMock)
    const [one, two] = suggest(store, {}).plans
    applyPlan(store, two)
    applyPlan(store, one)
    expect(store.getState().students.find((x) => x.id === GUEST_STUDENT_ID)!.builder.groupIds).toEqual(one.items.map((it) => it.group.id))
  })

  it('every set for every combination of answers passes the cart rules and stays within the budget and hours', () => {
    const goals: FinderGoal[] = ['university', 'ielts', 'career', 'personal']
    const budgets = [...FINDER_BUDGETS, 'any' as const]
    const hours = [...FINDER_HOURS, 'any' as const]
    let checked = 0
    for (const goal of goals)
      for (const format of ['offline', 'any'] as const)
        for (const budget of budgets)
          for (const h of hours) {
            const store = createIlmoraStore(initialMock)
            for (const plan of suggest(store, { goal, format, budget, hours: h }).plans) {
              expect(applyPlan(store, plan).every((r) => r.ok)).toBe(true)
              if (budget !== 'any') expect(plan.total).toBeLessThanOrEqual(budget)
              if (h !== 'any') expect(plan.hours).toBeLessThanOrEqual(h)
              checked++
            }
          }
    expect(checked).toBeGreaterThan(50)
  })

  it('suggests only courses the catalog lists, and never an online course for the cart', () => {
    const store = createIlmoraStore(initialMock)
    const result = suggest(store, { format: 'any' })
    for (const plan of result.plans) for (const it of plan.items) expect(it.course.learningFormat ?? 'OFFLINE').toBe('OFFLINE')
    for (const m of result.matches) expect(m.course.status === 'published' && m.course.visibility === 'public').toBe(true)
  })
})
