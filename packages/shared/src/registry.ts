import { REGISTRY_DISTRICT_DATA } from './districts.data.js'
import { foldForSearch } from './format.js'
import type { L } from './types.js'

/**
 * Ministry registry: the normalized search key for directions, institutions and companies, and the reference lists
 * (industries, regions) the database starts with.
 */

const CYRILLIC: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '’', ы: 'i',
  ь: '', э: 'e', ю: 'yu', я: 'ya', ў: 'o’', қ: 'q', ғ: 'g’', ҳ: 'h',
}
const CYRILLIC_VOWELS = 'аеёиоуўэюяы'

/** Uzbek (and Russian) Cyrillic → Latin. «е» is «ye» at the start of a word and after a vowel or a sign: Ер → yer. */
function cyrillicToLatin(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === 'е') {
      const prev = s[i - 1]
      out += !prev || !/\p{L}/u.test(prev) || CYRILLIC_VOWELS.includes(prev) || prev === 'ъ' || prev === 'ь' ? 'ye' : 'e'
    } else {
      out += CYRILLIC[c] ?? c
    }
  }
  return out
}

/**
 * The key two spellings of one name share; the database keeps it unique, so a name typed twice finds the existing row.
 * Lower case; Uzbek Cyrillic → Latin; then the catalog search fold (ILMORA's Ğ Ö Ş Ç and the traditional spellings
 * become one form, every apostrophe variant is dropped); any other sign becomes a space; spaces collapse.
 * «Dasturlash» = «Дастурлаш», «Oʻqituvchi» = «O’qituvchi» = «O'qituvchi» = «Öqituvçi» = «Ўқитувчи», « IT » = «it».
 * Synonyms in different languages («Программирование» and «Dasturlash») stay apart: a moderator merges those.
 */
export function registrySearchKey(name: string): string {
  return foldForSearch(cyrillicToLatin(name.normalize('NFC').toLowerCase()))
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * Text for «contains» search over an institution: the normalized official name, Russian name and former name, each
 * once. Searching it finds a technikum by any of the names people know it by (the old name is still in use).
 */
export function registrySearchText(...names: (string | null | undefined)[]): string {
  return [...new Set(names.filter((n): n is string => !!n?.trim()).map(registrySearchKey).filter(Boolean))].join(' ')
}

/** Taxpayer number (СТИР / ИНН): exactly 9 digits. */
export const isStir = (s: string) => /^\d{9}$/.test(s)

export type RegistryIndustry = { slug: string; name: L }

/** The industries (отрасли) the registry starts with; the Super Admin edits them later. Order = display order. */
export const REGISTRY_INDUSTRIES: RegistryIndustry[] = [
  { slug: 'it', name: { uz: 'IT va aloqa', ru: 'IT и связь', en: 'IT and communications' } },
  { slug: 'construction', name: { uz: 'Quriliş va arxitektura', ru: 'Строительство и архитектура', en: 'Construction and architecture' } },
  { slug: 'furniture', name: { uz: 'Mebel va yoğoçsozlik', ru: 'Мебель и деревообработка', en: 'Furniture and woodworking' } },
  { slug: 'business', name: { uz: 'Biznes, iqtisodiyot va moliya', ru: 'Бизнес, экономика и финансы', en: 'Business, economics and finance' } },
  { slug: 'agriculture-food', name: { uz: 'Qişloq xöjaligi va oziq-ovqat sanoati', ru: 'Сельское хозяйство и пищевая промышленность', en: 'Agriculture and food industry' } },
  { slug: 'medicine', name: { uz: 'Tibbiyot va farmatsevtika', ru: 'Медицина и фармацевтика', en: 'Medicine and pharmacy' } },
  { slug: 'education', name: { uz: 'Ta’lim va pedagogika', ru: 'Образование и педагогика', en: 'Education and pedagogy' } },
  { slug: 'transport', name: { uz: 'Transport va logistika', ru: 'Транспорт и логистика', en: 'Transport and logistics' } },
  { slug: 'energy', name: { uz: 'Energetika, neft va gaz', ru: 'Энергетика, нефть и газ', en: 'Energy, oil and gas' } },
  { slug: 'machinery', name: { uz: 'Maşinasozlik va metallga işlov beriş', ru: 'Машиностроение и металлообработка', en: 'Mechanical engineering and metalworking' } },
  { slug: 'textile', name: { uz: 'Töqimaçilik va yengil sanoat', ru: 'Текстиль и лёгкая промышленность', en: 'Textiles and light industry' } },
  { slug: 'chemistry-mining', name: { uz: 'Kimyo va toğ-kon sanoati', ru: 'Химия и горное дело', en: 'Chemistry and mining' } },
  { slug: 'tourism', name: { uz: 'Turizm, mehmonxona xöjaligi va umumiy ovqatlaniş', ru: 'Туризм, гостиничное дело и общепит', en: 'Tourism, hospitality and catering' } },
  { slug: 'services', name: { uz: 'Xizmat körsatiş va maişiy xizmatlar', ru: 'Сервис и бытовые услуги', en: 'Services and consumer services' } },
  { slug: 'design-media', name: { uz: 'Dizayn, san’at va media', ru: 'Дизайн, искусство и медиа', en: 'Design, arts and media' } },
  { slug: 'law-government', name: { uz: 'Huquq va davlat boşqaruvi', ru: 'Право и госуправление', en: 'Law and public administration' } },
  { slug: 'other', name: { uz: 'Boşqa', ru: 'Другое', en: 'Other' } },
]

/** `slug` is the region id the web app uses (UZ_REGIONS in organization.ts). */
export type RegistryRegion = { code: string; slug: string; name: L }

/**
 * The 14 regions with their SOATO codes, checked against the open data of the Statistics Agency (SIAT, the same files
 * as the districts). Districts are loaded only from an official list, never typed in by hand.
 */
export const REGISTRY_REGIONS: RegistryRegion[] = [
  { code: '1735', slug: 'karakalpakstan', name: { uz: 'Qoraqalpoğiston Respublikasi', ru: 'Республика Каракалпакстан', en: 'Republic of Karakalpakstan' } },
  { code: '1703', slug: 'andijan', name: { uz: 'Andijon viloyati', ru: 'Андижанская область', en: 'Andijan Region' } },
  { code: '1706', slug: 'bukhara', name: { uz: 'Buxoro viloyati', ru: 'Бухарская область', en: 'Bukhara Region' } },
  { code: '1708', slug: 'jizzakh', name: { uz: 'Jizzax viloyati', ru: 'Джизакская область', en: 'Jizzakh Region' } },
  { code: '1710', slug: 'kashkadarya', name: { uz: 'Qaşqadaryo viloyati', ru: 'Кашкадарьинская область', en: 'Kashkadarya Region' } },
  { code: '1712', slug: 'navoi', name: { uz: 'Navoiy viloyati', ru: 'Навоийская область', en: 'Navoi Region' } },
  { code: '1714', slug: 'namangan', name: { uz: 'Namangan viloyati', ru: 'Наманганская область', en: 'Namangan Region' } },
  { code: '1718', slug: 'samarkand', name: { uz: 'Samarqand viloyati', ru: 'Самаркандская область', en: 'Samarkand Region' } },
  { code: '1722', slug: 'surkhandarya', name: { uz: 'Surxondaryo viloyati', ru: 'Сурхандарьинская область', en: 'Surkhandarya Region' } },
  { code: '1724', slug: 'syrdarya', name: { uz: 'Sirdaryo viloyati', ru: 'Сырдарьинская область', en: 'Syrdarya Region' } },
  { code: '1727', slug: 'tashkent', name: { uz: 'Toşkent viloyati', ru: 'Ташкентская область', en: 'Tashkent Region' } },
  { code: '1730', slug: 'fergana', name: { uz: 'Farğona viloyati', ru: 'Ферганская область', en: 'Fergana Region' } },
  { code: '1733', slug: 'khorezm', name: { uz: 'Xorazm viloyati', ru: 'Хорезмская область', en: 'Khorezm Region' } },
  { code: '1726', slug: 'tashkent-city', name: { uz: 'Toşkent şahri', ru: 'город Ташкент', en: 'Tashkent City' } },
]

/** A district (tuman) or a city of district status. `code`: 7-digit SOATO; `region`: the region's 4-digit SOATO code. */
export type RegistryDistrict = { code: string; region: string; name: L }

/** The 206 districts and cities of district status with their SOATO codes; source and date are in districts.data.ts. */
export const REGISTRY_DISTRICTS: readonly RegistryDistrict[] = REGISTRY_DISTRICT_DATA

/**
 * The official districts of a region (the web app's region slug), named in the reader's language and sorted by name —
 * cities of district status included as their own entries. Empty for an unknown slug.
 */
export function registryDistrictNames(regionSlug: string, lang: 'uz' | 'ru' | 'en'): string[] {
  const code = REGISTRY_REGIONS.find((r) => r.slug === regionSlug)?.code
  if (!code) return []
  return REGISTRY_DISTRICTS.filter((d) => d.region === code).map((d) => d.name[lang]).sort((a, b) => a.localeCompare(b, lang))
}

const CITY_WORDS = new Set(['shahri', 'shahar', 'shaxri', 'city', 'gorod'])
const DISTRICT_WORDS = new Set(['tumani', 'tuman', 'district', 'rayon', 'r', 'n'])
/** x/h, q/k and a final d/t are written either way in Latin district names (Shahrixon, Marhamat, Samarqand). */
const loose = (s: string) => s.replace(/x/g, 'h').replace(/q/g, 'k').replace(/d$/, 't')

interface DistrictKey {
  /** «… shahri» / «город …» / «… city», «… tumani» / «… район» / «… district», or not said. */
  kind: 'city' | 'district' | null
  /** The name without the kind word, spaces and signs: «Mirzo Ulugʻbek tumani» → «mirzoulugbek». */
  base: string
  loose: string
  /** Consonants only: catches a vowel written differently (Toyloq / Tayloq, Kukdala / Koʻkdala). */
  consonants: string
  words: string[]
}

function districtKey(name: string): DistrictKey {
  let kind: DistrictKey['kind'] = null
  const words: string[] = []
  for (const w of registrySearchKey(name).replace(/shahri\b/g, ' shahri').split(' ')) {
    if (!w) continue
    if (CITY_WORDS.has(w)) kind = 'city'
    else if (DISTRICT_WORDS.has(w)) kind = 'district'
    else words.push(w)
  }
  const base = words.join('')
  return { kind, base, loose: loose(base), consonants: loose(base).replace(/[aeiou]/g, ''), words }
}

/**
 * The district a name written in a list or by a person refers to, among the districts of its region (`candidates`),
 * or null when it is not certain. Compared by any of the district's names (uz, ru, en), with the kind words dropped
 * (a city is never matched to a district of the same name, and the reverse). Tried in order, the first test that
 * finds exactly one district wins and a test that finds several gives null:
 * the same name; x/h, q/k, final d/t written differently; an initial for the first word («Sh.Rashidov» = «Sharof
 * Rashidov», «M.Ulugbek», «Q-bozor» = «Qorovulbozor»); a vowel written differently (names of 5+ letters).
 */
export function matchDistrict<T extends { name: L }>(name: string, candidates: readonly T[]): T | null {
  const p = districtKey(name)
  if (!p.base) return null
  const keyed = candidates.map((c) => ({ c, keys: [...new Set([c.name.uz, c.name.ru, c.name.en])].filter(Boolean).map(districtKey) }))
  const initial = p.words.length > 1 && p.words[0].length <= 2 ? p.words[0] : null
  const last = loose(p.words[p.words.length - 1])
  const tests: ((k: DistrictKey) => boolean)[] = [
    (k) => k.base === p.base,
    (k) => k.loose === p.loose,
    (k) => !!initial && k.base.startsWith(initial) && k.loose.endsWith(last) && k.loose.length > last.length,
    (k) => p.base.length >= 5 && k.consonants === p.consonants,
  ]
  for (const test of tests) {
    const hits = keyed.filter(({ keys }) => keys.some((k) => (!p.kind || !k.kind || k.kind === p.kind) && test(k)))
    if (hits.length === 1) return hits[0].c
    if (hits.length > 1) return null
  }
  return null
}

// ───────────── Registry API: rules and response contract (ТЗ 3, 9.2, 9.4) ─────────────

/** Institution types — the same values as the database enum `InstitutionType` (the API checks they match). */
export type RegistryInstitutionType = 'TECHNIKUM' | 'COLLEGE' | 'LYCEUM' | 'SCHOOL' | 'UNIVERSITY' | 'TRAINING_CENTER'
export type RegistryOwnership = 'STATE' | 'PRIVATE'

/** Institution types a student may pick (ТЗ 3.3): «уже учусь» and «хочу поступить». */
export const STUDENT_INSTITUTION_TYPES = {
  studying: ['TECHNIKUM', 'UNIVERSITY', 'SCHOOL'],
  applying: ['TECHNIKUM', 'LYCEUM', 'UNIVERSITY'],
} as const satisfies Record<string, readonly RegistryInstitutionType[]>

/** Types a student may add to the registry when the institution is missing (both lists above). */
export const STUDENT_ADDABLE_TYPES: readonly RegistryInstitutionType[] = [...new Set<RegistryInstitutionType>([...STUDENT_INSTITUTION_TYPES.studying, ...STUDENT_INSTITUTION_TYPES.applying])]

/** Suggestions start after 2 characters (ТЗ 3.2) and show at most 20 rows. */
export const SUGGEST_MIN_CHARS = 2
export const SUGGEST_LIMIT = 20
export const DIRECTION_NAME_MAX = 100
export const INSTITUTION_NAME_MAX = 200
/** Free text shown to other users must not carry markup (ТЗ 9.4, XSS). */
export const hasMarkup = (s: string): boolean => /[<>]/.test(s)

export interface IndustryDto {
  id: string
  slug: string
  name: L
}

export interface RegionDto {
  id: string
  /** SOATO code. */
  code: string
  /** The region id the web app uses (UZ_REGIONS). Every `regionId` the API takes may be this slug or the database id. */
  slug: string | null
  name: L
}

export interface DistrictDto {
  id: string
  regionId: string
  /** SOATO code. */
  code: string
  name: L
}

/** A region or district as a record refers to it. */
export interface PlaceRefDto {
  id: string
  name: L
}

/** One suggestion of the direction field: the chip shows the name and its industry. A merged alias answers its main direction. */
export interface DirectionDto {
  id: string
  name: string
  industry: IndustryDto
  /** From the ministry's classifier — otherwise added by a user or the Super Admin. */
  official: boolean
  code: string | null
}

/** Answer to «Добавить „…“»: the direction and whether it was created or an existing one with the same key. */
export interface DirectionAddResult {
  direction: DirectionDto
  created: boolean
}

/** An institution as the public search shows it (ТЗ 9.4): name, type, region — no STIR, director or phone. */
export interface InstitutionSearchItemDto {
  id: string
  name: string
  /** Russian name from the official list, when there is one. */
  nameRu: string | null
  type: RegistryInstitutionType
  ownership: RegistryOwnership | null
  region: (PlaceRefDto & { slug: string | null }) | null
  district: PlaceRefDto | null
  /** District as written in the official list, until the districts' SOATO codes are loaded. */
  districtName: string | null
  /** Added by a student — shown with a mark, outside the ministry's official figures. */
  addedByStudent: boolean
}

export interface InstitutionAddResult {
  institution: InstitutionSearchItemDto
  created: boolean
}

// ───────────── Institution profile («паспорт учреждения», ТЗ 4.2) ─────────────

/** UNCLAIMED → DRAFT → PENDING → APPROVED / REJECTED (docs/registry/data-model.md). */
export type RegistryInstitutionStatus = 'UNCLAIMED' | 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED'

/** After approval, changing one of these sends the profile back to the ministry (the workspace keeps working). */
export const INSTITUTION_REVIEW_FIELDS = ['name', 'stir', 'type', 'ownership', 'regionId'] as const

/** What must be filled in before «Отправить на проверку»; the API answers the missing ones in `details.missing`. */
export const INSTITUTION_REQUIRED_FIELDS = [
  'type', 'ownership', 'name', 'stir', 'regionId', 'districtId', 'address', 'phone', 'directorName', 'directions', 'representativeName', 'representativeJobTitle',
] as const
export type InstitutionRequiredField = (typeof INSTITUTION_REQUIRED_FIELDS)[number]

export const STUDENTS_PER_DIRECTION_MAX = 100_000
export const INSTITUTION_DIRECTIONS_MAX = 200

export interface InstitutionDirectionDto {
  id: string
  direction: DirectionDto
  department: string | null
  studentsCount: number
}

/** The institution's own profile, as its representative sees it. */
export interface InstitutionPassportDto {
  id: string
  type: RegistryInstitutionType
  ownership: RegistryOwnership | null
  name: string
  /** From the official list (read-only): the Russian name and the name before the 2025 renaming. */
  nameRu: string | null
  formerName: string | null
  stir: string | null
  region: (PlaceRefDto & { slug: string | null }) | null
  district: PlaceRefDto | null
  /** District as written in the official list, until the districts' SOATO codes are loaded. */
  districtName: string | null
  address: string | null
  phone: string | null
  email: string | null
  website: string | null
  directorName: string | null
  status: RegistryInstitutionStatus
  rejectReason: string | null
  submittedAt: string | null
  approvedAt: string | null
  /** Approved once: students, announcements and requests are open (ТЗ 4.2 step 6). */
  workspaceOpen: boolean
  /** False only while the first review is pending: the ministry is looking at exactly this version. */
  editable: boolean
  directions: InstitutionDirectionDto[]
  /** «Всего студентов» and «Всего направлений» are computed, not typed in. */
  totals: { students: number; directions: number }
  representative: { name: string; jobTitle: string | null }
  /**
   * A change of the reviewed fields after approval, waiting for the Super Admin (security review №13): the fields above
   * keep the approved values meanwhile. Null — nothing waiting.
   */
  pendingChanges: InstitutionPendingChanges | null
  /** Blocked by the Super Admin: the workspace is closed. */
  blocked: { at: string; reason: string | null } | null
}

/** The reviewed fields an approved institution changed, as they wait for the Super Admin. */
export interface InstitutionPendingChanges {
  name?: string
  stir?: string
  type?: RegistryInstitutionType
  ownership?: RegistryOwnership
  regionId?: string
  districtId?: string | null
}

/** The reviewed fields an approved company changed (industries included — security review №46). */
export interface CompanyPendingChanges {
  name?: string
  stir?: string
  industryIds?: string[]
}

export interface InstitutionClaimResult {
  institution: InstitutionPassportDto
  /** True when the STIR was not in the registry and a new record was started. */
  created: boolean
}

// ───────────── Review of institution profiles (Super Admin, decision of 10.11) ─────────────

/** One profile in the review queue. */
export interface InstitutionReviewItemDto {
  id: string
  name: string
  type: RegistryInstitutionType
  stir: string | null
  region: (PlaceRefDto & { slug: string | null }) | null
  district: PlaceRefDto | null
  districtName: string | null
  submittedAt: string | null
  /** Approved before and sent back by a change of key fields (the workspace stays open). */
  reReview: boolean
  /** The STIR came from the official registry (import) — otherwise the institution started the record itself. */
  inRegistry: boolean
  /** The name in the ministry's list, to set against the name the representative entered (null — not from the list). */
  officialName: string | null
  /** A change of an approved institution waiting for a decision: the new values (the record keeps the approved ones). */
  pendingChanges: InstitutionPendingChanges | null
  representative: { name: string; jobTitle: string | null; login: string | null } | null
}

/** What the reviewer sees for one profile: the passport, where it came from, and the history of decisions. */
export interface InstitutionReviewDto {
  passport: InstitutionPassportDto
  inRegistry: boolean
  officialName: string | null
  representative: { name: string; jobTitle: string | null; login: string | null } | null
  history: { action: string; reason: string | null; at: string; by: string | null }[]
}

// ───────────── Second factor: authenticator app (ministry and Super Admins) ─────────────

/** `/auth/login` answers this instead of a session when the account needs the authenticator code. */
export interface MfaChallengeDto {
  mfaRequired: true
  /** `setup`: first sign-in — link the app (`/auth/mfa/setup`, then `/auth/mfa/confirm`); `verify`: enter its code (`/auth/mfa/verify`). */
  stage: 'setup' | 'verify'
  /** Pass for the next step; valid for `expiresInSeconds`. */
  challenge: string
  expiresInSeconds: number
}

/** The secret to link the app: show `otpauthUrl` as a QR code and `secret` for typing in by hand. */
export interface MfaSetupDto {
  secret: string
  otpauthUrl: string
}

// ───────────── Ministry accounts (created by the Super Admin) ─────────────

export interface MinistryAccountDto {
  id: string
  login: string
  name: string
  jobTitle: string | null
  email: string | null
  active: boolean
  /** The authenticator app is linked (the first sign-in links it). */
  appLinked: boolean
  lastLoginAt: string | null
  createdAt: string
}

/** Answer to creating an account or resetting its password: the temporary password is shown this once. */
export interface MinistryAccountCreatedDto {
  account: MinistryAccountDto
  temporaryPassword: string
}

// ───────────── Company profile (ТЗ 4.3) ─────────────

export type RegistryCompanyStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED'

/** After approval, changing one of these (or the certificate) sends the profile back to review; the workspace keeps working. */
export const COMPANY_REVIEW_FIELDS = ['name', 'stir'] as const

/**
 * A claimed institution or a registered company that its representative never sent for review (or that was rejected
 * and never approved) is held this many days; after that another representative of the same STIR takes it over
 * (security review 10.11 №17: STIRs are public).
 */
export const REGISTRY_DRAFT_HOLD_DAYS = 14

/** What must be filled in before «Отправить на проверку»; the API answers the missing ones in `details.missing`. */
export const COMPANY_REQUIRED_FIELDS = ['stir', 'name', 'regionId', 'address', 'industries', 'certificate', 'representativeName', 'representativeJobTitle'] as const
export type CompanyRequiredField = (typeof COMPANY_REQUIRED_FIELDS)[number]

export const COMPANY_DIRECTIONS_MAX = 50
/** Certificate: PDF, JPEG or PNG up to 10 MB (ТЗ 4.3); the type is checked by the file's first bytes. */
export const DOCUMENT_CONTENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const
export const DOCUMENT_MAX_BYTES = 10 * 1024 * 1024

/** The company's own profile, as its representative sees it. */
export interface CompanyProfileDto {
  id: string
  stir: string
  name: string
  region: (PlaceRefDto & { slug: string | null }) | null
  district: PlaceRefDto | null
  address: string | null
  website: string | null
  about: string | null
  industries: IndustryDto[]
  /** Optional: directions that refine the industries. */
  directions: DirectionDto[]
  /** The state-registration certificate is uploaded (the file itself only through a 5-minute link). */
  certificateUploaded: boolean
  status: RegistryCompanyStatus
  rejectReason: string | null
  submittedAt: string | null
  approvedAt: string | null
  /** Approved once: graduates, training requests, students and vacancies are open (ТЗ 4.3). */
  workspaceOpen: boolean
  /** False only while the first review is pending. */
  editable: boolean
  representative: { name: string; jobTitle: string | null; email: string | null }
  /** A change of the name, STIR or industries after approval, waiting for the Super Admin; the fields above stay approved. */
  pendingChanges: CompanyPendingChanges | null
  blocked: { at: string; reason: string | null } | null
}

/** Answer to «Загрузить свидетельство»: PUT the file to `uploadUrl` with this content type, then confirm `key`. */
export interface DocumentUploadDto {
  uploadUrl: string
  key: string
  expiresInSeconds: number
}

/** A 5-minute link to a private document. */
export interface DocumentLinkDto {
  url: string
  expiresInSeconds: number
}

/** One company in the Super Admin's review queue. */
export interface CompanyReviewItemDto {
  id: string
  name: string
  stir: string
  region: (PlaceRefDto & { slug: string | null }) | null
  industries: IndustryDto[]
  submittedAt: string | null
  reReview: boolean
  certificateUploaded: boolean
  /** A change of an approved company waiting for a decision (name, STIR, industries). */
  pendingChanges: CompanyPendingChanges | null
  representative: { name: string; jobTitle: string | null; login: string | null; email: string | null } | null
}

/** A record in the Super Admin's search (issue #50): the review item with its status — any status, not only the queue. */
export type AdminInstitutionItemDto = InstitutionReviewItemDto & { status: RegistryInstitutionStatus; approvedAt: string | null; blocked: boolean }
export type AdminCompanyItemDto = CompanyReviewItemDto & { status: 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED'; approvedAt: string | null; blocked: boolean }
export interface AdminPage<T> { items: T[]; total: number; page: number; pageSize: number }

export interface CompanyReviewDto {
  profile: CompanyProfileDto
  representative: { name: string; jobTitle: string | null; login: string | null; email: string | null } | null
  history: { action: string; reason: string | null; at: string; by: string | null }[]
}

// ───────────── Training requests and offers (ТЗ 5.2) ─────────────

export type TrainingRequestStatus = 'OPEN' | 'CLOSED'
export type MatchStatus = 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'WITHDRAWN'

/** How far ahead a company can ask for graduates / an institution can promise them. */
export const TRAINING_YEARS_AHEAD = 10
export const TRAINING_COUNT_MAX = 10_000

/** Contacts the other side sees only after an offer is accepted (ТЗ 5: ILMORA only brings the sides together). */
export interface PartyContactsDto {
  phone: string | null
  email: string | null
  website: string | null
  address: string | null
  representative: { name: string; jobTitle: string | null; email: string | null } | null
}

/** A company as an institution sees it on a request: no contacts until the offer is accepted. */
export interface CompanyCardDto {
  id: string
  name: string
  region: PlaceRefDto | null
  industries: IndustryDto[]
  about: string | null
}

/** An institution as a company sees it in an offer. */
export interface InstitutionCardDto {
  id: string
  name: string
  type: RegistryInstitutionType
  region: PlaceRefDto | null
}

/** One offer on a company's request. */
export interface TrainingOfferDto {
  id: string
  institution: InstitutionCardDto
  count: number
  byYear: number
  comment: string | null
  status: MatchStatus
  createdAt: string
  decidedAt: string | null
  /** Only once the company accepted the offer. */
  contacts: PartyContactsDto | null
}

/** A request as its company sees it, with the offers. */
export interface TrainingRequestDto {
  id: string
  direction: DirectionDto
  count: number
  byYear: number
  region: PlaceRefDto | null
  requirements: string | null
  status: TrainingRequestStatus
  createdAt: string
  closedAt: string | null
  offers: TrainingOfferDto[]
  /** Pending, accepted and the sum of graduates the accepted offers promise. */
  summary: { pending: number; accepted: number; promised: number }
}

/** A request as an institution sees it: the company card, and its own offer if it made one. */
export interface IncomingTrainingRequestDto {
  id: string
  direction: DirectionDto
  count: number
  byYear: number
  region: PlaceRefDto | null
  requirements: string | null
  createdAt: string
  company: CompanyCardDto
  myOffer: { id: string; count: number; byYear: number; comment: string | null; status: MatchStatus; contacts: PartyContactsDto | null } | null
}

// ───────────── Ministry: registry view and figures (ТЗ 7) ─────────────

/** Filters of the figures: region (id or slug), institution type, ownership, year (graduation, request, enrolment). */
export interface MinistryStatsFilters {
  regionId?: string
  type?: RegistryInstitutionType
  ownership?: RegistryOwnership
  year?: number
}

/** Keys of the ministry's tables; each can be downloaded as Excel (`/v1/ministry/export?table=<key>`). */
export const MINISTRY_TABLES = [
  'demand_supply', 'coverage', 'institutions_by_region', 'institutions_by_type', 'students_by_industry', 'graduates_by_year',
  'companies_by_region', 'ilmora_students', 'applicants', 'contract_help', 'vacancies', 'student_added',
] as const
export type MinistryTableKey = (typeof MINISTRY_TABLES)[number]

/**
 * One table of figures: columns with their titles in three languages, rows of values — counts, and names (industry,
 * region, type) as `{ uz, ru, en }`. No personal data ever.
 */
export interface StatsTableDto {
  key: MinistryTableKey
  title: L
  columns: { key: string; label: L; numeric: boolean }[]
  rows: Record<string, string | number | null | L>[]
}

export interface MinistryStatsDto {
  filters: MinistryStatsFilters
  generatedAt: string
  tables: StatsTableDto[]
}

/** An institution in the ministry's registry list (read-only). */
export interface MinistryInstitutionItemDto {
  id: string
  name: string
  nameRu: string | null
  type: RegistryInstitutionType
  ownership: RegistryOwnership | null
  stir: string | null
  region: PlaceRefDto | null
  districtName: string | null
  status: RegistryInstitutionStatus
  /** Where the record came from: the official list, the institution itself, a student. */
  source: 'IMPORT' | 'SELF' | 'STUDENT'
  /** Counted in the official figures: approved and not a student-added record. */
  official: boolean
  students: number
  directions: number
}

export interface MinistryCompanyItemDto {
  id: string
  name: string
  stir: string
  region: PlaceRefDto | null
  industries: IndustryDto[]
  status: RegistryCompanyStatus
}

export interface PageDto<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

// ───────────── Student questionnaire: consents and the institution's view (ТЗ 4.1, 8) ─────────────

/**
 * Keys of `StudentQuestionnaire.consents` the API stores (ТЗ 8): show my card in my institution's graduation
 * announcements; send my anonymous card to companies (help with the contract). Contacts for one company are a
 * per-request decision, not a questionnaire mark.
 */
export const STUDENT_CONSENT_KEYS = ['GRADUATE_CARD', 'CONTRACT_HELP_CARD'] as const
export type StudentConsentKey = (typeof STUDENT_CONSENT_KEYS)[number]
/** Edition of the consent texts the marks refer to; a new edition (after the lawyer's review) gets a new version. */
export const STUDENT_CONSENT_TEXT_VERSION = '2026-11-10'

export type StudyConfirmationStatus = 'PENDING' | 'CONFIRMED' | 'REJECTED'

/** A student as their institution sees them (ТЗ 9.4): name, course, direction, year — no contacts, no birth date. */
export interface InstitutionStudentDto {
  id: string
  name: string
  course: number | null
  direction: DirectionDto | null
  graduationYear: number | null
  confirmation: StudyConfirmationStatus
}

// ───────────── Student certificates and «Курсы в ILMORA» (ТЗ 5.5) ─────────────

/** At most 20 certificate files per student, each PDF / JPG / PNG up to 10 MB. */
export const STUDENT_CERTIFICATES_MAX = 20

/** A certificate the student uploaded. Its authenticity is not checked; the file is private (5-minute links). */
export interface StudentCertificateDto {
  id: string
  title: string
  issuer: string | null
  /** YYYY-MM-DD */
  issuedAt: string | null
  contentType: string
  sizeBytes: number
  createdAt: string
}

/** A course of a learning center the student had a subscription to — a record, not a certificate (ILMORA issues none). */
export interface IlmoraCourseDto {
  courseId: string
  title: L
  center: string
  group: string
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED'
  enrolledAt: string
  /** Lessons held while enrolled, attended (present) and the share in percent; null before the first lesson. */
  lessonsHeld: number
  lessonsAttended: number
  attendancePercent: number | null
}

// ───────────── Graduation announcements and contact requests (ТЗ 5.1, 5.3 «запрос контакта», 8) ─────────────

export type AnnouncementStatus = 'DRAFT' | 'PUBLISHED' | 'CLOSED'
/** STUDENTS: from the company's «Студенты» section (ТЗ «Студенты у компании», 2.4). */
export type ContactSource = 'GRADUATE' | 'CONTRACT_HELP' | 'STUDENTS'

/** A graduate as a company sees them in an announcement (ТЗ 5.1): no phone, e-mail or files until they accept a request. */
export interface GraduateCardDto {
  /**
   * The card's id for «Пригласить»: the same within one announcement for this company, different for another company or
   * announcement — not the student's account id, which would let companies match students (matrix check 11.11, №127).
   */
  cardId: string
  name: string
  institution: string
  direction: DirectionDto
  graduationYear: number
  region: PlaceRefDto | null
  about: string | null
  /** Titles only; the files open after an accepted contact request. */
  certificates: string[]
  /** «Курсы в ILMORA»: titles of the learning-center courses the student took. */
  ilmoraCourses: L[]
  /** Only students the institution confirmed are shown. */
  studyConfirmed: true
  /** This company's contact request to the student from an announcement, if any — not one from a contract-help card. */
  contactRequest: MatchStatus | null
}

/** One line of an announcement: a direction (its industry decides which companies see it) and how many graduate. */
export interface AnnouncementLineDto {
  id: string
  direction: DirectionDto
  count: number
}

/** The institution's own announcement. */
export interface AnnouncementDto {
  id: string
  year: number
  status: AnnouncementStatus
  publishedAt: string | null
  closedAt: string | null
  lines: (AnnouncementLineDto & {
    /** Students with consent whose cards companies of this industry see; excluded ones are marked, not shown to companies. */
    students: { studentId: string; name: string; course: number | null; excluded: boolean }[]
  })[]
  total: number
  responses: { pending: number; accepted: number }
}

/** A company's answer to an announcement, as the institution sees it. */
export interface AnnouncementResponseDto {
  id: string
  company: CompanyCardDto
  lines: { lineId: string; direction: DirectionDto; wantedCount: number }[]
  comment: string | null
  status: MatchStatus
  createdAt: string
  /** Only once the institution accepted. */
  contacts: PartyContactsDto | null
}

/** A published announcement as a company sees it: only the lines of its industries. */
export interface CompanyAnnouncementDto {
  id: string
  year: number
  publishedAt: string | null
  institution: InstitutionCardDto
  lines: AnnouncementLineDto[]
  /** Sum of the visible lines. */
  total: number
  /** Graduates with consent on the visible lines (the detail view only). */
  graduates?: GraduateCardDto[]
  myResponse: { id: string; status: MatchStatus; lines: { lineId: string; wantedCount: number }[]; comment: string | null; contacts: PartyContactsDto | null } | null
}

/**
 * «Мои контакты» of a company (ТЗ 4.3): accepted contact requests and applications to its vacancies — the students
 * whose contacts it has. `source` tells where the item came from: a contact request (GRADUATE, CONTRACT_HELP — `id` is
 * the request, the card opens at `…/contacts/:id`) or VACANCY (`id` is the application, the card opens at
 * `…/vacancy-applications/:id`). The list carries names only; the full card is opened one by one, each time audited.
 */
export interface CompanyContactDto {
  id: string
  source: ContactSource | 'VACANCY'
  status: MatchStatus | ApplicationStatus
  createdAt: string
  decidedAt: string | null
  /** The vacancy of an application. */
  vacancy: { id: string; title: string } | null
  student: { id: string; name: string; full: StudentFullCardDto | null }
}

/** One row of the student's consent journal (ТЗ 8): given, and when taken back; nothing is overwritten. */
export interface StudentConsentDto {
  id: string
  /** INDUSTRY_CARD: show my card to companies of my industry («Студенты», ТЗ «Студенты у компании», 4). */
  kind: 'GRADUATE_CARD' | 'CONTRACT_HELP_CARD' | 'COMPANY_CONTACTS' | 'PARENT_CONSENT' | 'INDUSTRY_CARD'
  /** COMPANY_CONTACTS: the company the contacts were opened to. */
  company: { id: string; name: string } | null
  textVersion: string
  givenAt: string
  revokedAt: string | null
  active: boolean
}

/** The full card (ТЗ 5.3, 9.4) — only for a company the student accepted: name, phone, e-mail, certificate files. */
export interface StudentFullCardDto {
  name: string
  phone: string | null
  email: string | null
  institution: string | null
  direction: DirectionDto | null
  graduationYear: number | null
  about: string | null
  certificates: StudentCertificateDto[]
}

/** A contact request as the student sees it: who asks and why. */
export interface StudentContactRequestDto {
  id: string
  source: ContactSource
  status: MatchStatus
  createdAt: string
  company: CompanyCardDto & { website: string | null }
  /** The company's contacts — once the student accepted (ТЗ 5.3 «студент видит контакты компании»). */
  contacts: PartyContactsDto | null
}

// ───────────── help with the contract fee (ТЗ 5.3) ─────────────

export type ContractHelpStatus = 'ACTIVE' | 'INTERESTED' | 'SIGNED' | 'WITHDRAWN'
/** «Где готов работать»: the student's own region or any. */
export type ContractHelpWorkRegion = 'OWN' | 'ANY'
export const CONTRACT_HELP_MOTIVATION_MAX = 1000
export const CONTRACT_HELP_YEARS_MAX = 10

/** The student's request as they see it, with the companies that showed interest. */
export interface ContractHelpDto {
  id: string
  status: ContractHelpStatus
  motivation: string
  yearsToWork: number
  /** Null — any region. */
  workRegion: PlaceRefDto | null
  createdAt: string
  signedAt: string | null
  signedWith: { id: string; name: string } | null
  withdrawnAt: string | null
  /** Contact requests that came through this request. */
  interests: { requestId: string; company: { id: string; name: string }; status: MatchStatus; createdAt: string }[]
  /** Companies the «договор заключён» mark can name: those the student opened contacts to. */
  signableCompanies: { id: string; name: string }[]
}

/**
 * The anonymised card a company sees (ТЗ 5.3): no name, birth date, phone, e-mail, files, parent or user id — only the
 * request id and a card number. Age instead of the birth date.
 */
export interface ContractHelpCardDto {
  id: string
  /** Short card number for people to refer to («№ 4F2A9C»). */
  number: string
  status: 'ACTIVE' | 'INTERESTED'
  age: number | null
  region: PlaceRefDto | null
  /** The type and region only: the name would link the card to the named graduate card (director's decision 11.11). */
  institution: { type: RegistryInstitutionType; region: PlaceRefDto | null } | null
  direction: DirectionDto | null
  mode: 'STUDYING' | 'APPLYING'
  /** Year of study (studying) or the year of admission (applying). */
  course: number | null
  enrollYear: number | null
  studyForm: 'GRANT' | 'CONTRACT' | 'UNDECIDED' | null
  /** Yearly contract, so'm. */
  contractAmount: number | null
  motivation: string
  yearsToWork: number
  workRegion: PlaceRefDto | null
  /** How many certificates and «Курсы в ILMORA» — counts, not titles: titles would link the card to the named one. */
  certificates: number
  ilmoraCourses: number
  studyConfirmed: boolean
  createdAt: string
  /** This company's contact request sent from this card, if any — not one sent from an announcement. */
  contactRequest: MatchStatus | null
}

// ───────────── practice and internships (ТЗ 5.4) ─────────────

/** JOB: «Работа» (ТЗ «Студенты у компании», 5) — always paid; stipendMinor is then the monthly salary. */
export type VacancyKind = 'PRACTICE' | 'INTERNSHIP' | 'JOB'
export type WorkFormat = 'ONSITE' | 'REMOTE' | 'HYBRID'
export type VacancyStatus = 'OPEN' | 'CLOSED'
/** новый → просмотрен → приглашён / отказ. */
export type ApplicationStatus = 'NEW' | 'VIEWED' | 'INVITED' | 'REJECTED'
export const VACANCY_SEATS_MAX = 1000
export const VACANCY_DIRECTIONS_MAX = 10

/** A vacancy as a student sees it (approved companies, open, deadline not passed). */
export interface VacancyDto {
  id: string
  kind: VacancyKind
  title: string
  company: { id: string; name: string; industries: IndustryDto[] }
  directions: DirectionDto[]
  region: PlaceRefDto
  district: PlaceRefDto | null
  address: string | null
  format: WorkFormat
  paid: boolean
  /** Monthly stipend, so'm, when stated. */
  stipend: number | null
  duration: string | null
  seats: number
  requirements: string | null
  /** YYYY-MM-DD, the last day to apply; null — until closed. */
  deadline: string | null
  status: VacancyStatus
  createdAt: string
  /** The student's own application, if any. */
  myApplication: { id: string; status: ApplicationStatus } | null
}

/** The company's own vacancy with the applications by status. */
export interface CompanyVacancyDto extends Omit<VacancyDto, 'myApplication'> {
  closedAt: string | null
  applications: Record<ApplicationStatus, number>
}

/** An application as the company sees it: the student agreed by applying to show the full card (ТЗ 5.4, 9.4). */
export interface VacancyApplicationDto {
  id: string
  status: ApplicationStatus
  note: string | null
  createdAt: string
  statusChangedAt: string | null
  student: StudentFullCardDto & { id: string }
}

/** The student's application with the vacancy. */
export interface StudentApplicationDto {
  id: string
  status: ApplicationStatus
  note: string | null
  createdAt: string
  statusChangedAt: string | null
  vacancy: Omit<VacancyDto, 'myApplication'>
}

// ───────────── Super Admin: the reference data (ТЗ 9.2 «Super Admin») ─────────────

export interface AdminIndustryDto extends IndustryDto {
  sortOrder: number
  isActive: boolean
  /** Main directions of the industry (aliases not counted) and companies that chose it. */
  directions: number
  companies: number
}

/** A direction as the Super Admin manages it: where it is used, and what it was merged into. */
export interface AdminDirectionDto {
  id: string
  name: string
  industry: IndustryDto
  origin: 'OFFICIAL' | 'USER' | 'ADMIN'
  code: string | null
  createdAt: string
  mergedInto: { id: string; name: string } | null
  /** Aliases merged into this one. */
  aliases: number
  usage: { students: number; institutions: number; companies: number; announcements: number; trainingRequests: number; vacancies: number }
}

/** A record a student added (ТЗ 3.5): to be merged into the real registry record, with likely candidates. */
export interface StudentInstitutionDto {
  id: string
  name: string
  type: RegistryInstitutionType
  region: PlaceRefDto | null
  createdAt: string
  students: number
  candidates: InstitutionCardDto[]
}

/** What a merge moved. */
export interface MergeResultDto {
  fromId: string
  intoId: string
  moved: Record<string, number>
}
