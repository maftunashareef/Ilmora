import { describe, expect, it } from 'vitest'
import { dueReminder, nextLifecycleStep, subscriptionAccess } from './subscription.js'

const now = new Date('2026-11-10T10:00:00.000Z')

describe('subscription access', () => {
  it('counts the days left of a period subscription', () => {
    const a = subscriptionAccess({ status: 'ACTIVE', kind: 'PERIOD', currentPeriodEnd: '2026-11-13T09:00:00.000Z' }, now)
    expect(a).toEqual({ active: true, blocked: false, reason: null, remainingDays: 3, remainingLessons: null })
  })

  it('counts the lessons left of a lesson subscription', () => {
    const a = subscriptionAccess({ status: 'ACTIVE', kind: 'LESSONS', lessonsTotal: 12, lessonsUsed: 9 }, now)
    expect(a.remainingLessons).toBe(3)
    expect(a.remainingDays).toBeNull()
    expect(subscriptionAccess({ status: 'ACTIVE', kind: 'LESSONS', lessonsTotal: 12, lessonsUsed: 14 }, now).remainingLessons).toBe(0)
  })

  it('treats PAST_DUE and EXPIRED as blocked with the stored reason', () => {
    expect(subscriptionAccess({ status: 'PAST_DUE', blockReason: 'lessons_exhausted' }, now)).toMatchObject({ active: false, blocked: true, reason: 'lessons_exhausted' })
    expect(subscriptionAccess({ status: 'EXPIRED' }, now)).toMatchObject({ active: false, blocked: true, reason: 'period_ended' })
    expect(subscriptionAccess({ status: 'PENDING_PAYMENT' }, now)).toMatchObject({ active: false, blocked: false, reason: null })
  })
})

describe('lifecycle worker decisions', () => {
  it('blocks a period subscription once its period ended', () => {
    expect(nextLifecycleStep({ status: 'ACTIVE', kind: 'PERIOD', currentPeriodEnd: '2026-11-10T09:59:59.000Z' }, now)).toBe('block_period')
    expect(nextLifecycleStep({ status: 'ACTIVE', kind: 'PERIOD', currentPeriodEnd: '2026-11-10T10:00:01.000Z' }, now)).toBeNull()
  })

  it('blocks a lesson subscription when the lessons are used up, whatever the dates', () => {
    expect(nextLifecycleStep({ status: 'ACTIVE', kind: 'LESSONS', lessonsTotal: 8, lessonsUsed: 8, currentPeriodEnd: '2027-01-01T00:00:00.000Z' }, now)).toBe('block_lessons')
    expect(nextLifecycleStep({ status: 'ACTIVE', kind: 'LESSONS', lessonsTotal: 8, lessonsUsed: 7 }, now)).toBeNull()
  })

  it('expires a blocked subscription after the grace period and leaves other statuses alone', () => {
    expect(nextLifecycleStep({ status: 'PAST_DUE', graceEndsAt: '2026-11-10T09:00:00.000Z' }, now)).toBe('expire')
    expect(nextLifecycleStep({ status: 'PAST_DUE', graceEndsAt: '2026-11-12T09:00:00.000Z' }, now)).toBeNull()
    expect(nextLifecycleStep({ status: 'EXPIRED' }, now)).toBeNull()
    expect(nextLifecycleStep({ status: 'DRAFT' }, now)).toBeNull()
  })
})

describe('reminders', () => {
  it('reminds once in the last three days of a period', () => {
    const sub = { status: 'ACTIVE', kind: 'PERIOD' as const, currentPeriodEnd: '2026-11-12T12:00:00.000Z' }
    expect(dueReminder(sub, now)).toBe('expiring')
    expect(dueReminder({ ...sub, expiryReminderAt: '2026-11-10T09:00:00.000Z' }, now)).toBeNull()
    // A reminder sent for the previous period does not silence this one.
    expect(dueReminder({ ...sub, expiryReminderAt: '2026-10-08T09:00:00.000Z' }, now)).toBe('expiring')
    expect(dueReminder({ ...sub, currentPeriodEnd: '2026-11-20T12:00:00.000Z' }, now)).toBeNull()
  })

  it('warns once when two lessons remain, never when none remain', () => {
    expect(dueReminder({ status: 'ACTIVE', kind: 'LESSONS', lessonsTotal: 12, lessonsUsed: 10 }, now)).toBe('lessonsLow')
    expect(dueReminder({ status: 'ACTIVE', kind: 'LESSONS', lessonsTotal: 12, lessonsUsed: 10, expiryReminderAt: '2026-11-01T00:00:00.000Z' }, now)).toBeNull()
    expect(dueReminder({ status: 'ACTIVE', kind: 'LESSONS', lessonsTotal: 12, lessonsUsed: 12 }, now)).toBeNull()
    expect(dueReminder({ status: 'PAST_DUE', kind: 'LESSONS', lessonsTotal: 12, lessonsUsed: 10 }, now)).toBeNull()
  })
})
