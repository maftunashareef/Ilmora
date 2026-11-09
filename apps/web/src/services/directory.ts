'use client'
import { useEffect, useSyncExternalStore } from 'react'
import type { Direction, Industry } from '@ilmora/shared'
import { api } from '../lib/api'

/**
 * The shared directory of directions and industries (ТЗ 3.1, 3.2), loaded once per page and kept here so every
 * DirectionField sees a direction the moment anyone on the page adds it.
 *
 * API contract (served by the API team):
 *   GET  /v1/industries               → Industry[]
 *   GET  /v1/directions               → Direction[]
 *   POST /v1/directions {name, industryId} → Direction  (one per normalized key: an existing match is returned, not duplicated)
 */
interface DirectoryState { status: 'idle' | 'loading' | 'ready' | 'error'; directions: Direction[]; industries: Industry[] }

let state: DirectoryState = { status: 'idle', directions: [], industries: [] }
const listeners = new Set<() => void>()
const set = (patch: Partial<DirectoryState>) => { state = { ...state, ...patch }; listeners.forEach((l) => l()) }

async function load() {
  if (state.status === 'loading' || state.status === 'ready') return
  set({ status: 'loading' })
  try {
    const [directions, industries] = await Promise.all([api<Direction[]>('/directions'), api<Industry[]>('/industries')])
    set({ status: 'ready', directions, industries })
  } catch {
    set({ status: 'error' })
  }
}

/** Adds a direction to the shared directory; the server answers with the existing one when the key already exists. */
export async function addDirection(name: string, industryId: string): Promise<Direction> {
  const created = await api<Direction>('/directions', { method: 'POST', body: { name: name.trim(), industryId } })
  if (!state.directions.some((d) => d.id === created.id)) set({ directions: [...state.directions, created] })
  return created
}

export function useDirectory(): DirectoryState {
  const snap = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => state, () => state)
  useEffect(() => { void load() }, [])
  return snap
}
