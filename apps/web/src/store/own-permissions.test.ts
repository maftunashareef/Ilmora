import { beforeEach, describe, expect, it, vi } from 'vitest'
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
})
