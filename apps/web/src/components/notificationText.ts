import type { AppNotification, L, Lang, TKey } from '@ilmora/shared'
import { dict } from '@ilmora/shared'
import { formatDate, formatDayMonth, formatTime } from '../lib/format'

const isL = (v: unknown): v is L => !!v && typeof v === 'object' && 'uz' in (v as object) && 'ru' in (v as object) && 'en' in (v as object)
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T/

/** Text of a notification in the reader's language: `notif.<type>` with the stored params rendered (titles, dates, times). */
export function notificationText(n: Pick<AppNotification, 'type' | 'params'>, lang: Lang, t: (k: TKey, vars?: Record<string, string | number>) => string, tr: (l: L | undefined | null) => string): string {
  const key = `notif.${n.type}` as TKey
  if (!(key in dict)) return n.type
  const vars: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(n.params ?? {})) {
    if (v == null) continue
    if (isL(v)) vars[k] = tr(v)
    else if (typeof v === 'number') vars[k] = v
    else if (typeof v === 'string' && ISO_DATE.test(v)) vars[k] = formatDayMonth(v, lang)
    else if (typeof v === 'string' && ISO_INSTANT.test(v)) vars[k] = k === 'time' ? formatTime(v, lang) : formatDate(v, lang)
    else if (typeof v === 'string') vars[k] = v
  }
  return t(key, vars)
}
