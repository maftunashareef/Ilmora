import { describe, expect, it } from 'vitest'
import { consumeOAuthNonce, issueOAuthNonce } from './oauthState'

const memory = () => {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }
}

describe('Google sign-in state (Ж8: no sign-in with somebody else’s code)', () => {
  it('accepts the mark this tab issued, once', () => {
    const store = memory()
    const nonce = issueOAuthNonce(store)
    expect(nonce).toMatch(/^[0-9a-f]{32}$/)
    expect(consumeOAuthNonce(nonce, store)).toBe(true)
    expect(consumeOAuthNonce(nonce, store)).toBe(false)
  })

  it('refuses a callback this tab never started, a missing mark and a wrong one', () => {
    expect(consumeOAuthNonce('0123456789abcdef0123456789abcdef', memory())).toBe(false)
    const store = memory()
    issueOAuthNonce(store)
    expect(consumeOAuthNonce(undefined, store)).toBe(false)
    issueOAuthNonce(store)
    expect(consumeOAuthNonce('0123456789abcdef0123456789abcdef', store)).toBe(false)
  })
})
