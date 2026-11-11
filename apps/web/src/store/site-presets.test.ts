import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sampleData, type Preset } from '@ilmora/shared'
import { api, ApiError } from '../lib/api'
import type { InitialData } from './useStore'
import { createIlmoraStore } from './useStore'

vi.mock('../lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/api')>()), api: vi.fn() }))
const apiMock = vi.mocked(api)

const label = { uz: '', ru: '', en: '' }
const preset = (id: string, enabled: boolean): Preset => ({ id, name: { uz: id, ru: id, en: id }, description: label, slots: [{ id: 's1', label, courseId: null }], enabled })
const on = preset('on', true)
const off = preset('off', false)

// The public site response only carries enabled presets.
const initial: InitialData = {
  lang: 'uz',
  site: Object.assign({}, sampleData.site, { version: 1, presets: [on] }) as never,
  catalog: {
    centers: sampleData.centers as never,
    categories: sampleData.categories as never,
    teachers: sampleData.teachers as never,
    subjects: sampleData.subjects as never,
    courses: sampleData.courses as never,
  },
}

const siteSaves = () => apiMock.mock.calls.filter(([path, opts]) => path === '/admin/site' && (opts as { method?: string } | undefined)?.method === 'PUT')
const sentData = (i: number) => (siteSaves()[i][1] as { body: { data: Record<string, unknown> } }).body.data

beforeEach(() => {
  apiMock.mockReset()
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('disabled presets stay internal in the web app', () => {
  it('lets an admin load the full list, which the public response leaves out', async () => {
    apiMock.mockResolvedValue({ presets: [on, off], version: 1 })
    const store = createIlmoraStore(initial)
    expect(store.getState().presetsLoaded).toBe(false)
    expect(store.getState().site.presets?.map((p) => p.id)).toEqual(['on'])

    await store.getState().loadAdminPresets()

    expect(apiMock).toHaveBeenCalledWith('/admin/site')
    expect(store.getState().presetsLoaded).toBe(true)
    expect(store.getState().site.presets?.map((p) => p.id)).toEqual(['on', 'off'])
  })

  it('leaves presets out of a site save made before the full list is loaded, and sends them afterwards', async () => {
    apiMock.mockImplementation(async (path: string) => (path === '/admin/site' ? { presets: [on, off], version: 1 } : {}))
    const store = createIlmoraStore(initial)
    store.setState({ role: 'admin' })

    store.getState().patchSite((s) => ({ ...s, brand: { ...s.brand } }))
    await vi.advanceTimersByTimeAsync(900)
    expect(siteSaves()).toHaveLength(1)
    expect('presets' in sentData(0)).toBe(false)

    await store.getState().loadAdminPresets()
    store.getState().patchSite((s) => ({ ...s, brand: { ...s.brand } }))
    await vi.advanceTimersByTimeAsync(900)
    expect(siteSaves()).toHaveLength(2)
    expect((sentData(1).presets as Preset[]).map((p) => p.id)).toEqual(['on', 'off'])
  })

  it('drops disabled presets from memory when the user signs out', async () => {
    apiMock.mockResolvedValue({ presets: [on, off], version: 1 })
    const store = createIlmoraStore(initial)
    await store.getState().loadAdminPresets()
    expect(store.getState().site.presets).toHaveLength(2)

    await store.getState().logout()

    expect(store.getState().presetsLoaded).toBe(false)
    expect(store.getState().site.presets?.map((p) => p.id)).toEqual(['on'])
  })
})

describe('a site save after someone else saved (version_conflict)', () => {
  it('loads the current settings and their version, warns the admin, and the next save goes through', async () => {
    const theirs = Object.assign({}, sampleData.site, { presets: [on, off], brand: { ...sampleData.site.brand, name: 'ILMORA+' } })
    let stored = 5
    apiMock.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
      if (path !== '/admin/site') return {}
      if (opts?.method === 'PUT') {
        const sent = (opts.body as { version: number }).version
        if (sent !== stored) throw new ApiError(409, 'version_conflict', 'changed by someone else')
        stored += 1
        return { version: stored }
      }
      return { ...theirs, version: stored }
    })
    const store = createIlmoraStore(initial)
    store.setState({ role: 'admin' })

    // The page was rendered with version 1; another admin has saved up to 5 since.
    store.getState().patchSite((s) => ({ ...s, brand: { ...s.brand, name: 'Mine' } }))
    await vi.advanceTimersByTimeAsync(900)
    expect(siteSaves()).toHaveLength(1)
    expect(store.getState().siteVersion).toBe(5)
    expect(store.getState().site.brand.name).toBe('ILMORA+')
    expect(store.getState().presetsLoaded).toBe(true)
    expect(store.getState().toasts.at(-1)).toMatchObject({ tone: 'warn' })

    // The next change is saved on top of their version.
    store.getState().patchSite((s) => ({ ...s, brand: { ...s.brand, name: 'Mine again' } }))
    await vi.advanceTimersByTimeAsync(900)
    expect(siteSaves()).toHaveLength(2)
    expect(store.getState().siteVersion).toBe(6)
  })

  it('any other save error is only shown', async () => {
    apiMock.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === '/admin/site' && opts?.method === 'PUT') throw new ApiError(500, 'internal_error', 'boom')
      return {}
    })
    const store = createIlmoraStore(initial)
    store.setState({ role: 'admin' })
    store.getState().patchSite((s) => ({ ...s, brand: { ...s.brand } }))
    await vi.advanceTimersByTimeAsync(900)
    expect(apiMock.mock.calls.filter(([path, opts]) => path === '/admin/site' && !(opts as { method?: string } | undefined)?.method)).toHaveLength(0)
    expect(store.getState().siteVersion).toBe(1)
  })
})
