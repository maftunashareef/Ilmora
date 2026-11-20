import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { sampleData } from '@ilmora/shared'
import { session } from './api'
import { createIlmoraStore, type InitialData } from '../store/useStore'
import { pendingInvite } from './pendingInvite'

/**
 * Security check 20.11 (note «2026-11-20 Проверка безопасности ILMORA»), finding №5: a center's invitation token
 * (lib/pendingInvite.ts) is kept in a module variable and in the tab's sessionStorage until the invitation is accepted
 * or found invalid. Signing out does not drop it, so on a shared computer the next person who signs in in the same tab
 * gets «Приглашение ждёт» in the student cabinet (StudentLayout) and can accept someone else's invite into their own
 * account.
 *
 * Rule, about the outcome: an invitation taken while one account was signed in is not pending for another account that
 * signs in next in the same tab — after the store's logout(), and after a forced sign-out (the session is gone and the
 * reloaded page's bootstrap applies «no account», useStore.ts applyAuth(null) on a refused refresh; the reload is
 * simulated with fresh modules, so only sessionStorage carries over). For logout(), clearing on sign-out is enough. For
 * the forced case it is not: the page cannot tell a forced sign-out from a visitor whose session simply expired, so the
 * token has to be bound to the account that took it (or to «signed out») and dropped when a different account signs in.
 *
 * Not to be broken (checked outside the rule, both hold today) — that is how an invitation is meant to be accepted:
 *  - opened while signed out, it is still pending after the page boots without a session and the student signs in;
 *  - opened by a student whose session has expired (the flag cookie is still there; Invite.tsx takes the token before
 *    bootstrap's refused refresh), it is still pending after the student signs in again.
 * So clearing on every applyAuth(null), or whenever the refresh is refused, is not a fix: these checks fail.
 *
 * Covered: the store paths only. The UI handlers that sign out on their own (Switchers.tsx:136, PasswordChange.tsx:88)
 * are not exercised here.
 *
 * Node environment (no jsdom): `window` (location, history, sessionStorage), `sessionStorage`, `document.cookie`,
 * `navigator` and `fetch` are stubbed. KNOWN_GAP pins today's exact observation (the token is still kept, in memory and
 * in sessionStorage): when the rule holds, the check fails with «remove 'n5-…' from KNOWN_GAP»; any other outcome fails
 * as «re-evaluate».
 */
const KNOWN_GAP = new Set(['n5-logout', 'n5-forced'])
const checked = new Set<string>()
function rule(key: string, holds: boolean, what: string, todayObserved: boolean) {
  checked.add(key)
  if (KNOWN_GAP.has(key)) {
    expect(holds, `${what} — now holds: finding closed, remove '${key}' from KNOWN_GAP`).toBe(false)
    expect(todayObserved, `${what} — not today's known outcome: re-evaluate '${key}'`).toBe(true)
  } else expect(holds, what).toBe(true)
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
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  storage = new Map()
  location.hash = ''
  const sessionStub = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => { storage.set(k, String(v)) },
    removeItem: (k: string) => { storage.delete(k) },
    clear: () => storage.clear(),
  }
  vi.stubGlobal('sessionStorage', sessionStub)
  vi.stubGlobal('window', { location, history: { state: null, replaceState: () => { location.hash = '' } }, sessionStorage: sessionStub })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('document', { cookie: '' })
  // The refresh cookie is refused (the session is over); every other call answers ok.
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request) => (String(url).includes('/auth/refresh') ? json(401, { error: { code: 'invalid_refresh', message: 'Session ended' } }) : json(200, { ok: true }))))
})
afterEach(() => {
  pendingInvite.clear()
  session.set(null)
  vi.unstubAllGlobals()
})
afterAll(() => {
  for (const key of KNOWN_GAP) expect(checked.has(key), `'${key}' in KNOWN_GAP was never checked`).toBe(true)
})

/** The student opens /invite#<token>: the page keeps the token and takes it out of the address bar. */
function openInvite() {
  location.hash = `#${TOKEN}`
  expect(pendingInvite.take()).toBe(TOKEN)
  pendingInvite.stripHash()
  // Setup sanity: kept in both places, not only in the fragment.
  expect(location.hash).toBe('')
  expect(storage.get(KEY)).toBe(TOKEN)
  expect(pendingInvite.has()).toBe(true)
}
const OTHER = { id: 's-other', displayName: 'Boshqa talaba', login: 'boshqa.talaba' }
const outcome = () => ({ has: pendingInvite.has(), stored: storage.get(KEY) ?? null })
const describeOutcome = (o: ReturnType<typeof outcome>) => `has() ${o.has}, sessionStorage ${o.stored ? 'holds the token' : 'empty'}`

describe('№5 a pending center invitation does not pass to the next account in the tab', () => {
  it('an invitation opened while signed out still waits after the student signs in (the intended flow)', async () => {
    const store = createIlmoraStore(initial)
    openInvite()
    // The page boots without a session (no flag cookie): «no account» is applied, as for every visitor.
    await store.getState().bootstrap()
    expect(store.getState().auth.status).toBe('anonymous')
    expect(pendingInvite.has()).toBe(true)
    await store.getState().loginAsDemo('STUDENT')
    expect(store.getState().auth.status).toBe('authenticated')
    expect(pendingInvite.has()).toBe(true)
  })

  it('an invitation opened by a student whose session has expired still waits after the student signs in again', async () => {
    ;(document as { cookie: string }).cookie = 'ilmora_session=1'
    const store = createIlmoraStore(initial)
    openInvite()
    await store.getState().bootstrap()
    // Setup sanity: the refresh was tried and refused, and the store is signed out.
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/auth/refresh'))).toBe(true)
    expect(store.getState().auth.status).toBe('anonymous')
    await store.getState().loginAsDemo('STUDENT')
    expect(store.getState().auth.status).toBe('authenticated')
    expect(pendingInvite.has()).toBe(true)
  })

  it('after logout(), another student who signs in has no pending invitation', async () => {
    const store = createIlmoraStore(initial)
    await store.getState().loginAsDemo('STUDENT')
    const first = store.getState().auth.user!.id
    openInvite()

    await store.getState().logout()
    expect(store.getState().auth.user).toBeNull()
    await store.getState().loginAsDemo('STUDENT', OTHER)
    // Setup sanity: another account is signed in now.
    expect(store.getState().auth.user?.id).toBe(OTHER.id)
    expect(OTHER.id).not.toBe(first)

    const o = outcome()
    rule('n5-logout', !o.has, `after logout and another student's sign-in no invitation is pending (now: ${describeOutcome(o)})`, o.has && o.stored === TOKEN)
  })

  it('after a forced sign-out (session gone, the reloaded page bootstraps without an account), another student has no pending invitation', async () => {
    const before = createIlmoraStore(initial)
    await before.getState().loginAsDemo('STUDENT')
    openInvite()
    // The session ends (expired or revoked) and the tab is reloaded: the access token is gone, the session flag cookie is
    // still there, and the refresh is refused — bootstrap signs the tab out with applyAuth(null).
    // A reload: fresh modules (no token in memory, no access token), only sessionStorage and the cookie carry over.
    session.set(null)
    ;(document as { cookie: string }).cookie = 'ilmora_session=1'
    vi.resetModules()
    const reloaded = (await import('./pendingInvite')).pendingInvite
    const { createIlmoraStore: createReloaded } = await import('../store/useStore')
    const store = createReloaded(initial)
    await store.getState().bootstrap()
    // Setup sanity: the refresh was tried and refused, and the store is signed out.
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).includes('/auth/refresh'))).toBe(true)
    expect(store.getState().auth.status).toBe('anonymous')

    await store.getState().loginAsDemo('STUDENT', OTHER)
    expect(store.getState().auth.user?.id).toBe(OTHER.id)

    const o = { has: reloaded.has(), stored: storage.get(KEY) ?? null }
    reloaded.clear()
    rule('n5-forced', !o.has, `after a forced sign-out and another student's sign-in no invitation is pending (now: ${describeOutcome(o)})`, o.has && o.stored === TOKEN)
  })
})
