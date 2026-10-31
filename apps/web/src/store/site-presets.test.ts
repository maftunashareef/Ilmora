import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sampleData, type Preset } from '@ilmora/shared'
import { api } from '../lib/api'
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
