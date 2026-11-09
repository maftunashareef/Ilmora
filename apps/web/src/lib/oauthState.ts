/**
 * Google sign-in `state`: a one-time random mark kept in this tab (sessionStorage) and sent through Google. The callback
 * exchanges a code only when the mark it gets back is the one this tab created, so another site cannot send a visitor
 * to /auth/google/callback with its own code and sign them in to somebody else's account (login CSRF, Ж8).
 */
const KEY = 'ilmora.oauth.nonce'

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

const storage = (): Store | null => {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null
  } catch {
    return null
  }
}

/** A fresh mark, remembered in this tab until the callback uses it. */
export function issueOAuthNonce(store: Store | null = storage()): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  const nonce = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  store?.setItem(KEY, nonce)
  return nonce
}

/** True only for the mark this tab issued; the mark is spent either way, so a callback URL cannot be replayed. */
export function consumeOAuthNonce(received: unknown, store: Store | null = storage()): boolean {
  const expected = store?.getItem(KEY) ?? null
  store?.removeItem(KEY)
  return typeof received === 'string' && received.length >= 16 && expected !== null && received === expected
}
