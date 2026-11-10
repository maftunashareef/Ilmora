import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: { path: string; method?: string; body?: unknown }[] = []
let claimAnswer: { created: boolean } = { created: false }
let patchFails = false

vi.mock('../lib/api', () => ({
  api: vi.fn(async (path: string, opts: { method?: string; body?: unknown } = {}) => {
    calls.push({ path, method: opts.method, body: opts.body })
    if (path === '/institutions/claim') return claimAnswer
    if (path === '/institutions/me' && patchFails) throw new Error('validation_failed')
    return {}
  }),
}))

const { claimInstitution } = await import('./institutions')

const choice = { stir: '200237474', type: 'TECHNIKUM' as const, name: ' Andijon pedagogika texnikumi ', ownership: 'STATE' as const, region: 'andijan' }

describe('claiming an institution after sign-up', () => {
  beforeEach(() => { calls.length = 0; patchFails = false })

  it('sends the STIR, the registry type and the trimmed name, and stops there for a listed STIR', async () => {
    claimAnswer = { created: false }
    expect(await claimInstitution(choice)).toEqual({ created: false, detailsSaved: true })
    expect(calls).toEqual([{ path: '/institutions/claim', method: 'POST', body: { stir: '200237474', type: 'TECHNIKUM', name: 'Andijon pedagogika texnikumi' } }])
  })

  it('saves ownership and region to the passport of a new institution', async () => {
    claimAnswer = { created: true }
    expect(await claimInstitution({ ...choice, type: 'TRAINING_CENTER', ownership: 'PRIVATE' })).toEqual({ created: true, detailsSaved: true })
    expect(calls[0].body).toMatchObject({ type: 'TRAINING_CENTER' })
    expect(calls[1]).toEqual({ path: '/institutions/me', method: 'PATCH', body: { ownership: 'PRIVATE', regionId: 'andijan' } })
  })

  it('keeps the claim when saving the details fails', async () => {
    claimAnswer = { created: true }
    patchFails = true
    expect(await claimInstitution(choice)).toEqual({ created: true, detailsSaved: false })
  })
})
