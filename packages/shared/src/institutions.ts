import type { OrgOwnership } from './organization.js'
import { TECHNIKUMS } from './technikums.js'
import { UNIVERSITIES } from './university-packages.js'

/**
 * Kinds of institutions in the registry (ТЗ 3.3): technikum, college (when the ministry's directory has them), lyceum,
 * school, university and educational center. A student chooses only from a subset (see STUDYING_TYPES, APPLYING_TYPES).
 */
export type InstitutionType = 'TECHNIKUM' | 'COLLEGE' | 'LYCEUM' | 'SCHOOL' | 'UNIVERSITY' | 'CENTER'
export const INSTITUTION_TYPES: readonly InstitutionType[] = ['TECHNIKUM', 'COLLEGE', 'LYCEUM', 'SCHOOL', 'UNIVERSITY', 'CENTER']

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
 * The registry as the web app knows it until the API serves the imported one (admin "Импорт реестра"): the official
 * technikum list and the universities of the catalogue. Schools and lyceums are added by students ("not in the list").
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
