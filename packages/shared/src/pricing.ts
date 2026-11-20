import { isPublicListed } from './access.js'
import type { CourseDiscount, Publishable } from './types.js'

/**
 * Course discounts. One window per course, no stacking with anything else. The same rules run on the server (which
 * charges the price) and in the web app (which only displays it), always in whole so'm so both sides agree exactly.
 */

/**
 * The calculator of ТЗ 2026-11-18, раздел 9 (решение 18.11; Шерзод, 20.11: минимум скидки — для новых курсов, даты у скидки
 * остаются). Price P set by the center, commission K set by the Super Admin (one for every center), student discount S:
 * the student pays P − S, the center gets P − (K + S), ILMORA the difference. All sums are whole so'm.
 */
export const COMMISSION_DEFAULT_PERCENT = 10
/** The range the Super Admin may set K in: at least 2% keeps ILMORA's share above the rounding loss (≤ 990 so'm) at P ≥ 50 000. */
export const COMMISSION_MIN_PERCENT = 2
export const COMMISSION_MAX_PERCENT = 50
/** The smallest discount a center may set now (any course); discounts of 1–4% set before stay as they are until they end. */
export const MIN_DISCOUNT_PERCENT = 5
/** The largest discount any course can carry: 100% minus the smallest commission. The real limit is maxDiscountPercent(K). */
export const MAX_DISCOUNT_PERCENT = 100 - COMMISSION_MIN_PERCENT
/** S may go up to 100% − K: at that point the center gets 0 and the student pays K. */
export const maxDiscountPercent = (commissionPercent: number): number => 100 - commissionPercent
/** Courses created from the calculator on (priceRule 1): the price is whole thousands from 50 000 so'm, or 0 for a free course. */
export const MIN_COURSE_PRICE_SOM = 50_000
export const COURSE_PRICE_STEP_SOM = 1_000
/** 0 — a course created before the calculator (its prices count as they always did); 1 — the rules of ТЗ 18.11, 9.2. */
export type PriceRule = 0 | 1

/** The price of a new course: 0 (free) or whole thousands from 50 000 so'm. */
export function checkCoursePrice(priceSom: number): { ok: true } | { ok: false; reason: 'step' | 'min' } {
  if (priceSom === 0) return { ok: true }
  if (!Number.isInteger(priceSom) || priceSom % COURSE_PRICE_STEP_SOM !== 0) return { ok: false, reason: 'step' }
  if (priceSom < MIN_COURSE_PRICE_SOM) return { ok: false, reason: 'min' }
  return { ok: true }
}

/** Uzbekistan has no daylight saving time, so Asia/Tashkent is a fixed UTC+5. */
const TASHKENT_OFFSET_MS = 5 * 3_600_000

/** A discount window as stored (dates) or as sent to the browser (ISO strings). */
export interface DiscountWindow {
  percent: number
  startsAt: string | Date
  /** null: no end — a new course's student discount has no time limit (Шерзод, 20.11). */
  endsAt: string | Date | null
}

const ms = (d: string | Date) => (d instanceof Date ? d.getTime() : Date.parse(d))
/** The end as a time; no end is never reached. */
const endMs = (d: string | Date | null) => (d === null ? Number.POSITIVE_INFINITY : ms(d))

/**
 * Active when 1 <= percent <= MAX (a 1–4% discount set before the 5% minimum still counts), and startsAt <= now < endsAt
 * (no end: from the start on).
 */
export function isDiscountActive(d: DiscountWindow | null | undefined, now: Date = new Date()): boolean {
  if (!d || !Number.isInteger(d.percent) || d.percent < 1 || d.percent > MAX_DISCOUNT_PERCENT) return false
  const start = ms(d.startsAt)
  const end = endMs(d.endsAt ?? null)
  if (Number.isNaN(start) || Number.isNaN(end)) return false
  const t = now.getTime()
  return start <= t && t < end
}

export type DiscountCheck = { ok: true } | { ok: false; reason: 'percent' | 'dates' | 'order' }

/** Rules for saving a discount: a whole percent from 5 to `maxPercent` (100% − K), valid dates, and an end (if any) after the start. */
export function checkDiscount(d: DiscountWindow, maxPercent: number = maxDiscountPercent(COMMISSION_DEFAULT_PERCENT)): DiscountCheck {
  if (!Number.isInteger(d.percent) || d.percent < MIN_DISCOUNT_PERCENT || d.percent > Math.min(maxPercent, MAX_DISCOUNT_PERCENT)) return { ok: false, reason: 'percent' }
  const start = ms(d.startsAt)
  const end = endMs(d.endsAt ?? null)
  if (Number.isNaN(start) || Number.isNaN(end)) return { ok: false, reason: 'dates' }
  if (end <= start) return { ok: false, reason: 'order' }
  return { ok: true }
}

/** The amount taken off, in so'm: floor(price * percent / 100). The customer never pays a fraction of a so'm. */
export const discountSom = (priceSom: number, percent: number): number => Math.floor((priceSom * percent) / 100)

/**
 * What the student pays with a discount of `percent`, in so'm. A course of the calculator (rule 1) rounds down to 1 000
 * so'm (ТЗ 9.2: 1 234 000 at 7% → 1 147 000); an older course takes off floor(price × percent / 100), as it always did.
 */
export function studentPriceSom(priceSom: number, percent: number, rule: PriceRule = 0): number {
  if (rule === 1) return Math.floor((priceSom * (100 - percent)) / 100 / COURSE_PRICE_STEP_SOM) * COURSE_PRICE_STEP_SOM
  return priceSom - discountSom(priceSom, percent)
}

/** Price in so'm after the discount if it is active at `now`, otherwise the list price. */
export function finalPriceSom(course: { price: number; discount?: DiscountWindow | CourseDiscount | null; priceRule?: PriceRule }, now: Date = new Date()): number {
  return isDiscountActive(course.discount, now) ? studentPriceSom(course.price, course.discount!.percent, course.priceRule ?? 0) : course.price
}

/** Server-side amount in tiyin; identical to finalPriceSom * 100 for prices stored in whole so'm. */
export function finalPriceMinor(priceMinor: bigint, discount: DiscountWindow | null | undefined, now: Date = new Date(), rule: PriceRule = 0): bigint {
  if (!isDiscountActive(discount, now)) return priceMinor
  if (rule === 1) return ((priceMinor * BigInt(100 - discount!.percent)) / 100n / 100_000n) * 100_000n
  const off = ((priceMinor * BigInt(discount!.percent)) / 10_000n) * 100n
  return priceMinor - off
}

/**
 * Who gets what of one course's payment (ТЗ 9.1–9.2), in tiyin: the student's price, the center's share
 * P × (100 − K − S) / 100 in whole so'm (never below 0 nor above the price paid), and ILMORA's — the rest, which carries
 * the rounding loss. A free course has no commission: everything is 0.
 */
export function priceSplitMinor(input: { priceMinor: bigint; studentMinor: bigint; discountPercent: number; commissionPercent: number }): { centerMinor: bigint; platformMinor: bigint } {
  if (input.studentMinor <= 0n) return { centerMinor: 0n, platformMinor: 0n }
  const share = BigInt(Math.max(0, 100 - input.commissionPercent - input.discountPercent))
  let centerMinor = ((input.priceMinor * share) / 100n / 100n) * 100n
  if (centerMinor > input.studentMinor) centerMinor = input.studentMinor
  return { centerMinor, platformMinor: input.studentMinor - centerMinor }
}

/** The calculator in the course form (ТЗ 9.3), in so'm: the student's price, what the center gets, what ILMORA gets. */
export function calculatorSom(priceSom: number, discountPercent: number, commissionPercent: number): { student: number; center: number; platform: number } {
  if (!priceSom) return { student: 0, center: 0, platform: 0 }
  const student = studentPriceSom(priceSom, discountPercent, 1)
  const { centerMinor, platformMinor } = priceSplitMinor({ priceMinor: BigInt(priceSom) * 100n, studentMinor: BigInt(student) * 100n, discountPercent, commissionPercent })
  return { student, center: Number(centerMinor / 100n), platform: Number(platformMinor / 100n) }
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
  d ? { percent: String(d.percent), starts: isoToTashkentLocal(d.startsAt), ends: d.endsAt ? isoToTashkentLocal(d.endsAt) : '' } : emptyDiscountDraft()

const LOCAL_TEXT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/
/**
 * Form text -> discount: all empty means "no discount" (null). An empty start means "from now". A course from before
 * (rule 0) needs the end; a new course (rule 1) has none — its discount has no time limit (Шерзод, 20.11), and an end typed
 * in is not ok. The result must pass checkDiscount, or it is not ok.
 */
export function discountFromDraft(draft: DiscountDraft, now: Date = new Date(), maxPercent?: number, rule: PriceRule = 0): { ok: true; discount: CourseDiscount | null } | { ok: false } {
  if (!draft.percent && !draft.starts && !draft.ends) return { ok: true, discount: null }
  if (draft.starts !== '' && !LOCAL_TEXT.test(draft.starts)) return { ok: false }
  if (rule === 1 ? draft.ends !== '' : !LOCAL_TEXT.test(draft.ends)) return { ok: false }
  const startsAt = draft.starts === '' ? now.toISOString() : tashkentLocalToIso(draft.starts)
  const discount = { percent: Number(draft.percent), startsAt, endsAt: rule === 1 ? null : tashkentLocalToIso(draft.ends) }
  return checkDiscount(discount, maxPercent).ok ? { ok: true, discount } : { ok: false }
}

/**
 * Monthly totals of a selection in so‘m: the list prices, what is paid with each course's own active discount (the same
 * rule the server charges with), and the difference. There is no package discount, so nothing else is taken off.
 */
export function priceTotals(courses: { price: number; discount?: DiscountWindow | CourseDiscount | null; priceRule?: PriceRule }[], now: Date = new Date()): { list: number; final: number; saved: number } {
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
    .sort((a, b) => endMs(a.discount!.endsAt ?? null) - endMs(b.discount!.endsAt ?? null))
    .slice(0, limit)
}

/** `datetime-local` text typed in Asia/Tashkent time -> ISO instant. */
export const tashkentLocalToIso = (local: string): string => new Date(Date.parse(`${local}:00Z`) - TASHKENT_OFFSET_MS).toISOString()

/** ISO instant -> `datetime-local` text (YYYY-MM-DDTHH:mm) in Asia/Tashkent time. */
export const isoToTashkentLocal = (iso: string): string => new Date(Date.parse(iso) + TASHKENT_OFFSET_MS).toISOString().slice(0, 16)

/**
 * Monthly price a course starts with when its author may not set prices (teachers in a workspace where the center or the
 * Super Admin keeps that right). The course form shows the same figure, locked; the API stores it whatever the form sends.
 */
export const DEFAULT_COURSE_PRICE_SOM = 500_000
