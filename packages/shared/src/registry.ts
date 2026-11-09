import { foldForSearch } from './format.js'
import type { Lang } from './types.js'

/**
 * Registry of educational institutions (ТЗ «реестр учреждений, компании, студенты», docs/tz): reference data,
 * the direction key and the API contract shared by the API and the web app.
 *
 * Enum values below are the API contract. The database enums come with the data engineer's migration; if a name
 * differs there, the API maps it — these strings stay.
 */

export type InstitutionType = 'TECHNIKUM' | 'COLLEGE' | 'LYCEUM' | 'SCHOOL' | 'UNIVERSITY' | 'CENTER'
export type Ownership = 'STATE' | 'PRIVATE'
/** Where a registry record came from: the ministry's file, the institution itself, or a student who did not find it. */
export type RegistrySource = 'IMPORT' | 'INSTITUTION' | 'STUDENT'

/** Institution types a student may pick (ТЗ 3.3): «уже учусь» and «хочу поступить». */
export const STUDENT_INSTITUTION_TYPES = {
  studying: ['TECHNIKUM', 'UNIVERSITY', 'SCHOOL'],
  applying: ['TECHNIKUM', 'LYCEUM', 'UNIVERSITY'],
} as const satisfies Record<string, readonly InstitutionType[]>

/** Any type a student may add to the registry when the institution is missing (union of both lists above). */
export const STUDENT_ADDABLE_TYPES: readonly InstitutionType[] = [...new Set<InstitutionType>([...STUDENT_INSTITUTION_TYPES.studying, ...STUDENT_INSTITUTION_TYPES.applying])]

/** Uzbek Cyrillic (and Russian) → Latin, by the Uzbek rules (ТЗ 9.1). Applied before `foldForSearch`, which drops apostrophes. */
const CYR_TO_LAT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '',
  э: 'e', ю: 'yu', я: 'ya', ў: "o'", қ: 'q', ғ: "g'", ҳ: 'h',
}

/**
 * The key two spellings of one name share, so a direction (or a student-added institution) is stored once:
 * case, extra spaces and punctuation are ignored; Cyrillic folds to Latin; ILMORA's letters (ş ç ğ ö) and the
 * traditional ones (sh ch g‘ o‘) fold together; every apostrophe variant is dropped (as in `foldForSearch`).
 *
 * «Dasturlash» = «Дастурлаш» = « DASTURLASH », «Oʻqituvchi» = «O’qituvchi» = «Öqituvçi» = «Ўқитувчи».
 * Synonyms in different languages («Программирование» / «Dasturlash») are NOT folded: a moderator merges them.
 * The database keeps one row per key (unique index), so this function must not change once rows exist.
 */
export function directionKey(raw: string): string {
  const lower = raw.normalize('NFC').toLowerCase()
  let latin = ''
  for (const ch of lower) latin += CYR_TO_LAT[ch] ?? ch
  return foldForSearch(latin)
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/** Minimum query length for suggestions (ТЗ 3.2: after 2 characters). */
export const SUGGEST_MIN_CHARS = 2
export const SUGGEST_LIMIT = 20

/** Name rules for a user-typed direction or institution: 2–100 (directions) / 2–200 (institutions) characters, no markup. */
export const DIRECTION_NAME_MAX = 100
export const INSTITUTION_NAME_MAX = 200
export const hasMarkup = (s: string): boolean => /[<>]/.test(s)

// ───────────── API contract (responses) ─────────────

export type L3 = Record<Lang, string>

export interface IndustryDto {
  id: string
  name: L3
}

export interface RegionDto {
  id: string
  soato: string
  name: Pick<L3, 'uz' | 'ru'>
}

export interface DistrictDto extends RegionDto {
  regionId: string
}

/** One suggestion in the direction field (ТЗ 3.2): the chip shows the name and its industry. */
export interface DirectionDto {
  id: string
  name: string
  industry: IndustryDto
  /** From the ministry's classifier (with a code) — otherwise added by a user. */
  official: boolean
  code: string | null
}

/** Answer to «Добавить „…“»: the direction and whether it is new or an existing one with the same key. */
export interface DirectionAddResult {
  direction: DirectionDto
  created: boolean
}

/** Institution as the public search shows it (ТЗ 9.4: name, type, region — no STIR, director or phone). */
export interface InstitutionSearchItemDto {
  id: string
  name: string
  type: InstitutionType
  ownership: Ownership | null
  region: { id: string; name: Pick<L3, 'uz' | 'ru'> }
  district: { id: string; name: Pick<L3, 'uz' | 'ru'> } | null
  /** Added by a student and not yet confirmed — shown with a mark, not counted in the ministry's figures. */
  addedByStudent: boolean
}

export interface InstitutionAddResult {
  institution: InstitutionSearchItemDto
  created: boolean
}
