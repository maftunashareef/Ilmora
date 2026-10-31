import { describe, expect, it } from 'vitest'
import {
  activePercent, billedSom, carouselCourses, MAX_CAROUSEL_COURSES, checkDiscount, discountFromDraft, discountSom, discountToDraft, emptyDiscountDraft, finalPriceMinor, finalPriceSom, isDiscountActive, isoToTashkentLocal, MAX_DISCOUNT_PERCENT, priceTotals, tashkentLocalToIso,
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

describe('checkDiscount', () => {
  it('accepts whole percents up to the maximum with an end after the start', () => {
    expect(checkDiscount(win)).toEqual({ ok: true })
    expect(checkDiscount(d(1, win.startsAt, win.endsAt))).toEqual({ ok: true })
    expect(checkDiscount(d(MAX_DISCOUNT_PERCENT, win.startsAt, win.endsAt))).toEqual({ ok: true })
  })
  it('caps the discount at 20% and rejects bad percents, bad dates and an end that is not after the start', () => {
    expect(MAX_DISCOUNT_PERCENT).toBe(20)
    expect(checkDiscount(d(20, win.startsAt, win.endsAt))).toEqual({ ok: true })
    for (const percent of [0, -5, 21, 50, 91, 100, 12.5]) expect(checkDiscount(d(percent, win.startsAt, win.endsAt))).toEqual({ ok: false, reason: 'percent' })
    expect(checkDiscount(d(10, 'x', win.endsAt))).toEqual({ ok: false, reason: 'dates' })
    expect(checkDiscount(d(10, win.endsAt, win.startsAt))).toEqual({ ok: false, reason: 'order' })
    expect(checkDiscount(d(10, win.startsAt, win.startsAt))).toEqual({ ok: false, reason: 'order' })
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
    expect(discountFromDraft(discountToDraft(stored))).toEqual({ ok: true, discount: stored })
  })

  it('starts immediately when the start is left empty, but always needs an end after it', () => {
    const now = new Date('2026-11-01T00:00:00Z')
    expect(discountFromDraft(draft('10', '', '2026-11-10T10:00'), now)).toEqual({ ok: true, discount: { percent: 10, startsAt: now.toISOString(), endsAt: '2026-11-10T05:00:00.000Z' } })
    expect(discountFromDraft(draft('10', '', '2026-10-31T10:00'), now).ok).toBe(false)
    expect(discountFromDraft(draft('10', '2026-11-01T10:00', ''), now).ok).toBe(false)
    expect(discountFromDraft(draft('10', '', ''), now).ok).toBe(false)
  })

  it('refuses half-filled or invalid forms: missing percent, percent outside 1-20, end not after start', () => {
    expect(discountFromDraft(draft('', '2026-11-01T10:00', '2026-11-10T10:00')).ok).toBe(false)
    expect(discountFromDraft(draft('0', '2026-11-01T10:00', '2026-11-10T10:00')).ok).toBe(false)
    expect(discountFromDraft(draft('21', '2026-11-01T10:00', '2026-11-10T10:00')).ok).toBe(false)
    expect(discountFromDraft(draft('abc', '2026-11-01T10:00', '2026-11-10T10:00')).ok).toBe(false)
    expect(discountFromDraft(draft('10', '2026-11-10T10:00', '2026-11-01T10:00')).ok).toBe(false)
    expect(discountFromDraft(draft('10', '2026-11-01', '2026-11-10T10:00')).ok).toBe(false)
    expect(discountFromDraft(draft('20', '2026-11-01T10:00', '2026-11-10T10:00')).ok).toBe(true)
  })

  it('allows a start date in the future', () => {
    const far = discountFromDraft(draft('5', '2030-01-01T00:00', '2030-02-01T00:00'))
    expect(far.ok).toBe(true)
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
