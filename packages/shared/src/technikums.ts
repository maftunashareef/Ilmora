import { foldForSearch } from './format.js'
import type { OrgOwnership } from './organization.js'

/**
 * Technikums of Uzbekistan offered by the registration picker. A technikum that is not in the list can still
 * register by typing its name. Names keep their official spelling (they are not converted to the ILMORA alphabet).
 * `region` is an id from UZ_REGIONS.
 */
export interface Technikum {
  id: string
  name: string
  region: string
  ownership: OrgOwnership
  district?: string
  inn?: string
}

/** Filled from the official list of professional education institutions (source and date noted where the data is added). */
export const TECHNIKUMS: readonly Technikum[] = []

export interface TechnikumFilter {
  region?: string
  ownership?: OrgOwnership | null
}

/** Technikums matching every word of the query (any spelling: ö / o‘ / o', ş / sh …), narrowed by region and ownership. */
export function searchTechnikums(list: readonly Technikum[], query: string, filter: TechnikumFilter = {}, limit = 50): Technikum[] {
  const words = foldForSearch(query).split(/\s+/).filter(Boolean)
  const out: Technikum[] = []
  for (const t of list) {
    if (filter.region && t.region !== filter.region) continue
    if (filter.ownership && t.ownership !== filter.ownership) continue
    if (words.length) {
      const hay = foldForSearch(`${t.name} ${t.district ?? ''}`)
      if (!words.every((w) => hay.includes(w))) continue
    }
    out.push(t)
    if (out.length >= limit) break
  }
  return out
}
