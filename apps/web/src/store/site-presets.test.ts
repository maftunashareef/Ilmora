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
const sentVersion = (i: number) => (siteSaves()[i][1] as { body: { version: number } }).body.version
const siteReads = () => apiMock.mock.calls.filter(([path, opts]) => path === '/admin/site' && !(opts as { method?: string } | undefined)?.method)
/** What `GET /admin/site` answers: all the settings, with the disabled presets, and their version. */
const serverSite = (version: number, extra: Record<string, unknown> = {}) => ({ ...sampleData.site, presets: [on, off], ...extra, version })

beforeEach(() => {
  apiMock.mockReset()
  vi.useFakeTimers()
})
afterEach(() => vi.useRealTimers())

describe('disabled presets stay internal in the web app', () => {
  it('lets an admin load the full list, which the public response leaves out', async () => {
    apiMock.mockResolvedValue(serverSite(1))
    const store = createIlmoraStore(initial)
    expect(store.getState().presetsLoaded).toBe(false)
    expect(store.getState().site.presets?.map((p) => p.id)).toEqual(['on'])

    await store.getState().loadAdminPresets()

    expect(apiMock).toHaveBeenCalledWith('/admin/site')
    expect(store.getState().presetsLoaded).toBe(true)
    expect(store.getState().site.presets?.map((p) => p.id)).toEqual(['on', 'off'])
  })

  it('sends the full preset list once the settings are loaded', async () => {
    apiMock.mockImplementation(async (path: string, opts?: { method?: string }) => (path === '/admin/site' ? (opts?.method === 'PUT' ? { version: 2 } : serverSite(1)) : {}))
    const store = createIlmoraStore(initial)
    store.setState({ role: 'admin' })

    await store.getState().loadAdminPresets()
    store.getState().patchSite((s) => ({ ...s, brand: { ...s.brand } }))
    await vi.advanceTimersByTimeAsync(900)
    expect(siteSaves()).toHaveLength(1)
    expect((sentData(0).presets as Preset[]).map((p) => p.id)).toEqual(['on', 'off'])
  })

  it('drops disabled presets from memory when the user signs out', async () => {
    apiMock.mockResolvedValue(serverSite(1))
    const store = createIlmoraStore(initial)
    await store.getState().loadAdminPresets()
    expect(store.getState().site.presets).toHaveLength(2)

    await store.getState().logout()

    expect(store.getState().presetsLoaded).toBe(false)
    expect(store.getState().site.presets?.map((p) => p.id)).toEqual(['on'])
  })
})

describe('the admin works on the settings from the server, not on the cached page', () => {
  // The page was rendered from a cached public read: an old brand name and a version number that is not the server's.
  const cached: InitialData = { ...initial, site: Object.assign({}, sampleData.site, { version: 7, presets: [on], brand: { ...sampleData.site.brand, name: 'Cached' } }) as never }

  it('holds the server values and the server version after the load, and a save sends exactly them', async () => {
    const server = serverSite(3, { brand: { ...sampleData.site.brand, name: 'Server' }, faq: [] })
    apiMock.mockImplementation(async (path: string, opts?: { method?: string }) => (path === '/admin/site' ? (opts?.method === 'PUT' ? { version: 4 } : server) : {}))
    const store = createIlmoraStore(cached)
    store.setState({ role: 'admin' })

    await store.getState().loadAdminPresets()
    // Values and version come from the one answer — the version is the server's 3, not the larger cached 7.
    expect(store.getState().site.brand.name).toBe('Server')
    expect(store.getState().site.presets?.map((p) => p.id)).toEqual(['on', 'off'])
    expect(store.getState().siteVersion).toBe(3)

    const city = { uz: 'Toşkent', ru: 'Ташкент', en: 'Tashkent' }
    store.getState().patchSite((s) => ({ ...s, brand: { ...s.brand, city } }))
    await vi.advanceTimersByTimeAsync(900)
    expect(siteSaves()).toHaveLength(1)
    const { version: _v, packages: _p, ...expected } = server
    void _v; void _p
    expect(sentData(0)).toEqual({ ...expected, brand: { ...server.brand, city } })
    expect(sentVersion(0)).toBe(3)
    expect(store.getState().siteVersion).toBe(4)
  })

  it('refuses a site edit before the settings are loaded: nothing is sent, the admin is told to refresh the page', async () => {
    const store = createIlmoraStore(cached)
    store.setState({ role: 'admin' })

    store.getState().patchSite((s) => ({ ...s, brand: { ...s.brand, name: 'Mine' } }))
    await vi.advanceTimersByTimeAsync(900)
    expect(siteSaves()).toHaveLength(0)
    expect(store.getState().site.brand.name).toBe('Cached')
    expect(store.getState().toasts.at(-1)).toMatchObject({ tone: 'warn', text: expect.stringContaining('Sahifani yangilang') })
  })

  it('a failed load keeps saves refused and shows the refresh notice; the cached values never go out', async () => {
    apiMock.mockImplementation(async (path: string, opts?: { method?: string }) => {
      if (path === '/admin/site' && !opts?.method) throw new ApiError(500, 'internal_error', 'boom')
      return { version: 8 }
    })
    const store = createIlmoraStore(cached)
    store.setState({ role: 'admin' })

    await expect(store.getState().loadAdminPresets()).rejects.toThrow()
    expect(store.getState().presetsLoaded).toBe(false)
    expect(store.getState().siteLoadFailed).toBe(true)

    store.getState().patchSite((s) => ({ ...s, brand: { ...s.brand, name: 'Mine' } }))
    await vi.advanceTimersByTimeAsync(900)
    expect(siteSaves()).toHaveLength(0)
    expect(store.getState().site.brand.name).toBe('Cached')
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
    stored = 4
    await store.getState().loadAdminPresets()
    expect(store.getState().siteVersion).toBe(4)

    // Another admin saves meanwhile (version 5); this admin's change still carries 4.
    stored = 5
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
      return path === '/admin/site' ? serverSite(1) : {}
    })
    const store = createIlmoraStore(initial)
    store.setState({ role: 'admin' })
    await store.getState().loadAdminPresets()
    store.getState().patchSite((s) => ({ ...s, brand: { ...s.brand } }))
    await vi.advanceTimersByTimeAsync(900)
    expect(siteSaves()).toHaveLength(1)
    // Only the load read the settings: no reload after a non-conflict error.
    expect(siteReads()).toHaveLength(1)
    expect(store.getState().siteVersion).toBe(1)
  })
})
