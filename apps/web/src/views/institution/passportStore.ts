'use client'
import { useEffect, useSyncExternalStore } from 'react'
import type { InstitutionPassportDto } from '@ilmora/shared'
import { institutionApi } from '../../services/institutionCabinet'
import { useStore } from '../../store/useStore'

// ── The passport, shared by the workspace's pages: loaded once per account, replaced after every save ──
type PassportState = { passport: InstitutionPassportDto | null; error: unknown; loading: boolean; userId: string | null }
let state: PassportState = { passport: null, error: null, loading: false, userId: null }
const listeners = new Set<() => void>()
const emit = (next: Partial<PassportState>) => { state = { ...state, ...next }; listeners.forEach((l) => l()) }

export function reloadPassport() {
  const userId = state.userId
  emit({ loading: true })
  institutionApi.me().then(
    (passport) => { if (state.userId === userId) emit({ passport, error: null, loading: false }) },
    (error) => { if (state.userId === userId) emit({ error, loading: false }) },
  )
}
export const setPassport = (passport: InstitutionPassportDto) => emit({ passport, error: null })

/** The representative's passport; another account signing in on this browser never sees the previous one's. */
export function usePassport(): PassportState {
  const userId = useStore((s) => s.auth.user?.id ?? null)
  const snap = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => state, () => state)
  useEffect(() => {
    if (!userId) return
    if (state.userId !== userId) { emit({ passport: null, error: null, loading: false, userId }); reloadPassport(); return }
    if (!state.passport && !state.loading && state.error == null) reloadPassport()
  }, [userId])
  return snap.userId === userId ? snap : { passport: null, error: null, loading: true, userId }
}
