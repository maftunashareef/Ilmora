/**
 * Time helpers. Storage is always UTC; lesson schedules are expressed in a group's IANA timezone
 * (Asia/Tashkent, UTC+5, no DST). These helpers avoid pulling a date library for one timezone.
 */

const dtfCache = new Map<string, Intl.DateTimeFormat>()

function dtf(timeZone: string): Intl.DateTimeFormat {
  let f = dtfCache.get(timeZone)
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    dtfCache.set(timeZone, f)
  }
  return f
}

/** Offset (minutes east of UTC) of `timeZone` at the given instant. */
export function tzOffsetMinutes(date: Date, timeZone: string): number {
  const parts = dtf(timeZone).formatToParts(date)
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0)
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return Math.round((asUtc - date.getTime()) / 60_000)
}

/** Local calendar date "YYYY-MM-DD" of an instant in a timezone. */
export function localDate(date: Date, timeZone: string): string {
  const parts = dtf(timeZone).formatToParts(date)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Local wall-clock time "HH:MM" of an instant in a timezone. */
export function localTime(date: Date, timeZone: string): string {
  const parts = dtf(timeZone).formatToParts(date)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00'
  return `${get('hour')}:${get('minute')}`
}

/** Instant for a local wall-clock time ("YYYY-MM-DD" + "HH:MM") in a timezone. */
export function zonedTimeToUtc(isoDate: string, hhmm: string, timeZone: string): Date {
  const [y, m, d] = isoDate.split('-').map(Number)
  const [hh, mm] = hhmm.split(':').map(Number)
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm, 0))
  const offset = tzOffsetMinutes(guess, timeZone)
  const result = new Date(guess.getTime() - offset * 60_000)
  // Second pass handles the rare case where the offset changes between guess and result.
  const offset2 = tzOffsetMinutes(result, timeZone)
  return offset2 === offset ? result : new Date(guess.getTime() - offset2 * 60_000)
}

/** Monday = 0 … Sunday = 6 for a local date string. */
export function weekdayOf(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number)
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return t.toISOString().slice(0, 10)
}

/** Prisma returns DATE columns as a Date at UTC midnight; convert back to "YYYY-MM-DD". */
export const dateColumnToIso = (d: Date): string => d.toISOString().slice(0, 10)
/** Convert "YYYY-MM-DD" to the UTC-midnight Date Prisma expects for a DATE column. */
export const isoToDateColumn = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`)

/**
 * Calendar months in UTC, keeping the time of day. A day the target month does not have is clamped to its last day
 * (31 Jan + 1 → 28/29 Feb, 31 Mar + 1 → 30 Apr) instead of spilling into the month after, so a monthly period never
 * ends on the 2nd or 3rd.
 */
export const addMonthsUtc = (d: Date, months: number): Date => {
  const out = new Date(d.getTime())
  out.setUTCDate(1)
  out.setUTCMonth(out.getUTCMonth() + months)
  const lastDay = new Date(Date.UTC(out.getUTCFullYear(), out.getUTCMonth() + 1, 0)).getUTCDate()
  out.setUTCDate(Math.min(d.getUTCDate(), lastDay))
  return out
}
