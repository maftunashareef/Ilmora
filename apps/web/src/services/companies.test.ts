import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: { path: string; method?: string; body?: unknown }[] = []
let patchFails = false

vi.mock('../lib/api', () => ({
  api: vi.fn(async (path: string, opts: { method?: string; body?: unknown } = {}) => {
    calls.push({ path, method: opts.method, body: opts.body })
    if (path === '/companies/me' && patchFails) throw new Error('validation_failed')
    return {}
  }),
}))

const { startCompany } = await import('./companies')

describe('starting a company profile after sign-up', () => {
  beforeEach(() => { calls.length = 0; patchFails = false })

  it('creates the profile from the STIR and name, then saves the representative’s email', async () => {
    expect(await startCompany({ stir: '301234567', name: ' Ilm Servis ', email: ' info@ilm.uz ' })).toEqual({ emailSaved: true })
    expect(calls).toEqual([
      { path: '/companies', method: 'POST', body: { stir: '301234567', name: 'Ilm Servis' } },
      { path: '/companies/me', method: 'PATCH', body: { representative: { email: 'info@ilm.uz' } } },
    ])
  })

  it('keeps the profile when saving the email fails', async () => {
    patchFails = true
    expect(await startCompany({ stir: '301234567', name: 'Ilm Servis', email: 'info@ilm.uz' })).toEqual({ emailSaved: false })
  })
})
