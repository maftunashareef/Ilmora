import { useCallback } from 'react'
import { dict, type TKey } from './translations'
import type { L, Lang } from '../types'
import { useStore } from '../store/useStore'

export function translate(lang: Lang, key: TKey, vars?: Record<string, string | number>): string {
  const entry = dict[key] as L | undefined
  let s = entry ? entry[lang] || entry.en : key
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, String(v))
  return s
}

export function pick(lang: Lang, l: L | undefined | null): string {
  if (!l) return ''
  return l[lang] || l.en || l.uz || l.ru || ''
}

export function useT() {
  const lang = useStore((s) => s.lang)
  const t = useCallback((key: TKey, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang])
  const tr = useCallback((l: L | undefined | null) => pick(lang, l), [lang])
  return { t, tr, lang }
}

export const emptyL = (): L => ({ uz: '', ru: '', en: '' })
export const sameL = (s: string): L => ({ uz: s, ru: s, en: s })
