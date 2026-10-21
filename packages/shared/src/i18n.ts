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
