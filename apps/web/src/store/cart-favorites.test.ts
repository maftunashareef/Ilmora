import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_CART_COURSES, sampleData } from '@ilmora/shared'
import { api } from '../lib/api'
import type { InitialData } from './useStore'
import { createIlmoraStore, GUEST_STUDENT_ID } from './useStore'

vi.mock('../lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/api')>()), api: vi.fn() }))
const apiMock = vi.mocked(api)

const DRAFT_KEY = 'ilmora-builder-draft'
const GUEST_SAVED_KEY = 'ilmora-guest-saved-courses'

const group = (id: string, courseId: string, day: number, start = '10:00', end = '11:00') => ({ id, courseId, name: id, days: [day], start, end, room: '1', capacity: 5 })
const course = (id: string, groups: ReturnType<typeof group>[]) => ({ id, groups })
// Seven courses on different weekdays; g3 overlaps g1, g2b is a second group of c2.
const COURSES = [
  course('c1', [group('g1', 'c1', 0)]),
  course('c2', [group('g2', 'c2', 1), group('g2b', 'c2', 2)]),
  course('c3', [group('g3', 'c3', 0, '10:30', '11:30')]),
  course('c4', [group('g4', 'c4', 3)]),
  course('c5', [group('g5', 'c5', 4)]),
  course('c6', [group('g6', 'c6', 5)]),
  course('c7', [group('g7', 'c7', 6)]),
]

const initialMock: InitialData = {
  lang: 'uz',
  site: Object.assign({}, sampleData.site, { version: 1 }) as never,
  catalog: {
    centers: sampleData.centers as never,
    categories: sampleData.categories as never,
    teachers: sampleData.teachers as never,
    subjects: sampleData.subjects as never,
    courses: COURSES as never,
  },
}

let memory: Map<string, string>

beforeEach(() => {
  memory = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => memory.get(k) ?? null,
    setItem: (k: string, v: string) => void memory.set(k, String(v)),
    removeItem: (k: string) => void memory.delete(k),
  })
  apiMock.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

/** Puts the store into the signed-in student state without going through the login screen. */
function signIn(store: ReturnType<typeof createIlmoraStore>) {
  store.setState({
    auth: { status: 'authenticated', user: { id: 'u1' } as never },
    role: 'student',
    currentStudentId: 'u1',
    students: [
      {
        id: 'u1',
        profile: { displayName: 'U', district: '', preferredLang: 'uz', reminders: false },
        subscription: { packageId: null, groupIds: [], status: 'none' },
        savedCourseIds: [],
        savedTeacherIds: [],
        builder: { packageId: null, groupIds: [], meyosGrant: false },
      },
    ],
  })
}

describe('flexible cart (custom selection)', () => {
  it('lets a visitor add a course without choosing a package', () => {
    const store = createIlmoraStore(initialMock)
    expect(store.getState().addBuilderGroup(GUEST_STUDENT_ID, 'g1')).toEqual({ ok: true })
    const me = store.getState().students[0]
    expect(me.builder.packageId).toBeNull()
    expect(me.builder.groupIds).toEqual(['g1'])
  })

  it('never holds the same course twice: another group of the course replaces the first', () => {
    const store = createIlmoraStore(initialMock)
    store.getState().addBuilderGroup(GUEST_STUDENT_ID, 'g2')
    store.getState().addBuilderGroup(GUEST_STUDENT_ID, 'g2b')
    expect(store.getState().students[0].builder.groupIds).toEqual(['g2b'])
  })

  it('rejects overlapping groups and persists the visitor cart locally', () => {
    const store = createIlmoraStore(initialMock)
    store.getState().addBuilderGroup(GUEST_STUDENT_ID, 'g1')
    expect(store.getState().addBuilderGroup(GUEST_STUDENT_ID, 'g3')).toMatchObject({ ok: false, reason: 'conflict' })
    expect(JSON.parse(memory.get(DRAFT_KEY) ?? '{}').groupIds).toEqual(['g1'])
  })

  it('lets a custom selection hold any number of non-overlapping courses, while a package keeps its own size', () => {
    // Ten courses at different times, more than the former limit of six: all accepted without a package.
    const many = Array.from({ length: 10 }, (_, i) => {
      const hour = String(8 + Math.floor(i / 7) * 3).padStart(2, '0')
      return course(`m${i}`, [group(`mg${i}`, `m${i}`, i % 7, `${hour}:00`, `${hour}:50`)])
    })
    const store = createIlmoraStore({ ...initialMock, catalog: { ...initialMock.catalog, courses: many as never } })
    for (let i = 0; i < many.length; i++) expect(store.getState().addBuilderGroup(GUEST_STUDENT_ID, `mg${i}`)).toEqual({ ok: true })
    expect(store.getState().students[0].builder.groupIds).toHaveLength(many.length)
    expect(MAX_CART_COURSES).toBeGreaterThan(many.length) // a technical bound only, never reached by the catalog

    const duo = createIlmoraStore(initialMock)
    duo.getState().setBuilderPackage(GUEST_STUDENT_ID, 'pkg-duo')
    const max = duo.getState().site.packages.find((p) => p.id === 'pkg-duo')!.maxCourses
    expect(max).toBe(2)
    duo.getState().addBuilderGroup(GUEST_STUDENT_ID, 'g1')
    duo.getState().addBuilderGroup(GUEST_STUDENT_ID, 'g2')
    expect(duo.getState().addBuilderGroup(GUEST_STUDENT_ID, 'g4')).toMatchObject({ ok: false, reason: 'limit' })
  })
})

describe('visitor cart and package links', () => {
  it('restores the saved cart before a package link applies, so switching the package keeps the courses (trimmed to the package)', () => {
    memory.set(DRAFT_KEY, JSON.stringify({ packageId: 'pkg-trio', groupIds: ['g1', 'g2', 'g4'], meyosGrant: false }))
    const fresh = createIlmoraStore(initialMock)
    expect(fresh.getState().guestHydrated).toBe(false) // the builder waits for this before applying ?package=…
    fresh.getState().hydrateGuest()
    expect(fresh.getState().guestHydrated).toBe(true)
    expect(fresh.getState().students[0].builder.groupIds).toEqual(['g1', 'g2', 'g4'])
    // A Flex link (2 courses) then switches the package: the first two courses stay, nothing else is lost.
    fresh.getState().setBuilderPackage(GUEST_STUDENT_ID, 'pkg-duo')
    expect(fresh.getState().students[0].builder).toMatchObject({ packageId: 'pkg-duo', groupIds: ['g1', 'g2'] })
    expect(JSON.parse(memory.get(DRAFT_KEY) ?? '{}')).toMatchObject({ packageId: 'pkg-duo', groupIds: ['g1', 'g2'] })
  })

  it('marks the cart as read even when nothing was saved', () => {
    const fresh = createIlmoraStore(initialMock)
    fresh.getState().hydrateGuest()
    expect(fresh.getState().guestHydrated).toBe(true)
  })
})

describe('favorites for visitors', () => {
  it('persists saved courses on the device and restores them in a new store', () => {
    const store = createIlmoraStore(initialMock)
    store.getState().toggleSavedCourse(GUEST_STUDENT_ID, 'c1')
    store.getState().toggleSavedCourse(GUEST_STUDENT_ID, 'c2')
    expect(JSON.parse(memory.get(GUEST_SAVED_KEY) ?? '[]')).toEqual(['c1', 'c2'])
    const fresh = createIlmoraStore(initialMock)
    expect(fresh.getState().students[0].savedCourseIds).toEqual([]) // first render matches the server: nothing read yet
    fresh.getState().hydrateGuest() // after mount
    expect(fresh.getState().students[0].savedCourseIds).toEqual(['c1', 'c2'])

    store.getState().toggleSavedCourse(GUEST_STUDENT_ID, 'c1')
    store.getState().toggleSavedCourse(GUEST_STUDENT_ID, 'c2')
    expect(memory.has(GUEST_SAVED_KEY)).toBe(false)
    expect(apiMock).not.toHaveBeenCalled()
  })
})

describe('merging a visitor into an account at login', () => {
  const overview = { builder: { packageId: null, groupIds: ['g2'], meyosGrant: false }, subscription: null, payments: [] }

  it('merges cart and favorites without duplicates, reports dropped items and clears the local copies', async () => {
    vi.useFakeTimers()
    memory.set(DRAFT_KEY, JSON.stringify({ packageId: null, groupIds: ['g1', 'g2b', 'g3'], meyosGrant: false }))
    memory.set(GUEST_SAVED_KEY, JSON.stringify(['c1', 'c2', 'removed-course']))
    apiMock.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (opts?.method === 'PUT') return {}
      if (path === '/student/subscription') return overview
      if (path === '/student/saved') return { courseIds: ['c2'], teacherIds: [] }
      return {}
    })
    const store = createIlmoraStore(initialMock)
    signIn(store)

    await store.getState().loadStudentOverview()

    const me = store.getState().students[0]
    // account first; g2b is the same course as g2 and g3 overlaps g1, so both guest groups are dropped
    expect(me.builder.groupIds).toEqual(['g2', 'g1'])
    expect(store.getState().toasts.length).toBeGreaterThan(0)
    // favorites: union, unknown course discarded, only the missing one uploaded
    expect(me.savedCourseIds).toEqual(['c2', 'c1'])
    const savedPuts = apiMock.mock.calls.filter(([p, o]) => p === '/student/saved' && (o as { method?: string })?.method === 'PUT')
    expect(savedPuts).toHaveLength(1)
    expect((savedPuts[0][1] as { body: { itemId: string } }).body.itemId).toBe('c1')
    expect(memory.has(GUEST_SAVED_KEY)).toBe(false)

    // the merged cart is sent to the server, and only then is the local guest cart removed
    expect(memory.has(DRAFT_KEY)).toBe(true)
    await vi.advanceTimersByTimeAsync(600)
    expect(apiMock).toHaveBeenCalledWith('/student/subscription/draft', { method: 'PUT', body: { packageId: null, groupIds: ['g2', 'g1'], meyosGrant: false } })
    expect(memory.has(DRAFT_KEY)).toBe(false)
  })

  it('keeps the account draft untouched when the visitor has nothing, and never caches signed-in changes locally', async () => {
    vi.useFakeTimers()
    apiMock.mockImplementation(async (path: string) => (path === '/student/subscription' ? overview : path === '/student/saved' ? { courseIds: [], teacherIds: [] } : {}))
    const store = createIlmoraStore(initialMock)
    signIn(store)
    await store.getState().loadStudentOverview()
    expect(store.getState().students[0].builder.groupIds).toEqual(['g2'])

    store.getState().addBuilderGroup('u1', 'g1')
    await vi.advanceTimersByTimeAsync(600)
    expect(memory.has(DRAFT_KEY)).toBe(false)
    expect(apiMock).toHaveBeenCalledWith('/student/subscription/draft', expect.objectContaining({ method: 'PUT' }))
  })
})
