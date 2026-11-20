'use client'
/**
 * The token of a center's invitation (ТЗ 2026-11-18, 4.3) while the student signs in or registers. It comes in the
 * link's fragment (#…), never in the path or the query, so no server log or Referer sees it; the page takes it out of the
 * address bar at once and keeps it here — in memory, and in this tab's sessionStorage so a sign-in on the way survives —
 * until the invitation is accepted or found not to work. Never in `next=`.
 */
const KEY = 'ilmora:center-invite'
const TOKEN = /^[A-Za-z0-9_-]{20,120}$/
let memory: string | null = null

const read = (): string | null => {
  try { return sessionStorage.getItem(KEY) } catch { return null }
}

export const pendingInvite = {
  /** Takes the token from the fragment, or returns the one already kept. `stripHash` then clears the address bar. */
  take(): string | null {
    if (typeof window === 'undefined') return null
    const fromHash = window.location.hash.slice(1)
    if (fromHash) {
      if (TOKEN.test(fromHash)) {
        memory = fromHash
        try { sessionStorage.setItem(KEY, fromHash) } catch { /* private mode: memory only */ }
      }
    }
    const kept = memory ?? read()
    return kept && TOKEN.test(kept) ? kept : null
  },
  /**
   * Takes the fragment out of the address bar and the history entry. Call it after the router has settled (Next.js
   * writes its own copy of the opening URL, fragment included, in an effect after the page's own effects).
   */
  stripHash() {
    if (typeof window === 'undefined' || !window.location.hash) return
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${window.location.search}`)
  },
  has(): boolean {
    if (typeof window === 'undefined') return false
    const kept = memory ?? read()
    return !!kept && TOKEN.test(kept)
  },
  clear() {
    memory = null
    try { sessionStorage.removeItem(KEY) } catch { /* nothing kept */ }
  },
}
