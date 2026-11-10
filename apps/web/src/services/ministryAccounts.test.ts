import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: { path: string; method?: string; body?: unknown }[] = []
vi.mock('../lib/api', () => ({
  api: vi.fn(async (path: string, opts: { method?: string; body?: unknown } = {}) => {
    calls.push({ path, method: opts.method, body: opts.body })
    return {}
  }),
}))

const { MINISTRY_LOGIN_RE, ministryAccounts, normalizeLogin } = await import('./ministryAccounts')

describe('ministry accounts (Super Admin)', () => {
  beforeEach(() => { calls.length = 0 })

  it('creates an account with the login as the API stores it; an empty job title and email are left out', async () => {
    await ministryAccounts.create({ login: ' Vazirlik.Karimov ', name: '  Aziz   Karimov ', jobTitle: ' ', email: '' })
    expect(calls).toEqual([{ path: '/admin/ministry-accounts', method: 'POST', body: { login: 'vazirlik.karimov', name: 'Aziz Karimov' } }])
  })

  it('sends the job title and email when given', async () => {
    await ministryAccounts.create({ login: 'vazirlik', name: 'Aziz Karimov', jobTitle: 'Bosh mutaxassis', email: ' a.karimov@edu.uz ' })
    expect(calls[0].body).toEqual({ login: 'vazirlik', name: 'Aziz Karimov', jobTitle: 'Bosh mutaxassis', email: 'a.karimov@edu.uz' })
  })

  it('an edit never sends the login; an emptied job title or email is cleared', async () => {
    await ministryAccounts.update('u1', { name: 'Aziz Karimov', jobTitle: '', email: '' })
    expect(calls).toEqual([{ path: '/admin/ministry-accounts/u1', method: 'PATCH', body: { name: 'Aziz Karimov', jobTitle: null, email: null } }])
  })

  it('disable, enable, new password and unlinking the app use their own addresses', async () => {
    await ministryAccounts.setActive('u1', false)
    await ministryAccounts.setActive('u1', true)
    await ministryAccounts.resetPassword('u1')
    await ministryAccounts.resetApp('u1')
    await ministryAccounts.resetAccountPassword('u2')
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /admin/ministry-accounts/u1/disable',
      'POST /admin/ministry-accounts/u1/enable',
      'POST /admin/ministry-accounts/u1/reset-password',
      'POST /admin/accounts/u1/reset-second-factor',
      'POST /admin/accounts/u2/reset-password',
    ])
  })

  it('checks the login like the API: 3–32 Latin letters, digits, dot, underscore or dash', () => {
    for (const ok of ['vazirlik', 'min.edu-2', 'a_b']) expect(MINISTRY_LOGIN_RE.test(normalizeLogin(ok))).toBe(true)
    for (const bad of ['ab', '.vazirlik', 'vazir lik', 'вазирлик', 'x'.repeat(33)]) expect(MINISTRY_LOGIN_RE.test(normalizeLogin(bad))).toBe(false)
    expect(normalizeLogin(' VAZIRLIK ')).toBe('vazirlik')
  })
})
