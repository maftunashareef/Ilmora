import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pickPresetGroups, priceTotals, presetCourses, sampleData, type Preset } from '@ilmora/shared'
import { api } from '../lib/api'
import type { InitialData } from './useStore'
import { createIlmoraStore, GUEST_STUDENT_ID } from './useStore'

vi.mock('../lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/api')>()), api: vi.fn() }))

const group = (id: string, courseId: string, day: number, start = '10:00', end = '11:00', enrolled?: number) => ({ id, courseId, name: id, days: [day], start, end, room: '1', capacity: 5, enrolled })
const course = (id: string, price: number, groups: ReturnType<typeof group>[]) => ({ id, price, status: 'published' as const, visibility: 'public' as const, groups })
// math (Mon 10–11), english (Tue), physics (Mon 10–11 clashes with math | Wed), clash (Mon, overlaps math), extra (Thu), full (no seats)
const COURSES = [
  course('math', 550_000, [group('math-g', 'math', 0)]),
  course('eng', 650_000, [group('eng-g', 'eng', 1)]),
  course('phys', 500_000, [group('phys-mon', 'phys', 0), group('phys-wed', 'phys', 2)]),
  course('clash', 400_000, [group('clash-g', 'clash', 0, '10:30', '11:30')]),
  course('extra', 300_000, [group('extra-g', 'extra', 4)]),
  course('full', 200_000, [group('full-g', 'full', 5, '10:00', '11:00', 5)]),
]
const initialMock: InitialData = {
  lang: 'uz',
  site: Object.assign({}, sampleData.site, { version: 1 }) as never,
  catalog: { centers: sampleData.centers as never, categories: sampleData.categories as never, teachers: sampleData.teachers as never, subjects: sampleData.subjects as never, courses: COURSES as never },
}

const L = (s: string) => ({ uz: s, ru: s, en: s })
const pkg = (id: string, ids: string[]): Preset => ({
  id, universityId: 'u', program: L('Program'), name: L(id), description: L(''), enabled: true,
  admission: { url: 'https://uni.example.uz/admission', academicYear: '2026/2027', checkedOn: '2026-11-01', status: 'verified', note: '' },
  slots: ids.map((courseId, i) => ({ id: `s${i}`, label: L(`Subject ${i}`), courseId })),
})

let memory: Map<string, string>
beforeEach(() => {
  memory = new Map()
  vi.stubGlobal('localStorage', { getItem: (k: string) => memory.get(k) ?? null, setItem: (k: string, v: string) => void memory.set(k, String(v)), removeItem: (k: string) => void memory.delete(k) })
  vi.mocked(api).mockReset()
})
afterEach(() => vi.unstubAllGlobals())

const cart = (store: ReturnType<typeof createIlmoraStore>) => store.getState().students[0].builder

describe('adding a whole university package with one click', () => {
  it('puts every course in the cart at once, choosing a group that does not clash, at the sum of the course prices', () => {
    const store = createIlmoraStore(initialMock)
    const p = pkg('p1', ['math', 'phys', 'eng'])
    expect(store.getState().addPresetToCart(GUEST_STUDENT_ID, p, { directionId: 'd1' })).toEqual({ ok: true, added: 3, switchedFrom: null })
    // physics' Monday group overlaps math, so its Wednesday group is taken
    expect(cart(store).groupIds).toEqual(['math-g', 'phys-wed', 'eng-g'])
    expect(store.getState().cartBundles).toEqual([{ presetId: 'p1', directionId: 'd1', courseIds: ['math', 'phys', 'eng'] }])
    expect(priceTotals(presetCourses(p, COURSES)).final).toBe(1_700_000)
  })

  it('keeps a course the cart already holds (in its own group) and never adds it twice', () => {
    const store = createIlmoraStore(initialMock)
    store.getState().addBuilderGroup(GUEST_STUDENT_ID, 'phys-mon')
    expect(store.getState().addPresetToCart(GUEST_STUDENT_ID, pkg('p1', ['phys', 'eng']))).toMatchObject({ ok: true, added: 1 })
    expect(cart(store).groupIds).toEqual(['phys-mon', 'eng-g'])
  })

  it('adds nothing when a course would clash with the cart or has no free seat, and names that course', () => {
    const store = createIlmoraStore(initialMock)
    store.getState().addBuilderGroup(GUEST_STUDENT_ID, 'math-g')
    expect(store.getState().addPresetToCart(GUEST_STUDENT_ID, pkg('p1', ['eng', 'clash']))).toEqual({ ok: false, reason: 'conflict', courseId: 'clash', conflictWith: 'math' })
    expect(store.getState().addPresetToCart(GUEST_STUDENT_ID, pkg('p2', ['eng', 'full']))).toEqual({ ok: false, reason: 'full', courseId: 'full' })
    expect(cart(store).groupIds).toEqual(['math-g'])
    expect(store.getState().cartBundles).toEqual([])
  })

  it('turns a Flex or Winx cart that no longer has exactly its number of courses into a custom one', () => {
    const flex = createIlmoraStore(initialMock)
    flex.getState().setBuilderPackage(GUEST_STUDENT_ID, 'pkg-duo')
    expect(flex.getState().addPresetToCart(GUEST_STUDENT_ID, pkg('p1', ['math', 'eng', 'extra']))).toMatchObject({ ok: true, switchedFrom: 'pkg-duo' })
    expect(cart(flex)).toMatchObject({ packageId: null, groupIds: ['math-g', 'eng-g', 'extra-g'] })

    const winx = createIlmoraStore(initialMock)
    winx.getState().setBuilderPackage(GUEST_STUDENT_ID, 'pkg-trio')
    expect(winx.getState().addPresetToCart(GUEST_STUDENT_ID, pkg('p1', ['math', 'eng', 'extra']))).toMatchObject({ ok: true, switchedFrom: null })
    expect(cart(winx).packageId).toBe('pkg-trio')

    const short = createIlmoraStore(initialMock)
    short.getState().setBuilderPackage(GUEST_STUDENT_ID, 'pkg-trio')
    expect(short.getState().addPresetToCart(GUEST_STUDENT_ID, pkg('p1', ['math', 'eng']))).toMatchObject({ ok: true, switchedFrom: 'pkg-trio' })
    expect(cart(short).packageId).toBeNull()
  })

  it('removes a package as a whole, keeping courses another package in the cart includes, and remembers packages on this device', () => {
    const store = createIlmoraStore(initialMock)
    store.getState().addPresetToCart(GUEST_STUDENT_ID, pkg('p1', ['math', 'eng']))
    store.getState().addPresetToCart(GUEST_STUDENT_ID, pkg('p2', ['eng', 'extra']))
    expect(JSON.parse(memory.get('ilmora-cart-bundles')!)).toHaveLength(2)

    // a fresh page on the same device reads them back
    const reopened = createIlmoraStore(initialMock)
    reopened.getState().hydrateGuest()
    expect(reopened.getState().cartBundles.map((b) => b.presetId)).toEqual(['p1', 'p2'])
    expect(cart(reopened).groupIds).toEqual(['math-g', 'eng-g', 'extra-g'])

    store.getState().removeCartBundle(GUEST_STUDENT_ID, 'p1')
    expect(cart(store).groupIds).toEqual(['eng-g', 'extra-g'])
    expect(store.getState().cartBundles.map((b) => b.presetId)).toEqual(['p2'])

    // taking out its last courses one by one drops the package too
    store.getState().removeBuilderCourse(GUEST_STUDENT_ID, 'eng')
    store.getState().removeBuilderCourse(GUEST_STUDENT_ID, 'extra')
    expect(store.getState().cartBundles).toEqual([])
    expect(memory.has('ilmora-cart-bundles')).toBe(false)
  })

  it('empties the cart in one step: courses and packages leave it, and a reopened page finds it empty', () => {
    const store = createIlmoraStore(initialMock)
    store.getState().addPresetToCart(GUEST_STUDENT_ID, pkg('p1', ['math', 'eng']))
    store.getState().addBuilderGroup(GUEST_STUDENT_ID, 'extra-g')
    expect(cart(store).groupIds).toEqual(['math-g', 'eng-g', 'extra-g'])
    const plan = cart(store).packageId

    store.getState().clearBuilder(GUEST_STUDENT_ID)
    expect(cart(store).groupIds).toEqual([])
    expect(cart(store).packageId).toBe(plan)
    expect(store.getState().cartBundles).toEqual([])
    expect(memory.has('ilmora-cart-bundles')).toBe(false)

    const reopened = createIlmoraStore(initialMock)
    reopened.getState().hydrateGuest()
    expect(cart(reopened).groupIds).toEqual([])
    expect(reopened.getState().cartBundles).toEqual([])
  })
})

describe('pickPresetGroups', () => {
  const g = (id: string, day: number, start = '10:00', end = '11:00') => ({ id, courseId: id.split('-')[0], name: id, days: [day], start, end, room: '1', capacity: 5 })
  it('tries the next group of an earlier course when a later course cannot fit otherwise', () => {
    const a = { id: 'a', groups: [g('a-mon', 0), g('a-tue', 1)] }
    const b = { id: 'b', groups: [g('b-mon', 0)] }
    const pick = pickPresetGroups([a, b], [], () => false)
    expect(pick.ok && pick.groups.map((x) => x.id)).toEqual(['a-tue', 'b-mon'])
  })
})
