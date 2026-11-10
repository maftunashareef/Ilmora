import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, ApiError, setPasswordChangeRequiredHandler } from './api'

const answer = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }))

afterEach(() => { setPasswordChangeRequiredHandler(null); vi.unstubAllGlobals() })

describe('403 password_change_required (PR #48): the temporary password is still in use', () => {
  it('tells the store, then throws the API error as usual', async () => {
    const handler = vi.fn()
    setPasswordChangeRequiredHandler(handler)
    vi.stubGlobal('fetch', answer(403, { error: { code: 'password_change_required', message: 'Change the temporary password first' } }))
    await expect(api('/ministry/stats')).rejects.toMatchObject({ status: 403, code: 'password_change_required' })
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('any other 403 is only an error', async () => {
    const handler = vi.fn()
    setPasswordChangeRequiredHandler(handler)
    vi.stubGlobal('fetch', answer(403, { error: { code: 'forbidden', message: 'Forbidden' } }))
    await expect(api('/admin/users')).rejects.toBeInstanceOf(ApiError)
    expect(handler).not.toHaveBeenCalled()
  })
})
