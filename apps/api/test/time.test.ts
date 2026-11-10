import { describe, expect, it } from 'vitest'
import { addMonthsInZone, addMonthsUtc } from '../src/common/time'

const at = (iso: string) => new Date(iso)

describe('addMonthsUtc', () => {
  it('clamps to the last day of the target month and keeps the time of day', () => {
    expect(addMonthsUtc(at('2026-01-31T10:30:00.000Z'), 1).toISOString()).toBe('2026-02-28T10:30:00.000Z')
    expect(addMonthsUtc(at('2028-01-31T10:30:00.000Z'), 1).toISOString()).toBe('2028-02-29T10:30:00.000Z')
    expect(addMonthsUtc(at('2026-03-31T23:59:59.000Z'), 1).toISOString()).toBe('2026-04-30T23:59:59.000Z')
    expect(addMonthsUtc(at('2026-08-31T00:00:00.000Z'), 1).toISOString()).toBe('2026-09-30T00:00:00.000Z')
  })

  it('is plain month arithmetic when the day exists in the target month', () => {
    expect(addMonthsUtc(at('2026-11-06T05:00:00.000Z'), 1).toISOString()).toBe('2026-12-06T05:00:00.000Z')
    expect(addMonthsUtc(at('2026-12-15T05:00:00.000Z'), 1).toISOString()).toBe('2027-01-15T05:00:00.000Z')
    expect(addMonthsUtc(at('2026-02-28T05:00:00.000Z'), 1).toISOString()).toBe('2026-03-28T05:00:00.000Z')
    expect(addMonthsUtc(at('2026-01-15T05:00:00.000Z'), 13).toISOString()).toBe('2027-02-15T05:00:00.000Z')
  })

  it('works backwards and across year ends', () => {
    expect(addMonthsUtc(at('2026-03-31T12:00:00.000Z'), -1).toISOString()).toBe('2026-02-28T12:00:00.000Z')
    expect(addMonthsUtc(at('2026-12-31T12:00:00.000Z'), 2).toISOString()).toBe('2027-02-28T12:00:00.000Z')
    expect(addMonthsUtc(at('2026-01-31T12:00:00.000Z'), -2).toISOString()).toBe('2025-11-30T12:00:00.000Z')
  })

  it('does not mutate its input', () => {
    const d = at('2026-01-31T10:30:00.000Z')
    addMonthsUtc(d, 1)
    expect(d.toISOString()).toBe('2026-01-31T10:30:00.000Z')
  })
})

describe('addMonthsInZone (Н7: the month of a subscription follows the Tashkent calendar)', () => {
  const at = (s: string) => new Date(s)
  it('a payment at night in Tashkent gets a whole calendar month', () => {
    // 1 March 01:00 in Tashkent = 28 Feb 20:00 UTC → 1 April 01:00 in Tashkent.
    expect(addMonthsInZone(at('2026-02-28T20:00:00.000Z'), 1).toISOString()).toBe('2026-03-31T20:00:00.000Z')
    // 31 January 03:00 in Tashkent → 28 February, never 2–3 March.
    expect(addMonthsInZone(at('2026-01-30T22:00:00.000Z'), 1).toISOString()).toBe('2026-02-27T22:00:00.000Z')
    expect(addMonthsInZone(at('2026-11-06T05:00:00.000Z'), 1).toISOString()).toBe('2026-12-06T05:00:00.000Z')
  })
})
