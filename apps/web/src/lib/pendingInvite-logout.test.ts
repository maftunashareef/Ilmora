import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sampleData } from '@ilmora/shared'
import { createIlmoraStore, type InitialData } from '../store/useStore'
import { pendingInvite } from './pendingInvite'

/**
 * Security check 20.11 (note «2026-11-20 Проверка безопасности ILMORA»), finding №5: a center's invitation token
 * (lib/pendingInvite.ts) is kept in a module variable and in the tab's sessionStorage until the invitation is accepted
 * or found invalid. Signing out (store logout) does not drop it, so on a shared computer the next person who signs in
 * in the same tab gets «Приглашение ждёт» in the student cabinet (StudentLayout) and can accept someone else's invite
 * into their own account.
 *
 * Rule: after logout no invitation is pending — pendingInvite.has() is false, take() gives null, and the tab's
 * sessionStorage has no token.
 *
 * Node environment (no jsdom): `window` (location, history) and `sessionStorage` are stubbed; fetch answers the logout
 * call. KNOWN_GAP pins today's state: when logout starts clearing the invitation, the check fails with «remove 'n5' from
 * KNOWN_GAP» — then remove it and the rule is demanded from then on.
 */
const KNOWN_GAP = new Set(['n5'])
function rule(key: string, holds: boolean, what: string) {
  if (KNOWN_GAP.has(key)) expect(holds, `${what} — now holds: finding closed, remove '${key}' from KNOWN_GAP`).toBe(false)
  else expect(holds, what).toBe(true)
}

const KEY = 'ilmora:center-invite'
const TOKEN = 'inv_AbCdEfGhIjKlMnOpQrStUvWx0123'

const initial: InitialData = {
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

let storage: Map<string, string>
const location = { hash: '', pathname: '/uz/invite', search: '' }

beforeEach(() => {
  storage = new Map()
  vi.stubGlobal('sessionStorage', {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => { storage.set(k, String(v)) },
    removeItem: (k: string) => { storage.delete(k) },
    clear: () => storage.clear(),
  })
  vi.stubGlobal('window', { location, history: { state: null, replaceState: () => { location.hash = '' } } })
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } })))
})
afterEach(() => {
  pendingInvite.clear()
  vi.unstubAllGlobals()
})

describe('№5 a pending center invitation does not outlive the session', () => {
  it('logout leaves no invitation in memory or in sessionStorage', async () => {
    const store = createIlmoraStore(initial)
    await store.getState().loginAsDemo('STUDENT')
    // The student opens /invite#<token>; the page keeps the token and takes it out of the address bar.
    location.hash = `#${TOKEN}`
    expect(pendingInvite.take()).toBe(TOKEN)
    pendingInvite.stripHash()
    // Setup sanity: kept in both places, not only in the fragment, and the store is signed in.
    expect(location.hash).toBe('')
    expect(storage.get(KEY)).toBe(TOKEN)
    expect(pendingInvite.has()).toBe(true)
    expect(store.getState().auth.status).toBe('authenticated')

    await store.getState().logout()
    expect(store.getState().auth.user).toBeNull()

    const has = pendingInvite.has()
    const taken = pendingInvite.take()
    const stored = storage.get(KEY) ?? null
    rule('n5', !has && taken === null && stored === null, `after logout no invitation is pending (now: has() ${has}, take() ${taken ? 'returns the token' : 'null'}, sessionStorage ${stored ? 'holds the token' : 'empty'})`)
  })
})
