import { afterEach, describe, expect, it, vi } from 'vitest'
import { api, refreshRetryAfterSeconds, session } from './api'

/** Answers in order: each call to fetch takes the next one. */
function answers(...list: { status: number; body?: unknown; headers?: Record<string, string> }[]) {
  let i = 0
  return vi.fn(async () => {
    const a = list[Math.min(i++, list.length - 1)]
    return new Response(a.body === undefined ? null : JSON.stringify(a.body), { status: a.status, headers: { 'Content-Type': 'application/json', ...(a.headers ?? {}) } })
  })
}

// The client shares one refresh in flight and lets it go on the next tick; wait for that between tests.
afterEach(async () => { session.set(null); vi.unstubAllGlobals(); await new Promise((r) => setTimeout(r, 5)) })

describe('№19: a 429 on refreshing the sign-in', () => {
  it('keeps the session and answers «try again shortly», not «signed out»', async () => {
    vi.stubGlobal('window', globalThis)
    session.set('access-token')
    vi.stubGlobal('fetch', answers({ status: 401, body: { error: { code: 'unauthorized', message: 'expired' } } }, { status: 429, headers: { 'Retry-After': '20' } }))
    await expect(api('/student/overview')).rejects.toMatchObject({ status: 429, code: 'session_refresh_limited' })
    expect(session.token).toBe('access-token')
    expect(refreshRetryAfterSeconds()).toBe(20)
  })

  it('a rejected refresh still ends the session', async () => {
    vi.stubGlobal('window', globalThis)
    session.set('access-token')
    vi.stubGlobal('fetch', answers({ status: 401, body: { error: { code: 'unauthorized', message: 'expired' } } }, { status: 401 }))
    await expect(api('/student/overview')).rejects.toMatchObject({ status: 401 })
    expect(session.token).toBeNull()
  })

  it('a successful refresh retries the request with the new token', async () => {
    vi.stubGlobal('window', globalThis)
    session.set('old')
    vi.stubGlobal('fetch', answers({ status: 401, body: { error: { code: 'unauthorized', message: 'expired' } } }, { status: 200, body: { accessToken: 'new' } }, { status: 200, body: { ok: true } }))
    await expect(api('/student/overview')).resolves.toEqual({ ok: true })
    expect(session.token).toBe('new')
  })
})
