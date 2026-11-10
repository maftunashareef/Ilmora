import type { OrgOwnership } from './organization.js'
import type { RegistryInstitutionType } from './registry.js'
import { TECHNIKUMS } from './technikums.js'
import { UNIVERSITIES } from './university-packages.js'

/**
 * Kinds of institutions in the registry (ТЗ 3.3), the same values the API uses: technikum, college (when the ministry's
 * directory has them), lyceum, school, university and educational center (TRAINING_CENTER). A student chooses only from a
 * subset (see STUDYING_TYPES, APPLYING_TYPES).
 */
export type InstitutionType = RegistryInstitutionType
export const INSTITUTION_TYPES: readonly InstitutionType[] = ['TECHNIKUM', 'COLLEGE', 'LYCEUM', 'SCHOOL', 'UNIVERSITY', 'TRAINING_CENTER']

/**
 * An institution of the registry (ТЗ 3.5). `id` is stable; `inn` (TIN) is set only where it is confirmed. `addedBy`
 * marks a record a student or the institution itself added: it is usable at once but stays out of the ministry's
 * official figures until confirmed.
 */
export interface Institution {
  id: string
  type: InstitutionType
  name: string
  nameRu?: string
  formerName?: string
  region: string
  district?: string
  ownership?: OrgOwnership
  inn?: string
  addedBy?: 'STUDENT' | 'INSTITUTION'
}

/**
 * The registry as the web app ships it: the official technikum list (the API imported the same list with these ids)
 * and the universities of the catalogue. Used where the API's registry cannot be read — on the sign-up page, before the
 * visitor has an account — and for the confirmed TIN of a listed technikum. Signed-in pages search the API instead.
 */
export const INSTITUTION_REGISTRY: readonly Institution[] = [
  ...TECHNIKUMS.map((t): Institution => ({ ...t, type: 'TECHNIKUM' })),
  ...UNIVERSITIES.filter((u) => u.kind !== 'track' && (u.country ?? 'Uzbekistan') === 'Uzbekistan' && u.city === 'Tashkent').map(
    (u): Institution => ({ id: u.id, type: 'UNIVERSITY', name: u.name, region: 'tashkent-city' }),
  ),
]

/** The registry entry with this TIN, if any (an institution typing its STIR finds its card, ТЗ 4.2 step 2). */
export const findInstitutionByInn = (list: readonly Institution[], inn: string): Institution | undefined =>
  inn ? list.find((x) => x.inn === inn) : undefined
