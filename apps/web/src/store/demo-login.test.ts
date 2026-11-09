import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sampleData } from '@ilmora/shared'
import { api } from '../lib/api'
import type { InitialData } from './useStore'
import { createIlmoraStore } from './useStore'

// A production build without NEXT_PUBLIC_ENABLE_DEMO_LOGIN: the mock sign-in paths must refuse to open a session.
vi.mock('../lib/demoMode', () => ({ DEMO_LOGIN_ENABLED: false }))
vi.mock('../lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/api')>()), api: vi.fn() }))
const apiMock = vi.mocked(api)

const initialMock: InitialData = {
  lang: 'uz',
  site: Object.assign({}, sampleData.site, { version: 1 }) as never,
  catalog: {
    centers: sampleData.centers as never,
    categories: sampleData.categories as never,
    teachers: sampleData.teachers as never,
    subjects: sampleData.subjects as never,
    courses: sampleData.courses as never,
  },
}

beforeEach(() => {
  apiMock.mockReset()
  apiMock.mockRejectedValue(new Error('offline'))
})

describe('demo sign-in is off in production builds', () => {
  it('loginAsDemo refuses and leaves the visitor signed out', async () => {
    const store = createIlmoraStore(initialMock)
    await expect(store.getState().loginAsDemo('STUDENT')).rejects.toThrow('demo_login_disabled')
    await expect(store.getState().loginAsDemo('TEACHER')).rejects.toThrow('demo_login_disabled')
    expect(store.getState().auth.status).not.toBe('authenticated')
    expect(store.getState().role).toBe('visitor')
  })
})
