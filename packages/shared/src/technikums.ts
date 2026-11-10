import { foldForSearch } from './format.js'
import { searchInstitutions } from './registry-search.js'
import type { OrgOwnership } from './organization.js'
import { TECHNIKUM_DATA } from './technikums.data.js'

/**
 * Technikums of Uzbekistan offered by the registration picker. A technikum that is not in the list can still
 * register by typing its name. Names keep their official spelling (they are not converted to the ILMORA alphabet).
 * `region` is an id from UZ_REGIONS; `name` is the official (Uzbek) name, `nameRu` the Russian one from the same registry,
 * `formerName` the name before the 2025 renaming (people still search by it); `inn` is set only for a confirmed TIN.
 */
export interface Technikum {
  id: string
  name: string
  nameRu?: string
  formerName?: string
  region: string
  ownership: OrgOwnership
  district?: string
  inn?: string
}

/** The official list of professional education institutions; source and date are in technikums.data.ts. */
export const TECHNIKUMS: readonly Technikum[] = TECHNIKUM_DATA

export interface TechnikumFilter {
  region?: string
  ownership?: OrgOwnership | null
}

/** Technikums matching the query, narrowed by region and ownership (see searchInstitutions). */
export const searchTechnikums = (list: readonly Technikum[], query: string, filter: TechnikumFilter = {}, limit = 50): Technikum[] =>
  searchInstitutions(list, query, filter, limit)

/** Whether the query names the technikum only by its former name (the picker then shows that name too). */
export function matchesFormerNameOnly(t: Pick<Technikum, 'name' | 'nameRu' | 'formerName'>, query: string): boolean {
  const words = foldForSearch(query).split(/\s+/).filter(Boolean)
  if (!words.length || !t.formerName) return false
  const now = foldForSearch(`${t.name} ${t.nameRu ?? ''}`)
  const before = foldForSearch(t.formerName)
  return words.every((w) => before.includes(w)) && !words.every((w) => now.includes(w))
}
