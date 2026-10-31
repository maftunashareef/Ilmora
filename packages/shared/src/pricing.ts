import { isPublicListed } from './access.js'
import type { CourseDiscount, Publishable } from './types.js'

/**
 * Course discounts. One window per course, no stacking with anything else. The same rules run on the server (which
 * charges the price) and in the web app (which only displays it), always in whole so'm so both sides agree exactly.
 */

/** The largest discount a course may carry, set by the company (1% is the smallest). */
export const MAX_DISCOUNT_PERCENT = 20

/** Uzbekistan has no daylight saving time, so Asia/Tashkent is a fixed UTC+5. */
const TASHKENT_OFFSET_MS = 5 * 3_600_000

/** A discount window as stored (dates) or as sent to the browser (ISO strings). */
export interface DiscountWindow {
  percent: number
  startsAt: string | Date
  endsAt: string | Date
}

const ms = (d: string | Date) => (d instanceof Date ? d.getTime() : Date.parse(d))

/** Active when 1 <= percent <= MAX, and startsAt <= now < endsAt. Anything malformed is simply not active. */
export function isDiscountActive(d: DiscountWindow | null | undefined, now: Date = new Date()): boolean {
  if (!d || !Number.isInteger(d.percent) || d.percent < 1 || d.percent > MAX_DISCOUNT_PERCENT) return false
  const start = ms(d.startsAt)
  const end = ms(d.endsAt)
  if (Number.isNaN(start) || Number.isNaN(end)) return false
  const t = now.getTime()
  return start <= t && t < end
}

export type DiscountCheck = { ok: true } | { ok: false; reason: 'percent' | 'dates' | 'order' }

/** Rules for saving a discount: whole percent 1..MAX, valid dates, and an end after the start. */
export function checkDiscount(d: DiscountWindow): DiscountCheck {
  if (!Number.isInteger(d.percent) || d.percent < 1 || d.percent > MAX_DISCOUNT_PERCENT) return { ok: false, reason: 'percent' }
  const start = ms(d.startsAt)
  const end = ms(d.endsAt)
  if (Number.isNaN(start) || Number.isNaN(end)) return { ok: false, reason: 'dates' }
  if (end <= start) return { ok: false, reason: 'order' }
  return { ok: true }
}

/** The amount taken off, in so'm: floor(price * percent / 100). The customer never pays a fraction of a so'm. */
export const discountSom = (priceSom: number, percent: number): number => Math.floor((priceSom * percent) / 100)

/** Price in so'm after the discount if it is active at `now`, otherwise the list price. */
export function finalPriceSom(course: { price: number; discount?: DiscountWindow | CourseDiscount | null }, now: Date = new Date()): number {
  return isDiscountActive(course.discount, now) ? course.price - discountSom(course.price, course.discount!.percent) : course.price
}

/** Server-side amount in tiyin; identical to finalPriceSom * 100 for prices stored in whole so'm. */
export function finalPriceMinor(priceMinor: bigint, discount: DiscountWindow | null | undefined, now: Date = new Date()): bigint {
  if (!isDiscountActive(discount, now)) return priceMinor
  const off = ((priceMinor * BigInt(discount!.percent)) / 10_000n) * 100n
  return priceMinor - off
}

/** Percentage to show next to a discounted price, or 0 when no discount is active. */
export const activePercent = (course: { discount?: DiscountWindow | CourseDiscount | null }, now: Date = new Date()): number =>
  isDiscountActive(course.discount, now) ? course.discount!.percent : 0

/** The amount actually billed per period (tiyin string from the API) in so'm, or null when it is not known. */
export const billedSom = (amountMinor: string | undefined | null): number | null =>
  amountMinor && /^\d+$/.test(amountMinor) ? Number(BigInt(amountMinor) / 100n) : null

/** Text fields of a discount form: percent, and start/end as `datetime-local` text in Tashkent time. */
export interface DiscountDraft {
  percent: string
  starts: string
  ends: string
}
export const emptyDiscountDraft = (): DiscountDraft => ({ percent: '', starts: '', ends: '' })
export const discountToDraft = (d: CourseDiscount | null | undefined): DiscountDraft =>
  d ? { percent: String(d.percent), starts: isoToTashkentLocal(d.startsAt), ends: isoToTashkentLocal(d.endsAt) } : emptyDiscountDraft()

const LOCAL_TEXT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
/**
 * Form text -> discount: all empty means "no discount" (null). Otherwise the end is required, an empty start means
 * "from now", and the result must pass checkDiscount, or it is not ok.
 */
export function discountFromDraft(draft: DiscountDraft, now: Date = new Date()): { ok: true; discount: CourseDiscount | null } | { ok: false } {
  if (!draft.percent && !draft.starts && !draft.ends) return { ok: true, discount: null }
  if (!LOCAL_TEXT.test(draft.ends) || (draft.starts !== '' && !LOCAL_TEXT.test(draft.starts))) return { ok: false }
  const startsAt = draft.starts === '' ? now.toISOString() : tashkentLocalToIso(draft.starts)
  const discount = { percent: Number(draft.percent), startsAt, endsAt: tashkentLocalToIso(draft.ends) }
  return checkDiscount(discount).ok ? { ok: true, discount } : { ok: false }
}

/**
 * Monthly totals of a selection in so‘m: the list prices, what is paid with each course's own active discount (the same
 * rule the server charges with), and the difference. There is no package discount, so nothing else is taken off.
 */
export function priceTotals(courses: { price: number; discount?: DiscountWindow | CourseDiscount | null }[], now: Date = new Date()): { list: number; final: number; saved: number } {
  const list = courses.reduce((n, c) => n + c.price, 0)
  const final = courses.reduce((n, c) => n + finalPriceSom(c, now), 0)
  return { list, final, saved: list - final }
}

/** The homepage discount carousel never shows more than this many courses (one per offline course in the catalog). */
export const MAX_CAROUSEL_COURSES = 16

/**
 * Courses for the homepage discount carousel: published, public and with a discount active right now, the one that
 * ends soonest first, at most `max` (never more than MAX_CAROUSEL_COURSES). They stay in the main catalog as well.
 */
export function carouselCourses<T extends Pick<Publishable, 'status' | 'visibility'> & { discount?: DiscountWindow | CourseDiscount | null }>(
  courses: T[],
  now: Date = new Date(),
  max: number = MAX_CAROUSEL_COURSES,
): T[] {
  const limit = Math.max(0, Math.min(Math.floor(max), MAX_CAROUSEL_COURSES))
  return courses
    .filter((c) => isPublicListed(c) && isDiscountActive(c.discount, now))
    .sort((a, b) => ms(a.discount!.endsAt) - ms(b.discount!.endsAt))
    .slice(0, limit)
}

/** `datetime-local` text typed in Asia/Tashkent time -> ISO instant. */
export const tashkentLocalToIso = (local: string): string => new Date(Date.parse(`${local}:00Z`) - TASHKENT_OFFSET_MS).toISOString()

/** ISO instant -> `datetime-local` text (YYYY-MM-DDTHH:mm) in Asia/Tashkent time. */
export const isoToTashkentLocal = (iso: string): string => new Date(Date.parse(iso) + TASHKENT_OFFSET_MS).toISOString().slice(0, 16)
