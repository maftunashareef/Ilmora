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

export type RegistryRegion = { code: string; name: L }

/**
 * The 14 regions with their SOATO codes. Check the codes against the ministry's registry file or stat.uz before the
 * launch; districts are loaded only from an official list, never typed in by hand.
 */
export const REGISTRY_REGIONS: RegistryRegion[] = [
  { code: '1735', name: { uz: 'Qoraqalpoğiston Respublikasi', ru: 'Республика Каракалпакстан', en: 'Republic of Karakalpakstan' } },
  { code: '1703', name: { uz: 'Andijon viloyati', ru: 'Андижанская область', en: 'Andijan Region' } },
  { code: '1706', name: { uz: 'Buxoro viloyati', ru: 'Бухарская область', en: 'Bukhara Region' } },
  { code: '1708', name: { uz: 'Jizzax viloyati', ru: 'Джизакская область', en: 'Jizzakh Region' } },
  { code: '1710', name: { uz: 'Qaşqadaryo viloyati', ru: 'Кашкадарьинская область', en: 'Kashkadarya Region' } },
  { code: '1712', name: { uz: 'Navoiy viloyati', ru: 'Навоийская область', en: 'Navoi Region' } },
  { code: '1714', name: { uz: 'Namangan viloyati', ru: 'Наманганская область', en: 'Namangan Region' } },
  { code: '1718', name: { uz: 'Samarqand viloyati', ru: 'Самаркандская область', en: 'Samarkand Region' } },
  { code: '1722', name: { uz: 'Surxondaryo viloyati', ru: 'Сурхандарьинская область', en: 'Surkhandarya Region' } },
  { code: '1724', name: { uz: 'Sirdaryo viloyati', ru: 'Сырдарьинская область', en: 'Syrdarya Region' } },
  { code: '1727', name: { uz: 'Toşkent viloyati', ru: 'Ташкентская область', en: 'Tashkent Region' } },
  { code: '1730', name: { uz: 'Farğona viloyati', ru: 'Ферганская область', en: 'Fergana Region' } },
  { code: '1733', name: { uz: 'Xorazm viloyati', ru: 'Хорезмская область', en: 'Khorezm Region' } },
  { code: '1726', name: { uz: 'Toşkent şahri', ru: 'город Ташкент', en: 'Tashkent City' } },
]

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
  name: L
}

export interface DistrictDto extends RegionDto {
  regionId: string
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
  type: RegistryInstitutionType
  ownership: RegistryOwnership | null
  region: { id: string; name: L } | null
  district: { id: string; name: L } | null
  /** Added by a student — shown with a mark, outside the ministry's official figures. */
  addedByStudent: boolean
}

export interface InstitutionAddResult {
  institution: InstitutionSearchItemDto
  created: boolean
}
