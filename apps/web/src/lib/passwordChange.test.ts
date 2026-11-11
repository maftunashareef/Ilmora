import { describe, expect, it } from 'vitest'
import { passwordChangeProblem } from './passwordChange'

const ok = { current: 'UNvGHQemjpsuXYwX', next: 'Yangi-parol-2026', repeat: 'Yangi-parol-2026' }

describe('changing the password: checks before the request (same rules as POST /auth/password)', () => {
  it('a filled form passes', () => {
    expect(passwordChangeProblem(ok, 'vazirlik.karimov')).toBeNull()
  })
  it('asks for the current password', () => {
    expect(passwordChangeProblem({ ...ok, current: '' }, null)).toBe('pwd.err.current')
  })
  it('the new one is 8–128 characters', () => {
    expect(passwordChangeProblem({ ...ok, next: 'short', repeat: 'short' }, null)).toBe('auth.err.password')
    expect(passwordChangeProblem({ ...ok, next: 'x'.repeat(129), repeat: 'x'.repeat(129) }, null)).toBe('auth.err.password')
  })
  it('the new one differs from the current one (same_password)', () => {
    expect(passwordChangeProblem({ ...ok, next: ok.current, repeat: ok.current }, null)).toBe('apiError.samePassword')
  })
  it('the new one is not the login, in any case (password_is_login)', () => {
    expect(passwordChangeProblem({ ...ok, next: 'Vazirlik.Karimov', repeat: 'Vazirlik.Karimov' }, 'vazirlik.karimov')).toBe('apiError.passwordIsLogin')
  })
  it('the new one is typed twice the same', () => {
    expect(passwordChangeProblem({ ...ok, repeat: 'Yangi-parol-2025' }, null)).toBe('auth.err.mismatch')
  })
})
