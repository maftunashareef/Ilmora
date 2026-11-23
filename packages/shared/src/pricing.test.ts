import { describe, expect, it } from 'vitest'
import {
  activePercent, billedSom, calculatorSom, carouselCourses, checkCoursePrice, COMMISSION_DEFAULT_PERCENT, COMMISSION_MIN_PERCENT, commissionPercentFor, HALF_SPLIT_MAX_DISCOUNT_PERCENT, HALF_SPLIT_MAX_TOTAL_PERCENT, HALF_SPLIT_MIN_TOTAL_PERCENT, halfSplitMinor, MAX_CAROUSEL_COURSES, maxDiscountPercent, maxDiscountPercentFor, priceSplitMinor, MIN_DISCOUNT_PERCENT, studentPriceSom, checkDiscount, DISCOUNT_TERMS, discountFromDraft, discountInForce, discountSom, discountTermEnd, discountTermOf, discountToDraft, emptyDiscountDraft, finalPriceMinor, finalPriceSom, isDiscountActive, isoToTashkentLocal, MAX_DISCOUNT_PERCENT, priceTotals, tashkentLocalToIso, tashkentNowLocal,
} from './pricing.js'

const d = (percent: number, startsAt: string, endsAt: string) => ({ percent, startsAt, endsAt })
const win = d(20, '2026-11-01T00:00:00Z', '2026-11-10T00:00:00Z')

describe('isDiscountActive', () => {
  it('is active from the start instant up to, but not including, the end instant', () => {
    expect(isDiscountActive(win, new Date('2026-10-31T23:59:59.999Z'))).toBe(false)
    expect(isDiscountActive(win, new Date('2026-11-01T00:00:00Z'))).toBe(true)
    expect(isDiscountActive(win, new Date('2026-11-09T23:59:59.999Z'))).toBe(true)
    expect(isDiscountActive(win, new Date('2026-11-10T00:00:00Z'))).toBe(false)
  })

  it('accepts Date objects (database rows) and treats missing or malformed discounts as inactive', () => {
    expect(isDiscountActive({ percent: 20, startsAt: new Date('2026-11-01T00:00:00Z'), endsAt: new Date('2026-11-10T00:00:00Z') }, new Date('2026-11-05T00:00:00Z'))).toBe(true)
    expect(isDiscountActive(null)).toBe(false)
    expect(isDiscountActive(undefined)).toBe(false)
    expect(isDiscountActive(d(0, '2026-11-01T00:00:00Z', '2026-11-10T00:00:00Z'), new Date('2026-11-05T00:00:00Z'))).toBe(false)
    expect(isDiscountActive(d(MAX_DISCOUNT_PERCENT + 1, '2026-11-01T00:00:00Z', '2026-11-10T00:00:00Z'), new Date('2026-11-05T00:00:00Z'))).toBe(false)
    expect(isDiscountActive(d(10.5, '2026-11-01T00:00:00Z', '2026-11-10T00:00:00Z'), new Date('2026-11-05T00:00:00Z'))).toBe(false)
    expect(isDiscountActive(d(10, 'nope', '2026-11-10T00:00:00Z'), new Date('2026-11-05T00:00:00Z'))).toBe(false)
  })
})

describe('checkDiscount (ТЗ 18.11, 9.1: from 5% to 100% − commission)', () => {
  it('accepts whole percents from 5 to the limit with an end after the start', () => {
    expect(checkDiscount(win)).toEqual({ ok: true })
    expect(checkDiscount(d(5, win.startsAt, win.endsAt))).toEqual({ ok: true })
    expect(checkDiscount(d(90, win.startsAt, win.endsAt))).toEqual({ ok: true })
    expect(checkDiscount(d(85, win.startsAt, win.endsAt), maxDiscountPercent(15))).toEqual({ ok: true })
  })
  it('refuses 4% and 91% (commission 10%), the limit moves with the commission; bad dates and order', () => {
    expect(MIN_DISCOUNT_PERCENT).toBe(5)
    expect(maxDiscountPercent(COMMISSION_DEFAULT_PERCENT)).toBe(90)
    for (const percent of [0, -5, 1, 4, 91, 100, 12.5]) expect(checkDiscount(d(percent, win.startsAt, win.endsAt))).toEqual({ ok: false, reason: 'percent' })
    expect(checkDiscount(d(86, win.startsAt, win.endsAt), maxDiscountPercent(15))).toEqual({ ok: false, reason: 'percent' })
    expect(checkDiscount(d(10, 'x', win.endsAt))).toEqual({ ok: false, reason: 'dates' })
    expect(checkDiscount(d(10, win.endsAt, win.startsAt))).toEqual({ ok: false, reason: 'order' })
    expect(checkDiscount(d(10, win.startsAt, win.startsAt))).toEqual({ ok: false, reason: 'order' })
  })
  it('a 1–4% discount set before the minimum still applies while it lasts', () => {
    expect(isDiscountActive(d(3, '2026-11-01T00:00:00Z', '2026-11-10T00:00:00Z'), new Date('2026-11-05T00:00:00Z'))).toBe(true)
  })
})

describe('calculator of a course from before it (rule 0): ТЗ 18.11, 9.1–9.2 with the Super Admin\'s K', () => {
  it('example 1: 1 000 000 at 5%, commission 10% → 950 000 / 850 000 / 100 000', () => {
    expect(calculatorSom(1_000_000, 5, 10, 0)).toEqual({ student: 950_000, center: 850_000, platform: 100_000 })
    expect(priceSplitMinor({ priceMinor: 100_000_000n, studentMinor: 95_000_000n, discountPercent: 5, commissionPercent: 10 })).toEqual({ centerMinor: 85_000_000n, platformMinor: 10_000_000n })
  })
  it('1 234 000 at 7%, K 10% → 1 147 620 (whole so\'m, its old rounding), the center 1 024 220, ILMORA the rest', () => {
    expect(calculatorSom(1_234_000, 7, 10, 0)).toEqual({ student: 1_147_620, center: 1_024_220, platform: 123_400 })
  })
  it('the limit 100% − K: the center gets 0; a free course has no commission', () => {
    expect(calculatorSom(1_000_000, 90, 10, 0)).toEqual({ student: 100_000, center: 0, platform: 100_000 })
    expect(calculatorSom(0, 5, 10, 0)).toEqual({ student: 0, center: 0, platform: 0 })
    expect(maxDiscountPercentFor(0, 10)).toBe(90)
    expect(maxDiscountPercentFor(0, 15)).toBe(85)
    expect(commissionPercentFor(0, 20, 10)).toBe(10)
  })
  it('ILMORA never goes below 0 for a valid price (rounding loss ≤ 990 so\'m), whatever the discount', () => {
    for (const price of [50_000, 51_000, 99_000, 1_234_000, 9_999_000]) for (let s = 5; s <= 90; s++) {
      const r = calculatorSom(price, s, COMMISSION_MIN_PERCENT, 0)
      expect(r.platform, `${price} ${s}`).toBeGreaterThanOrEqual(0)
      expect(r.student - r.center - r.platform).toBe(0)
    }
  })
})

describe('calculator of a new course (rule 1): equal halves (23.11)', () => {
  it('a total of 20% on 500 000 → the student 450 000, ILMORA 50 000, the center 400 000 (S = 10)', () => {
    expect(calculatorSom(500_000, 10, 10)).toEqual({ student: 450_000, center: 400_000, platform: 50_000 })
    expect(calculatorSom(500_000, 10, 10, 1)).toEqual({ student: 450_000, center: 400_000, platform: 50_000 })
  })
  it('the sums are whole thousands: 1 234 000 at a total of 14% → 1 147 000 / ILMORA 87 000 / the center 1 060 000', () => {
    expect(calculatorSom(1_234_000, 7, 10)).toEqual({ student: 1_147_000, center: 1_060_000, platform: 87_000 })
    expect(finalPriceMinor(123_400_000n, d(7, '2026-11-01T00:00:00Z', '2026-11-10T00:00:00Z'), new Date('2026-11-05T00:00:00Z'), 1)).toBe(114_700_000n)
    // 650 000 at a total of 10%: 32 500 saved, rounded up with the student's price (617 500 → 617 000).
    expect(calculatorSom(650_000, 5, 10)).toEqual({ student: 617_000, center: 584_000, platform: 33_000 })
  })
  it('K does not enter it: the same split at any Super Admin commission', () => {
    for (const k of [2, 10, 15, 50]) expect(calculatorSom(1_000_000, 5, k)).toEqual({ student: 950_000, center: 900_000, platform: 50_000 })
    expect(commissionPercentFor(1, 7, 10)).toBe(7)
  })
  it('a total of 100% (S = 50): the center gets 0, never less; a free course has nothing', () => {
    expect(calculatorSom(1_000_000, 50, 10)).toEqual({ student: 500_000, center: 0, platform: 500_000 })
    // 51 000 at 50%: the student pays 25 000 (rounded down), saves 26 000 — ILMORA can only get what was paid.
    expect(calculatorSom(51_000, 50, 10)).toEqual({ student: 25_000, center: 0, platform: 25_000 })
    expect(calculatorSom(0, 5, 10)).toEqual({ student: 0, center: 0, platform: 0 })
    expect(halfSplitMinor(0n, 0n)).toEqual({ centerMinor: 0n, platformMinor: 0n })
  })
  it('the limits: S from 5% to 50% (a total of 10% … 100%, even)', () => {
    expect(HALF_SPLIT_MIN_TOTAL_PERCENT).toBe(10)
    expect(HALF_SPLIT_MAX_TOTAL_PERCENT).toBe(100)
    expect(HALF_SPLIT_MAX_DISCOUNT_PERCENT).toBe(50)
    for (const k of [2, 10, 50]) expect(maxDiscountPercentFor(1, k)).toBe(50)
    expect(checkDiscount(d(50, win.startsAt, win.endsAt), maxDiscountPercentFor(1, 10))).toEqual({ ok: true })
    expect(checkDiscount(d(51, win.startsAt, win.endsAt), maxDiscountPercentFor(1, 10))).toEqual({ ok: false, reason: 'percent' })
    // An odd total is a half percent: no check accepts it.
    expect(checkDiscount(d(7.5, win.startsAt, win.endsAt), maxDiscountPercentFor(1, 10))).toEqual({ ok: false, reason: 'percent' })
  })
  it('ILMORA gets exactly what the student saves, and the three sums add up, for every price and percent', () => {
    for (const price of [50_000, 51_000, 99_000, 650_000, 1_234_000, 9_999_000]) for (let s = 5; s <= 50; s++) {
      const r = calculatorSom(price, s, 10)
      expect(r.student % 1_000, `${price} ${s}`).toBe(0)
      expect(r.student - r.center - r.platform).toBe(0)
      expect(r.center).toBeGreaterThanOrEqual(0)
      if (r.center > 0) expect(r.platform, `${price} ${s}`).toBe(price - r.student)
    }
  })
  it('after a time-limited discount the minimum holds for both halves: 5% to the student, 5% to ILMORA', () => {
    const course = { price: 1_000_000, priceRule: 1 as const, discount: { percent: 20, startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-11T00:00:00Z' } }
    const now = new Date('2026-11-12T00:00:00Z')
    const s = activePercent(course, now)
    expect(s).toBe(5)
    expect(calculatorSom(course.price, s, 10)).toEqual({ student: 950_000, center: 900_000, platform: 50_000 })
  })
})

describe('the price of a new course', () => {
  it('a course before the calculator keeps its old rounding (whole so\'m)', () => {
    expect(studentPriceSom(1_234_000, 7, 0)).toBe(1_147_620)
    expect(finalPriceSom({ price: 1_234_000, discount: { percent: 7, startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-10T00:00:00Z' } }, new Date('2026-11-05T00:00:00Z'))).toBe(1_147_620)
    expect(finalPriceSom({ price: 1_234_000, priceRule: 1, discount: { percent: 7, startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-10T00:00:00Z' } }, new Date('2026-11-05T00:00:00Z'))).toBe(1_147_000)
  })
  it('the price of a new course: whole thousands from 50 000, or 0 (free)', () => {
    expect(checkCoursePrice(0)).toEqual({ ok: true })
    expect(checkCoursePrice(50_000)).toEqual({ ok: true })
    expect(checkCoursePrice(1_234_000)).toEqual({ ok: true })
    expect(checkCoursePrice(1_234_500)).toEqual({ ok: false, reason: 'step' })
    expect(checkCoursePrice(40_000)).toEqual({ ok: false, reason: 'min' })
  })
})

describe('final price', () => {
  const now = new Date('2026-11-05T00:00:00Z')

  it('takes floor(price * percent / 100) off, in whole so\'m', () => {
    expect(discountSom(100_000, 20)).toBe(20_000)
    expect(discountSom(99_999, 10)).toBe(9_999) // 9 999.9 -> 9 999: the customer pays 1 so'm more, never a fraction
    expect(discountSom(1, 50)).toBe(0)
    expect(finalPriceSom({ price: 100_000, discount: win }, now)).toBe(80_000)
    expect(finalPriceSom({ price: 99_999, discount: d(10, win.startsAt, win.endsAt) }, now)).toBe(90_000)
  })

  it('is the list price when there is no discount or it is outside its window', () => {
    expect(finalPriceSom({ price: 100_000 }, now)).toBe(100_000)
    expect(finalPriceSom({ price: 100_000, discount: null }, now)).toBe(100_000)
    expect(finalPriceSom({ price: 100_000, discount: win }, new Date('2026-12-01T00:00:00Z'))).toBe(100_000)
    expect(activePercent({ discount: win }, now)).toBe(20)
    expect(activePercent({ discount: win }, new Date('2026-12-01T00:00:00Z'))).toBe(0)
  })

  it('agrees exactly between the server (tiyin, bigint) and the browser (so\'m) for every percent and many prices', () => {
    const prices = [1, 99, 100, 101, 999, 1_000, 12_345, 99_999, 150_000, 1_234_567, 99_999_999, 100_000_000]
    for (let percent = 1; percent <= MAX_DISCOUNT_PERCENT; percent++) {
      for (const price of prices) {
        const discount = d(percent, win.startsAt, win.endsAt)
        const server = finalPriceMinor(BigInt(price) * 100n, discount, now)
        expect(server).toBe(BigInt(finalPriceSom({ price, discount }, now)) * 100n)
        expect(server).toBeLessThanOrEqual(BigInt(price) * 100n)
        expect(server % 100n).toBe(0n)
      }
    }
    expect(finalPriceMinor(10_000_000n, win, new Date('2026-12-01T00:00:00Z'))).toBe(10_000_000n)
    expect(finalPriceMinor(10_000_000n, null, now)).toBe(10_000_000n)
  })
})

describe('billedSom', () => {
  it('turns the billed tiyin amount into so\'m and is null when unknown', () => {
    expect(billedSom('16000000')).toBe(160_000)
    expect(billedSom('0')).toBe(0)
    expect(billedSom(undefined)).toBeNull()
    expect(billedSom('')).toBeNull()
    expect(billedSom('12.5')).toBeNull()
  })
})

describe('discount form text', () => {
  const draft = (percent: string, starts: string, ends: string) => ({ percent, starts, ends })

  it('treats an empty form as "no discount" and round-trips a stored discount through Tashkent time', () => {
    expect(discountFromDraft(emptyDiscountDraft())).toEqual({ ok: true, discount: null })
    expect(discountToDraft(null)).toEqual(emptyDiscountDraft())
    const stored = { percent: 15, startsAt: '2026-11-01T05:00:00.000Z', endsAt: '2026-11-10T18:30:00.000Z' }
    expect(discountToDraft(stored)).toEqual(draft('15', '2026-11-01T10:00', '2026-11-10T23:30'))
    expect(discountFromDraft(discountToDraft(stored), new Date('2026-11-05T00:00:00Z'))).toEqual({ ok: true, discount: stored })
  })

  it('starts immediately when the start is left empty; an end, when given, comes after the start', () => {
    const now = new Date('2026-11-01T00:00:00Z')
    expect(discountFromDraft(draft('10', '', '2026-11-10T10:00'), now)).toEqual({ ok: true, discount: { percent: 10, startsAt: now.toISOString(), endsAt: '2026-11-10T05:00:00.000Z' } })
    expect(discountFromDraft(draft('10', '', '2026-10-31T10:00'), now).ok).toBe(false)
  })

  it('refuses half-filled or invalid forms: missing percent, percent outside 5–90 (5–85 at commission 15%), end not after start', () => {
    const now = new Date('2026-11-01T00:00:00Z')
    expect(discountFromDraft(draft('', '2026-11-01T10:00', '2026-11-10T10:00'), now).ok).toBe(false)
    expect(discountFromDraft(draft('0', '2026-11-01T10:00', '2026-11-10T10:00'), now).ok).toBe(false)
    expect(discountFromDraft(draft('4', '2026-11-01T10:00', '2026-11-10T10:00'), now).ok).toBe(false)
    expect(discountFromDraft(draft('91', '2026-11-01T10:00', '2026-11-10T10:00'), now).ok).toBe(false)
    expect(discountFromDraft(draft('86', '2026-11-01T10:00', '2026-11-10T10:00'), now, 85).ok).toBe(false)
    expect(discountFromDraft(draft('abc', '2026-11-01T10:00', '2026-11-10T10:00'), now).ok).toBe(false)
    expect(discountFromDraft(draft('10', '2026-11-10T10:00', '2026-11-01T10:00'), now).ok).toBe(false)
    expect(discountFromDraft(draft('10', '2026-11-01', '2026-11-10T10:00'), now).ok).toBe(false)
    expect(discountFromDraft(draft('10', '2026-11-01T10:00', '2026-11-10'), now).ok).toBe(false)
    expect(discountFromDraft(draft('20', '2026-11-01T10:00', '2026-11-10T10:00'), now).ok).toBe(true)
  })

  it('allows a start date in the future', () => {
    const far = discountFromDraft(draft('5', '2030-01-01T00:00', '2030-02-01T00:00'))
    expect(far.ok).toBe(true)
  })

  it('the term is the center’s choice (22.11): an empty end is a permanent discount, an end makes it time-limited', () => {
    const now = new Date('2026-11-20T10:00:00Z')
    // Permanent: no end, from now or from the start typed in.
    expect(discountFromDraft(draft('10', '', ''), now, 90)).toEqual({ ok: true, discount: { percent: 10, startsAt: now.toISOString(), endsAt: null } })
    expect(discountFromDraft(draft('10', '2026-11-25T10:00', ''), now, 90)).toEqual({ ok: true, discount: { percent: 10, startsAt: '2026-11-25T05:00:00.000Z', endsAt: null } })
    // Time-limited: the end typed in, Tashkent time.
    expect(discountFromDraft(draft('10', '', '2026-12-01T10:00'), now, 90)).toEqual({ ok: true, discount: { percent: 10, startsAt: now.toISOString(), endsAt: '2026-12-01T05:00:00.000Z' } })
    expect(discountFromDraft(draft('4', '', ''), now, 90).ok).toBe(false)
    const open = { percent: 10, startsAt: '2026-11-20T05:00:00.000Z', endsAt: null }
    expect(discountToDraft(open)).toEqual(draft('10', '2026-11-20T10:00', ''))
    expect(discountFromDraft(discountToDraft(open), now, 90)).toEqual({ ok: true, discount: open })
  })

  it('a term that is already over is refused: the end must be ahead of now', () => {
    const now = new Date('2026-11-20T10:00:00Z') // 15:00 in Tashkent
    expect(discountFromDraft(draft('10', '2026-11-01T10:00', '2026-11-10T10:00'), now).ok).toBe(false)
    expect(discountFromDraft(draft('10', '2026-11-01T10:00', '2026-11-20T15:00'), now).ok).toBe(false)
    expect(discountFromDraft(draft('10', '2026-11-01T10:00', '2026-11-20T15:01'), now).ok).toBe(true)
  })
})

describe('the quick terms of a time-limited discount (22.11): 10 days, 1, 2 and 3 months from the start', () => {
  it('offers exactly these four, in this order', () => {
    expect(DISCOUNT_TERMS.map((x) => x.id)).toEqual(['10d', '1m', '2m', '3m'])
  })
  it('counts days and calendar months from the start, keeping the time of day', () => {
    expect(discountTermEnd('2026-11-22T14:30', '10d')).toBe('2026-12-02T14:30')
    expect(discountTermEnd('2026-11-22T14:30', '1m')).toBe('2026-12-22T14:30')
    expect(discountTermEnd('2026-11-22T14:30', '2m')).toBe('2027-01-22T14:30')
    expect(discountTermEnd('2026-11-22T14:30', '3m')).toBe('2027-02-22T14:30')
  })
  it('a day the shorter month does not have becomes its last day; a leap year is counted', () => {
    expect(discountTermEnd('2027-01-31T09:00', '1m')).toBe('2027-02-28T09:00')
    expect(discountTermEnd('2028-01-31T09:00', '1m')).toBe('2028-02-29T09:00')
    expect(discountTermEnd('2026-12-31T23:59', '2m')).toBe('2027-02-28T23:59')
    expect(discountTermEnd('2026-11-30T00:00', '3m')).toBe('2027-02-28T00:00')
    expect(discountTermEnd('2026-12-25T10:00', '10d')).toBe('2027-01-04T10:00')
  })
  it('gives nothing for a start that is not a date', () => {
    expect(discountTermEnd('', '10d')).toBe('')
    expect(discountTermEnd('2026-11-22', '1m')).toBe('')
    expect(discountTermEnd('2026-13-45T10:00', '1m')).toBe('')
  })
  it('recognises the term a pair of dates makes, so the form marks its button', () => {
    expect(discountTermOf({ starts: '2026-11-22T14:30', ends: '2026-12-02T14:30' })).toBe('10d')
    expect(discountTermOf({ starts: '2026-11-22T14:30', ends: '2027-01-22T14:30' })).toBe('2m')
    expect(discountTermOf({ starts: '2026-11-22T14:30', ends: '2027-02-22T14:30' })).toBe('3m')
    expect(discountTermOf({ starts: '2026-11-22T14:30', ends: '2026-12-15T00:00' })).toBeNull() // the center's own date
    expect(discountTermOf({ starts: '2026-11-22T14:30', ends: '' })).toBeNull() // permanent
    expect(discountTermOf({ starts: '', ends: '2026-12-02T14:30' })).toBeNull()
  })
  it('a quick term makes a discount the form accepts, in Tashkent time', () => {
    const now = new Date('2026-11-22T09:30:00Z')
    const starts = tashkentNowLocal(now)
    expect(starts).toBe('2026-11-22T14:30')
    expect(discountFromDraft({ percent: '20', starts, ends: discountTermEnd(starts, '10d') }, now)).toEqual({ ok: true, discount: { percent: 20, startsAt: '2026-11-22T09:30:00.000Z', endsAt: '2026-12-02T09:30:00.000Z' } })
  })
})

describe('after a time-limited discount (22.11): a paid course of the calculator keeps the minimum', () => {
  const timed = { percent: 20, startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-11T00:00:00Z' }
  const during = new Date('2026-11-05T00:00:00Z')
  const after = new Date('2026-11-11T00:00:00Z')
  it('during the term the discount is the center’s own', () => {
    expect(discountInForce({ price: 1_000_000, priceRule: 1, discount: timed }, during)).toBe(timed)
    expect(activePercent({ price: 1_000_000, priceRule: 1, discount: timed }, during)).toBe(20)
    expect(finalPriceSom({ price: 1_000_000, priceRule: 1, discount: timed }, during)).toBe(800_000)
  })
  it('from the end on the minimum holds, with no end of its own', () => {
    expect(discountInForce({ price: 1_000_000, priceRule: 1, discount: timed }, after)).toEqual({ percent: MIN_DISCOUNT_PERCENT, startsAt: timed.endsAt, endsAt: null })
    expect(activePercent({ price: 1_000_000, priceRule: 1, discount: timed }, after)).toBe(5)
    expect(finalPriceSom({ price: 1_000_000, priceRule: 1, discount: timed }, after)).toBe(950_000)
    expect(finalPriceSom({ price: 1_000_000, priceRule: 1, discount: timed }, new Date('2030-01-01T00:00:00Z'))).toBe(950_000)
    expect(priceTotals([{ price: 1_000_000, priceRule: 1 as const, discount: timed }], after)).toEqual({ list: 1_000_000, final: 950_000, saved: 50_000 })
  })
  it('a permanent discount and one that has not started stay as they are', () => {
    const open = { percent: 20, startsAt: '2026-11-01T00:00:00Z', endsAt: null }
    expect(discountInForce({ price: 1_000_000, priceRule: 1, discount: open }, new Date('2030-01-01T00:00:00Z'))).toBe(open)
    const later = { percent: 20, startsAt: '2026-12-01T00:00:00Z', endsAt: '2026-12-11T00:00:00Z' }
    expect(activePercent({ price: 1_000_000, priceRule: 1, discount: later }, during)).toBe(0)
    expect(discountInForce({ price: 1_000_000, priceRule: 1 }, during)).toBeNull()
  })
  it('a course from before the calculator and a free course have nothing after the term, as always', () => {
    expect(discountInForce({ price: 1_000_000, priceRule: 0, discount: timed }, after)).toBe(timed)
    expect(finalPriceSom({ price: 1_000_000, priceRule: 0, discount: timed }, after)).toBe(1_000_000)
    expect(finalPriceSom({ price: 1_000_000, discount: timed }, after)).toBe(1_000_000)
    expect(activePercent({ discount: timed }, after)).toBe(0)
    expect(finalPriceSom({ price: 0, priceRule: 1, discount: timed }, after)).toBe(0)
    expect(activePercent({ price: 0, priceRule: 1, discount: timed }, after)).toBe(0)
  })
  it('the carousel keeps such a course, after those whose term still runs', () => {
    const list = [
      { id: 'kept', status: 'published' as const, visibility: 'public' as const, price: 1_000_000, priceRule: 1 as const, discount: timed },
      { id: 'old-ended', status: 'published' as const, visibility: 'public' as const, price: 1_000_000, priceRule: 0 as const, discount: timed },
      { id: 'runs', status: 'published' as const, visibility: 'public' as const, price: 1_000_000, priceRule: 1 as const, discount: { percent: 10, startsAt: '2026-11-01T00:00:00Z', endsAt: '2026-11-30T00:00:00Z' } },
    ]
    expect(carouselCourses(list, new Date('2026-11-15T00:00:00Z')).map((c) => c.id)).toEqual(['runs', 'kept'])
  })
})

describe('a discount with no end (a permanent discount)', () => {
  const open = { percent: 10, startsAt: '2026-11-01T00:00:00Z', endsAt: null }
  it('is active from its start on and never runs out', () => {
    expect(isDiscountActive(open, new Date('2026-10-31T23:59:59Z'))).toBe(false)
    expect(isDiscountActive(open, new Date('2026-11-01T00:00:00Z'))).toBe(true)
    expect(isDiscountActive(open, new Date('2099-01-01T00:00:00Z'))).toBe(true)
    expect(finalPriceSom({ price: 120_000, discount: open, priceRule: 1 }, new Date('2030-01-01T00:00:00Z'))).toBe(108_000)
    expect(finalPriceMinor(12_000_000n, open, new Date('2030-01-01T00:00:00Z'), 1)).toBe(10_800_000n)
  })
  it('passes the saving rules; in the carousel it comes after those that end', () => {
    expect(checkDiscount(open)).toEqual({ ok: true })
    expect(checkDiscount({ ...open, startsAt: 'nonsense' })).toEqual({ ok: false, reason: 'dates' })
    const now = new Date('2026-11-05T00:00:00Z')
    const list = [
      { id: 'forever', status: 'published' as const, visibility: 'public' as const, discount: open },
      { id: 'ends', status: 'published' as const, visibility: 'public' as const, discount: d(10, '2026-11-01T00:00:00Z', '2026-11-30T00:00:00Z') },
    ]
    expect(carouselCourses(list, now).map((c) => c.id)).toEqual(['ends', 'forever'])
  })
})

describe('carouselCourses', () => {
  const now = new Date('2026-11-05T00:00:00Z')
  const course = (id: string, over: Record<string, unknown> = {}) => ({
    id, status: 'published' as const, visibility: 'public' as const, discount: d(10, '2026-11-01T00:00:00Z', '2026-11-20T00:00:00Z'), ...over,
  })

  it('keeps only published, public courses whose discount is active now, soonest-ending first', () => {
    const list = [
      course('late', { discount: d(10, '2026-11-01T00:00:00Z', '2026-11-30T00:00:00Z') }),
      course('soon', { discount: d(5, '2026-11-01T00:00:00Z', '2026-11-06T00:00:00Z') }),
      course('future', { discount: d(10, '2026-11-10T00:00:00Z', '2026-11-30T00:00:00Z') }),
      course('expired', { discount: d(10, '2026-10-01T00:00:00Z', '2026-11-02T00:00:00Z') }),
      course('none', { discount: null }),
      course('draft', { status: 'draft' }),
      course('private', { visibility: 'private' }),
    ]
    expect(carouselCourses(list, now).map((c) => c.id)).toEqual(['soon', 'late'])
  })

  it('never returns more than 16 courses (one per offline course), even when asked for more', () => {
    const many = Array.from({ length: 30 }, (_, i) => course(`c${i}`, { discount: d(10, '2026-11-01T00:00:00Z', `2026-11-${String(10 + (i % 15)).padStart(2, '0')}T00:00:00Z`) }))
    expect(MAX_CAROUSEL_COURSES).toBe(16)
    expect(carouselCourses(many, now)).toHaveLength(16)
    expect(carouselCourses(many, now, 50)).toHaveLength(16)
    expect(carouselCourses(many, now, 3)).toHaveLength(3)
    expect(carouselCourses(many, now, 0)).toEqual([])
  })

  it('does not change the input list order or content (courses stay in the catalog as they are)', () => {
    const list = [course('b', { discount: d(10, '2026-11-01T00:00:00Z', '2026-11-30T00:00:00Z') }), course('a', { discount: d(10, '2026-11-01T00:00:00Z', '2026-11-10T00:00:00Z') })]
    const before = list.map((c) => c.id)
    carouselCourses(list, now)
    expect(list.map((c) => c.id)).toEqual(before)
  })
})

describe('priceTotals', () => {
  const now = new Date('2026-11-05T00:00:00Z')
  it('sums list prices and discounted prices, each course with its own active discount and nothing else', () => {
    const courses = [
      { price: 900_000, discount: d(10, '2026-11-01T00:00:00Z', '2026-11-20T00:00:00Z') },
      { price: 650_000, discount: null },
      { price: 555_555, discount: d(15, '2026-11-01T00:00:00Z', '2026-11-20T00:00:00Z') },
      { price: 500_000, discount: d(20, '2026-11-10T00:00:00Z', '2026-11-20T00:00:00Z') },
    ]
    expect(priceTotals(courses, now)).toEqual({ list: 2_605_555, final: 810_000 + 650_000 + 472_222 + 500_000, saved: 90_000 + 83_333 })
    expect(priceTotals([], now)).toEqual({ list: 0, final: 0, saved: 0 })
  })

  it('shows exactly what the server charges: the so‘m total times 100 equals the tiyin total of finalPriceMinor', () => {
    const prices = [500_000, 520_000, 550_000, 600_000, 620_000, 650_000, 700_000, 750_000, 850_000, 880_000, 900_000, 950_000, 1_000_000, 1_100_000, 1_200_000, 555_555]
    for (let percent = 1; percent <= MAX_DISCOUNT_PERCENT; percent++) {
      const courses = prices.map((price) => ({ price, discount: d(percent, '2026-11-01T00:00:00Z', '2026-11-20T00:00:00Z') }))
      const minor = courses.reduce((n, c) => n + finalPriceMinor(BigInt(c.price) * 100n, c.discount, now), 0n)
      expect(BigInt(priceTotals(courses, now).final) * 100n).toBe(minor)
    }
  })
})

describe('Asia/Tashkent input helpers', () => {
  it('converts between datetime-local text (UTC+5) and ISO instants', () => {
    expect(tashkentLocalToIso('2026-11-01T10:00')).toBe('2026-11-01T05:00:00.000Z')
    expect(isoToTashkentLocal('2026-11-01T05:00:00.000Z')).toBe('2026-11-01T10:00')
    expect(isoToTashkentLocal(tashkentLocalToIso('2026-12-31T23:30'))).toBe('2026-12-31T23:30')
  })
})
