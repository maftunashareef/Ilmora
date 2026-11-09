import type { L } from './types.js'

/**
 * Directions (fields of study and work, ТЗ 3.2). There is no official list yet, so the directory grows from what users
 * add: one component everywhere (institutions, students, company requests, vacancies) suggests existing directions and
 * lets the user add a new one inside an industry (ТЗ 3.1). One direction per normalized key (`directionKey`).
 */
export interface Industry {
  id: string
  name: L
}

export interface Direction {
  id: string
  name: string
  industryId: string
  /** USER: added by a user and marked so; OFFICIAL: from the ministry's classifier (with its code); ADMIN: by a moderator. */
  source: 'USER' | 'OFFICIAL' | 'ADMIN'
  code?: string
}

/** Uzbek (and Russian) Cyrillic to Uzbek Latin, so "Дастурлаш" and "Dasturlash" give the same key. */
const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 's', ч: 'ch', ш: 'sh', щ: 'sh', ъ: "'", ы: 'i', ь: '', э: 'e',
  ю: 'yu', я: 'ya', ў: "o'", қ: 'q', ғ: "g'", ҳ: 'h',
}
const VOWELS = new Set('аеёиоуэюяўы')

/**
 * The key two spellings of one direction share: lower case, single spaces, every apostrophe (ʻ ’ ‘ ' ` ´ ʼ) as one,
 * ILMORA letters (ö ğ ş ç) and Cyrillic in plain Uzbek Latin, punctuation as spaces. Synonyms in different languages
 * ("Программирование" / "Dasturlash") stay different: a moderator merges those.
 */
export function directionKey(input: string): string {
  const s = input.normalize('NFC').toLowerCase().replace(/[ʻʼ’‘`´']/g, "'")
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === 'е') {
      const prev = i ? s[i - 1] : ' '
      out += !/\p{L}/u.test(prev) || VOWELS.has(prev) || prev === 'ъ' || prev === 'ь' ? 'ye' : 'e'
    } else if (ch in CYR) out += CYR[ch]
    else if (ch === 'ö') out += "o'"
    else if (ch === 'ğ') out += "g'"
    else if (ch === 'ş') out += 'sh'
    else if (ch === 'ç') out += 'ch'
    else out += ch
  }
  return out
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Suggestions start after this many typed characters (ТЗ 3.2). */
export const DIRECTION_MIN_QUERY = 2

/** Directions whose key contains every word of the query; an exact key match comes first. */
export function searchDirections(list: readonly Direction[], query: string, limit = 8): Direction[] {
  const key = directionKey(query)
  if (key.length < DIRECTION_MIN_QUERY) return []
  const words = key.split(' ')
  const hits = list.filter((d) => {
    const k = directionKey(d.name)
    return words.every((w) => k.includes(w))
  })
  hits.sort((a, b) => Number(directionKey(b.name) === key) - Number(directionKey(a.name) === key) || a.name.localeCompare(b.name))
  return hits.slice(0, limit)
}

/** The existing direction that the typed name would duplicate, if any. */
export const findSameDirection = (list: readonly Direction[], name: string): Direction | undefined => {
  const key = directionKey(name)
  return key ? list.find((d) => directionKey(d.name) === key) : undefined
}
