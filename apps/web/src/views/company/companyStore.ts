'use client'
import { useEffect, useSyncExternalStore } from 'react'
import type { CompanyProfileDto } from '@ilmora/shared'
import { companyApi } from '../../services/companyCabinet'
import { useStore } from '../../store/useStore'

// ── The profile, shared by the workspace's pages: loaded once per account, replaced after every save ──
type ProfileState = { profile: CompanyProfileDto | null; error: unknown; loading: boolean; userId: string | null }
let state: ProfileState = { profile: null, error: null, loading: false, userId: null }
const listeners = new Set<() => void>()
const emit = (next: Partial<ProfileState>) => { state = { ...state, ...next }; listeners.forEach((l) => l()) }

export function reloadCompany() {
  const userId = state.userId
  emit({ loading: true })
  companyApi.me().then(
    (profile) => { if (state.userId === userId) emit({ profile, error: null, loading: false }) },
    (error) => { if (state.userId === userId) emit({ error, loading: false }) },
  )
}
export const setCompany = (profile: CompanyProfileDto) => emit({ profile, error: null })

/** The company's profile; another account signing in on this browser never sees the previous one's. */
export function useCompany(): ProfileState {
  const userId = useStore((s) => s.auth.user?.id ?? null)
  const snap = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => state, () => state)
  useEffect(() => {
    if (!userId) return
    if (state.userId !== userId) { emit({ profile: null, error: null, loading: false, userId }); reloadCompany(); return }
    if (!state.profile && !state.loading && state.error == null) reloadCompany()
  }, [userId])
  return snap.userId === userId ? snap : { profile: null, error: null, loading: true, userId }
}
