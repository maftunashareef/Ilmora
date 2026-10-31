import type { L, Lang } from './types.js'
import { dict, type TKey } from './translations.js'

export { dict, LANGS } from './translations.js'
export type { TKey } from './translations.js'

export const DEFAULT_LANG: Lang = 'uz'
export const SUPPORTED_LANGS: readonly Lang[] = ['uz', 'ru', 'en'] as const

export const isLang = (value: unknown): value is Lang => value === 'uz' || value === 'ru' || value === 'en'

/** Look up a UI string; `{name}` placeholders are replaced from `vars` (every occurrence). */
export function translate(lang: Lang, key: TKey, vars?: Record<string, string | number>): string {
  const entry = dict[key] as L | undefined
  let s = entry ? entry[lang] || entry.en : key
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v))
  return s
}

/** Pick one language from a localized value, falling back through en → uz → ru. */
export function pick(lang: Lang, l: L | undefined | null): string {
  if (!l) return ''
  return l[lang] || l.en || l.uz || l.ru || ''
}

export const emptyL = (): L => ({ uz: '', ru: '', en: '' })
export const sameL = (s: string): L => ({ uz: s, ru: s, en: s })

/** Noun forms for counts: Uzbek says "{n} ta {noun}", Russian needs three forms, English two. */
export interface CountNoun { uz: string; ru: readonly [string, string, string]; en: readonly [string, string] }
export const NOUNS = {
  course: { uz: 'kurs', ru: ['курс', 'курса', 'курсов'], en: ['course', 'courses'] },
  video: { uz: 'video dars', ru: ['видеоурок', 'видеоурока', 'видеоуроков'], en: ['video lesson', 'video lessons'] },
  group: { uz: 'guruh', ru: ['группа', 'группы', 'групп'], en: ['group', 'groups'] },
  lesson: { uz: 'dars', ru: ['урок', 'урока', 'уроков'], en: ['lesson', 'lessons'] },
  teacher: { uz: 'öqituvçi', ru: ['преподаватель', 'преподавателя', 'преподавателей'], en: ['teacher', 'teachers'] },
  student: { uz: 'talaba', ru: ['студент', 'студента', 'студентов'], en: ['student', 'students'] },
} as const satisfies Record<string, CountNoun>
export function countLabel(lang: Lang, n: number, noun: CountNoun): string {
  if (lang === 'uz') return `${n} ta ${noun.uz}`
  if (lang === 'ru') {
    const m10 = n % 10
    const m100 = n % 100
    const form = m10 === 1 && m100 !== 11 ? 0 : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? 1 : 2
    return `${n} ${noun.ru[form]}`
  }
  return `${n} ${n === 1 ? noun.en[0] : noun.en[1]}`
}
