import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sampleData } from '@ilmora/shared'
import { api } from '../lib/api'
import type { AuthUser, InitialData } from './useStore'
import { createIlmoraStore, NO_PERMISSIONS } from './useStore'

vi.mock('../lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/api')>()), api: vi.fn() }))
const apiMock = vi.mocked(api)

// What `GET /public/site` answers now: the template without the role-permission matrix (Ж17).
const { permissions: _p, ...publicSite } = sampleData.site as unknown as { permissions: unknown }
void _p
const initial: InitialData = {
  lang: 'uz',
  site: { ...publicSite, version: 1 } as never,
  catalog: { centers: sampleData.centers as never, categories: sampleData.categories as never, teachers: sampleData.teachers as never, subjects: sampleData.subjects as never, courses: sampleData.courses as never },
}
const account = (id: string, roles: string[]): AuthUser => ({
  id, login: id, phone: null, displayName: id, district: null, preferredLang: 'uz', reminders: false, roles, centerId: null, teacherProfileId: roles.includes('TEACHER') ? `tp-${id}` : null,
  offerAcceptedAt: '2026-11-01T00:00:00Z', offerVersion: '1.0', consentAt: '2026-11-01T00:00:00Z', marketing: false,
} as AuthUser)
const TEACHER_SWITCHES = { editCourses: true, editPrices: true, editSchedules: false, publishDirectly: true, customizeChannel: true, manageGroups: false, uploadResources: true }

/** Answers the sign-in with `user`, and `GET /me/permissions` with `own`. */
const serve = (user: AuthUser, own: unknown) =>
  apiMock.mockImplementation(async (path: string) => (path === '/auth/login' ? { accessToken: 'token', user } : path === '/me/permissions' ? own : {}) as never)

beforeEach(() => apiMock.mockReset())
afterEach(() => vi.useRealTimers())

describe('Ж17: the role-permission matrix comes only after sign-in', () => {
  it('a visitor has every switch off, even if the server render still carried a matrix', () => {
    expect(createIlmoraStore(initial).getState().site.permissions).toEqual(NO_PERMISSIONS)
    const withMatrix = createIlmoraStore({ ...initial, site: Object.assign({}, sampleData.site, { version: 1 }) as never })
    expect(withMatrix.getState().site.permissions).toEqual(NO_PERMISSIONS)
  })

  it('a teacher reads their own switches after sign-in; the student ones stay off', async () => {
    serve(account('t1', ['TEACHER']), { teacher: TEACHER_SWITCHES })
    const store = createIlmoraStore(initial)
    await store.getState().login('t1', 'password-1')
    expect(apiMock).toHaveBeenCalledWith('/me/permissions')
    await vi.waitFor(() => expect(store.getState().site.permissions.teacher).toEqual(TEACHER_SWITCHES))
    expect(store.getState().site.permissions.student).toEqual(NO_PERMISSIONS.student)
  })

  it('signing out drops the account\'s switches', async () => {
    serve(account('t1', ['TEACHER']), { teacher: TEACHER_SWITCHES })
    const store = createIlmoraStore(initial)
    await store.getState().login('t1', 'password-1')
    await vi.waitFor(() => expect(store.getState().site.permissions.teacher.publishDirectly).toBe(true))
    await store.getState().logout()
    expect(store.getState().site.permissions).toEqual(NO_PERMISSIONS)
  })

  it('an answer that arrives after the sign-out is dropped', async () => {
    let answer: (v: unknown) => void = () => undefined
    apiMock.mockImplementation(async (path: string) => (path === '/auth/login' ? { accessToken: 'token', user: account('t1', ['TEACHER']) } : path === '/me/permissions' ? new Promise((r) => { answer = r }) : {}) as never)
    const store = createIlmoraStore(initial)
    await store.getState().login('t1', 'password-1')
    await store.getState().logout()
    answer({ teacher: TEACHER_SWITCHES })
    await new Promise((r) => setTimeout(r, 0))
    expect(store.getState().site.permissions).toEqual(NO_PERMISSIONS)
  })

  it('the Super Admin does not read them here: the whole matrix comes with GET /admin/site', async () => {
    serve(account('a1', ['PLATFORM_ADMIN']), {})
    const store = createIlmoraStore(initial)
    await store.getState().login('a1', 'password-1')
    expect(apiMock).not.toHaveBeenCalledWith('/me/permissions')
  })

  it('the status goes loading → ready, and the teacher workspace is ready only with the switches', async () => {
    let answer: (v: unknown) => void = () => undefined
    const mine = { teacher: null, courses: [], videos: [], playlists: [], resources: [], subjects: [] }
    apiMock.mockImplementation(async (path: string) => (path === '/auth/login' ? { accessToken: 'token', user: account('t1', ['TEACHER']) } : path === '/me/permissions' ? new Promise((r) => { answer = r }) : path === '/manage/mine' ? mine : {}) as never)
    const store = createIlmoraStore(initial)
    expect(store.getState().permissionsStatus).toBe('idle')
    await store.getState().login('t1', 'password-1')
    expect(store.getState().permissionsStatus).toBe('loading')
    const workspace = store.getState().ensureWorkspace()
    await new Promise((r) => setTimeout(r, 0))
    expect(store.getState().workspaceLoaded).toBe(false)
    answer({ teacher: TEACHER_SWITCHES })
    await workspace
    expect(store.getState().workspaceLoaded).toBe(true)
    expect(store.getState().permissionsStatus).toBe('ready')
    expect(store.getState().site.permissions.teacher).toEqual(TEACHER_SWITCHES)
  })

  it('a failed load is retried once; if that fails too the switches stay off, the status is error and the account is told', async () => {
    vi.useFakeTimers()
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/auth/login') return { accessToken: 'token', user: account('t1', ['TEACHER']) } as never
      if (path === '/me/permissions') throw new Error('offline')
      return {} as never
    })
    const store = createIlmoraStore(initial)
    await store.getState().login('t1', 'password-1')
    await vi.advanceTimersByTimeAsync(2000)
    expect(apiMock.mock.calls.filter(([p]) => p === '/me/permissions')).toHaveLength(2)
    expect(store.getState().permissionsStatus).toBe('error')
    expect(store.getState().site.permissions).toEqual(NO_PERMISSIONS)
    expect(store.getState().toasts.some((x) => x.tone === 'warn')).toBe(true)
  })

  it('the retry succeeds after one failure', async () => {
    vi.useFakeTimers()
    let calls = 0
    apiMock.mockImplementation(async (path: string) => {
      if (path === '/auth/login') return { accessToken: 'token', user: account('t1', ['TEACHER']) } as never
      if (path === '/me/permissions' && calls++ === 0) throw new Error('offline')
      return (path === '/me/permissions' ? { teacher: TEACHER_SWITCHES } : {}) as never
    })
    const store = createIlmoraStore(initial)
    await store.getState().login('t1', 'password-1')
    await vi.advanceTimersByTimeAsync(2000)
    expect(store.getState().permissionsStatus).toBe('ready')
    expect(store.getState().site.permissions.teacher).toEqual(TEACHER_SWITCHES)
  })
})

describe('Ж17: the whole matrix of the Super Admin', () => {
  const ADMIN_MATRIX = {
    teacher: { ...TEACHER_SWITCHES, editPrices: false },
    student: { saveItems: true, switchGroups: true, downloadResources: false },
  }
  const adminSite = (version: number) => ({ ...sampleData.site, permissions: ADMIN_MATRIX, presets: [{ id: 'off', enabled: false, name: { uz: 'x', ru: 'x', en: 'x' }, description: { uz: '', ru: '', en: '' }, slots: [] }], version })

  it('an /admin/site answer that arrives after the sign-out is dropped', async () => {
    let answer: (v: unknown) => void = () => undefined
    apiMock.mockImplementation(async (path: string) => (path === '/auth/login' ? { accessToken: 'token', user: account('a1', ['PLATFORM_ADMIN']) } : path === '/admin/site' ? new Promise((r) => { answer = r }) : {}) as never)
    const store = createIlmoraStore(initial)
    await store.getState().login('a1', 'password-1')
    const load = store.getState().loadAdminPresets()
    await store.getState().logout()
    answer(adminSite(5))
    await load
    expect(store.getState().site.permissions).toEqual(NO_PERMISSIONS)
    expect(store.getState().presetsLoaded).toBe(false)
    expect((store.getState().site.presets ?? []).some((p) => p.id === 'off')).toBe(false)
    expect(store.getState().permissionsStatus).toBe('idle')
  })

  it('a site save sends the whole matrix from /admin/site, never the all-off defaults', async () => {
    vi.useFakeTimers()
    apiMock.mockImplementation(async (path: string, opts?: { method?: string }) => (path === '/auth/login' ? { accessToken: 'token', user: account('a1', ['PLATFORM_ADMIN']) } : path === '/admin/site' ? (opts?.method === 'PUT' ? { version: 6 } : adminSite(5)) : {}) as never)
    const store = createIlmoraStore(initial)
    await store.getState().login('a1', 'password-1')
    await store.getState().loadAdminPresets()
    expect(store.getState().permissionsStatus).toBe('ready')
    store.getState().patchSite((s) => ({ ...s, brand: { ...s.brand } }))
    await vi.advanceTimersByTimeAsync(900)
    const save = apiMock.mock.calls.find(([p, o]) => p === '/admin/site' && (o as { method?: string } | undefined)?.method === 'PUT')
    expect(save).toBeDefined()
    expect((save![1] as { body: { data: { permissions: unknown } } }).body.data.permissions).toEqual(ADMIN_MATRIX)
  })
})
