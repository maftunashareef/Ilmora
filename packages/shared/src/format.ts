import type { Lang } from './types.js'

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

const UZ_MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentabr', 'oktabr', 'noyabr', 'dekabr']
const UZ_MONTHS_SHORT = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek']
const UZ_DAYS_SHORT = ['Yak', 'Dush', 'Sesh', 'Chor', 'Pay', 'Jum', 'Shan']

export function formatDate(iso: string | undefined, lang: Lang): string {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  // Browsers rarely ship Uzbek Latin month names, so format Uzbek dates by hand, year first: "2026-yil 20-noyabr".
  if (lang === 'uz') return `${d.getFullYear()}-yil ${d.getDate()}-${UZ_MONTHS[d.getMonth()]}`
  const locale = lang === 'ru' ? 'ru-RU' : 'en-GB'
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

const localeOf = (lang: Lang) => (lang === 'ru' ? 'ru-RU' : lang === 'uz' ? 'uz-Latn-UZ' : 'en-GB')

/** "Du, 7-okt" style short date for session lists. */
export function formatDayMonth(iso: string, lang: Lang, withWeekday = true): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  if (lang === 'uz') return `${withWeekday ? `${UZ_DAYS_SHORT[d.getDay()]}, ` : ''}${d.getDate()}-${UZ_MONTHS_SHORT[d.getMonth()]}`
  try {
    return d.toLocaleDateString(localeOf(lang), { weekday: withWeekday ? 'short' : undefined, day: 'numeric', month: 'short' })
  } catch {
    return d.toLocaleDateString('en-GB', { weekday: withWeekday ? 'short' : undefined, day: 'numeric', month: 'short' })
  }
}

export function formatTime(iso: string, lang: Lang): string {
  const d = new Date(iso)
  try {
    return d.toLocaleTimeString(localeOf(lang), { hour: '2-digit', minute: '2-digit' })
  } catch {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  }
}
