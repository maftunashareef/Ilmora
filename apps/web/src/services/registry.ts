'use client'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  registrySearchKey, SUGGEST_MIN_CHARS, type DirectionAddResult, type DirectionDto, type DistrictDto, type IndustryDto, type InstitutionAddResult,
  type InstitutionSearchItemDto, type RegionDto, type RegistryInstitutionType,
} from '@ilmora/shared'
import { api } from '../lib/api'

/**
 * The API's registry reference data (ТЗ 3.1–3.5, `/v1/registry/...`). Reading needs a signed-in account; adding is
 * limited per account and day by the API (directions 20, institutions 3).
 */
const query = (params: Record<string, string | null | undefined>) =>
  new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1])).toString()

export const registryApi = {
  industries: () => api<IndustryDto[]>('/registry/industries'),
  regions: () => api<RegionDto[]>('/registry/regions'),
  /** `regionId` may be the region slug. */
  districts: (regionId: string) => api<DistrictDto[]>(`/registry/districts?${query({ regionId })}`),
  /** Suggestions for what was typed (at least SUGGEST_MIN_CHARS letters), official directions first. */
  directions: (q: string, industryId?: string) => api<DirectionDto[]>(`/registry/directions?${query({ q, industryId })}`),
  /** Adds a direction to the shared directory; an existing one with the same key comes back with `created: false`. */
  addDirection: (name: string, industryId: string) =>
    api<DirectionAddResult>('/registry/directions', { method: 'POST', body: { name: name.trim(), industryId } }),
  /** Institutions matching the typed name (at least SUGGEST_MIN_CHARS letters); `regionId` may be the region slug. */
  institutions: (q: string, filter: { type?: RegistryInstitutionType | null; regionId?: string }) =>
    api<InstitutionSearchItemDto[]>(`/registry/institutions?${query({ q, type: filter.type, regionId: filter.regionId })}`),
  /** A student adds the institution they did not find (marked "added by a student", ТЗ 3.5). */
  addInstitution: (input: { name: string; type: RegistryInstitutionType; regionId: string }) =>
    api<InstitutionAddResult>('/registry/institutions', { method: 'POST', body: { ...input, name: input.name.trim() } }),
}

// ── Industries: one list for the whole page, loaded once ──────────────────────
type Loaded<T> = { status: 'idle' | 'loading' | 'ready' | 'error'; list: T[] }
let industries: Loaded<IndustryDto> = { status: 'idle', list: [] }
const listeners = new Set<() => void>()
const setIndustries = (next: Loaded<IndustryDto>) => { industries = next; listeners.forEach((l) => l()) }

function loadIndustries() {
  if (industries.status === 'loading' || industries.status === 'ready') return
  setIndustries({ status: 'loading', list: [] })
  registryApi.industries().then((list) => setIndustries({ status: 'ready', list }), () => setIndustries({ status: 'error', list: [] }))
}

export function useIndustries(): Loaded<IndustryDto> {
  const snap = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, () => industries, () => industries)
  useEffect(() => { loadIndustries() }, [])
  return snap
}

// ── Suggestions while typing ──────────────────────────────────────────────────
const PAUSE_MS = 250

/** Whether the typed text is long enough for the API to suggest anything (the API counts the normalized letters). */
export const longEnough = (q: string) => registrySearchKey(q).length >= SUGGEST_MIN_CHARS

/**
 * Asks `fetch` once the user pauses typing and the text is long enough. `filters` is a string of whatever else the
 * request depends on (type, region…): a change asks again. An older, slower answer never replaces a newer one.
 */
export function useSuggestions<T>(text: string, fetch: (q: string) => Promise<T[]>, filters = ''): { items: T[]; status: 'idle' | 'loading' | 'ready' | 'error'; enough: boolean } {
  const enough = longEnough(text)
  const [state, setState] = useState<{ items: T[]; status: 'idle' | 'loading' | 'ready' | 'error'; for: string }>({ items: [], status: 'idle', for: '' })
  const fetchRef = useRef(fetch)
  useEffect(() => { fetchRef.current = fetch })
  const seq = useRef(0)
  const askedFor = `${text}\u0000${filters}`

  useEffect(() => {
    if (!enough) return
    const id = ++seq.current
    const timer = setTimeout(() => {
      setState((s) => ({ ...s, status: 'loading' }))
      fetchRef.current(text).then(
        (items) => { if (seq.current === id) setState({ items, status: 'ready', for: askedFor }) },
        () => { if (seq.current === id) setState({ items: [], status: 'error', for: askedFor }) },
      )
    }, PAUSE_MS)
    return () => clearTimeout(timer)
  }, [text, filters, enough, askedFor])

  if (!enough) return { items: [], status: 'idle', enough }
  // Until the answer for this text arrives, the previous suggestions stay visible but the state says "loading".
  return { items: state.items, status: state.for === askedFor ? state.status : 'loading', enough }
}
