import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sampleData } from '@ilmora/shared'
import { api } from '../lib/api'
import type { InitialData } from './useStore'
import { createIlmoraStore } from './useStore'

vi.mock('../lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/api')>()), api: vi.fn() }))
const apiMock = vi.mocked(api)

const initial: InitialData = {
  lang: 'uz',
  site: Object.assign({}, sampleData.site, { version: 1 }) as never,
  catalog: { centers: sampleData.centers as never, categories: sampleData.categories as never, teachers: sampleData.teachers as never, subjects: sampleData.subjects as never, courses: sampleData.courses as never },
}
const calls = (method: string) => apiMock.mock.calls.filter(([, opts]) => (opts as { method?: string } | undefined)?.method === method)

beforeEach(() => {
  apiMock.mockReset()
  apiMock.mockResolvedValue({ id: 'pkg-new' })
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('admin package edits are saved through the packages API', () => {
  it('the sample packages are Flex and Winx, keeping the ids pkg-duo and pkg-trio that subscriptions point at', () => {
    const packages = createIlmoraStore(initial).getState().site.packages
    expect(packages.map((p) => [p.id, p.name.en, p.maxCourses])).toEqual([['pkg-duo', 'Flex', 2], ['pkg-trio', 'Winx', 3]])
  })

  it('a rename is sent once typing pauses, to the same package id, and is not part of the site save', async () => {
    const store = createIlmoraStore(initial)
    store.setState({ role: 'admin' })
    store.getState().savePackage('pkg-duo', { name: { uz: 'Fle', ru: 'Fle', en: 'Fle' } })
    store.getState().savePackage('pkg-duo', { name: { uz: 'Flex', ru: 'Flex', en: 'Flex' } })
    expect(store.getState().site.packages.find((p) => p.id === 'pkg-duo')?.name.en).toBe('Flex')
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls('PATCH')).toEqual([['/admin/packages/pkg-duo', { method: 'PATCH', body: { name: { uz: 'Flex', ru: 'Flex', en: 'Flex' } } }]])
    expect(calls('PUT')).toEqual([])
  })

  it('changes to two packages go to their own ids', async () => {
    const store = createIlmoraStore(initial)
    store.setState({ role: 'admin' })
    store.getState().savePackage('pkg-duo', { enabled: false })
    store.getState().savePackage('pkg-trio', { highlight: true, maxCourses: 3 })
    await vi.advanceTimersByTimeAsync(1000)
    expect(calls('PATCH').map(([path, opts]) => [path, (opts as { body: unknown }).body])).toEqual([
      ['/admin/packages/pkg-duo', { enabled: false }],
      ['/admin/packages/pkg-trio', { highlight: true, maxCourses: 3 }],
    ])
  })

  it('a visitor or student never sends package changes', async () => {
    const store = createIlmoraStore(initial)
    store.getState().savePackage('pkg-duo', { enabled: false })
    await vi.advanceTimersByTimeAsync(1000)
    expect(apiMock).not.toHaveBeenCalled()
  })

  it('a new package is created switched off, with a valid code, and added under the id the API returns', async () => {
    const store = createIlmoraStore(initial)
    store.setState({ role: 'admin' })
    await store.getState().addPackage()
    const [[path, opts]] = calls('POST')
    const body = (opts as { body: { code: string; enabled: boolean; maxCourses: number } }).body
    expect(path).toBe('/admin/packages')
    expect(body.code).toMatch(/^[a-z0-9-]{2,30}$/)
    expect(body).toMatchObject({ enabled: false, maxCourses: 4 })
    expect(store.getState().site.packages.map((p) => p.id)).toEqual(['pkg-duo', 'pkg-trio', 'pkg-new'])
  })
})
