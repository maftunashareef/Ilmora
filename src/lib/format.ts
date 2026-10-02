import type { Lang } from '../types'

const UNIT: Record<Lang, string> = { uz: 'so‘m', ru: 'сум', en: 'so‘m' }

/** 1200000 → "1 200 000 so‘m" */
export function formatSom(n: number, lang: Lang, withUnit = true): string {
  const s = Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return withUnit ? `${s} ${UNIT[lang]}` : s
}

export function formatDuration(sec: number): string {
  const m = Math.round(sec / 60)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  return `${h} h ${m % 60 ? `${m % 60} min` : ''}`.trim()
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function formatDate(iso: string | undefined, lang: Lang): string {
  if (!iso) return '—'
  const d = new Date(iso)
  const locale = lang === 'ru' ? 'ru-RU' : lang === 'uz' ? 'uz-Latn-UZ' : 'en-GB'
  try {
    return d.toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })
  } catch {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  }
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
