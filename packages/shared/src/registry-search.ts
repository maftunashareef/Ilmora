import { foldForSearch } from './format.js'
import type { InstitutionType } from './institutions.js'
import type { OrgOwnership } from './organization.js'

/** What the registry search needs of an entry (institutions and technikums both have it). */
export interface Searchable {
  type?: InstitutionType
  name: string
  nameRu?: string
  formerName?: string
  region: string
  district?: string
  ownership?: OrgOwnership
}

export interface InstitutionFilter {
  type?: InstitutionType | null
  region?: string
  ownership?: OrgOwnership | null
}

/**
 * Registry entries matching every word of the query in the current, Russian or former name or the district (any spelling:
 * ö / o‘ / o', ş / sh …), narrowed by type, region and ownership.
 */
export function searchInstitutions<T extends Searchable>(
  list: readonly T[],
  query: string,
  filter: InstitutionFilter = {},
  limit = 50,
): T[] {
  const words = foldForSearch(query).split(/\s+/).filter(Boolean)
  const out: T[] = []
  for (const t of list) {
    if (filter.type && t.type && t.type !== filter.type) continue
    if (filter.region && t.region !== filter.region) continue
    if (filter.ownership && t.ownership !== filter.ownership) continue
    if (words.length) {
      const hay = foldForSearch(`${t.name} ${t.nameRu ?? ''} ${t.formerName ?? ''} ${t.district ?? ''}`)
      if (!words.every((w) => hay.includes(w))) continue
    }
    out.push(t)
    if (out.length >= limit) break
  }
  return out
}

