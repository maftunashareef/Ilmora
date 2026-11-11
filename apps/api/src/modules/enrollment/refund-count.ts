import { addDays, localDate, weekdayOf, zonedTimeToUtc } from '../../common/time'

/**
 * Lessons of one course in one paid period, for a refund (offer 6.4): «the lessons the center held or had to hold by
 * the schedule, the student's absences included».
 *  - A lesson already in the calendar counts in the period; one cancelled and moved to another date counts once, at the
 *    new date. A cancelled lesson that was not moved counts in the period but is not held — its money goes back (6.5 b).
 *  - Dates the calendar does not hold yet (it is filled a few weeks ahead) are counted from the group's weekly schedule.
 *  - Held = counted lessons that started before `at` (the refusal) and were not cancelled.
 */
export interface LessonCountInput {
  periodStart: Date
  periodEnd: Date
  at: Date
  /** The group's lessons whose start falls in the period, and the moved ones pointing at them. */
  sessions: { id: string; startsAt: Date; status: string; rescheduledFromId: string | null }[]
  /** The last calendar date the group has any lesson for («YYYY-MM-DD»), or null when it has none. */
  lastCalendarDate: string | null
  weekly: { days: number[]; startTime: string; timezone: string }
}

export interface LessonCount {
  total: number
  held: number
  /** Cancelled before `at` and not moved: the center did not hold them (6.5 b). */
  notHeld: number
}

export function countLessons(i: LessonCountInput): LessonCount {
  const inPeriod = (t: Date) => t >= i.periodStart && t < i.periodEnd
  const moved = new Set(i.sessions.map((s) => s.rescheduledFromId).filter((id): id is string => !!id))
  let total = 0
  let held = 0
  let notHeld = 0
  for (const s of i.sessions) {
    if (!inPeriod(s.startsAt)) continue
    if (s.status === 'CANCELLED' && moved.has(s.id)) continue
    total++
    if (s.startsAt >= i.at) continue
    if (s.status === 'CANCELLED') notHeld++
    else held++
  }
  // The weekly schedule beyond the calendar.
  const first = localDate(i.periodStart, i.weekly.timezone)
  const last = localDate(i.periodEnd, i.weekly.timezone)
  let date = i.lastCalendarDate && i.lastCalendarDate >= first ? addDays(i.lastCalendarDate, 1) : first
  for (; date <= last; date = addDays(date, 1)) {
    if (!i.weekly.days.includes(weekdayOf(date))) continue
    const startsAt = zonedTimeToUtc(date, i.weekly.startTime, i.weekly.timezone)
    if (!inPeriod(startsAt)) continue
    total++
    if (startsAt < i.at) held++
  }
  return { total, held, notHeld }
}

/** Offer 6.4: price × (lessons not held ÷ all lessons of the period), in tiyin, rounded down. No lessons — all of it. */
export function refundShare(priceMinor: bigint, total: number, held: number): bigint {
  if (total <= 0) return priceMinor
  const left = Math.max(0, total - Math.min(held, total))
  return (priceMinor * BigInt(left)) / BigInt(total)
}

/**
 * A payment made before PaymentLine existed has no per-course amounts: it is split in proportion to the courses' prices,
 * the rounding remainder going to the last course, so the parts add up to the payment (Timur's note on the migration).
 */
export function splitByPrice(amountMinor: bigint, prices: bigint[]): bigint[] {
  const sum = prices.reduce((a, b) => a + b, 0n)
  if (!prices.length) return []
  const parts = prices.map((p) => (sum === 0n ? 0n : (amountMinor * p) / sum))
  if (sum === 0n) parts[parts.length - 1] = amountMinor
  else parts[parts.length - 1] += amountMinor - parts.reduce((a, b) => a + b, 0n)
  return parts
}
