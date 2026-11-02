import type { SubscriptionBlockReason, SubscriptionKind } from './types.js'

/**
 * Pure subscription rules shared by the API (lifecycle worker, access checks) and the web app (what to show).
 * Statuses are the API's: ACTIVE (access), PAST_DUE (blocked, seats held), EXPIRED (blocked, seats released).
 */

export interface SubscriptionAccessInput {
  status: string
  kind?: SubscriptionKind | null
  currentPeriodEnd?: string | Date | null
  lessonsTotal?: number | null
  lessonsUsed?: number | null
  graceEndsAt?: string | Date | null
  blockReason?: string | null
}

export interface SubscriptionAccess {
  /** Check-ins and private materials are allowed. */
  active: boolean
  /** Blocked by the platform (period ended or lessons used up); a payment reactivates. */
  blocked: boolean
  reason: SubscriptionBlockReason | null
  /** PERIOD: whole days left in the period (never negative); LESSONS: null. */
  remainingDays: number | null
  /** LESSONS: lessons left (never negative); PERIOD: null. */
  remainingLessons: number | null
}

const toMs = (v: string | Date | null | undefined) => (v == null ? null : (v instanceof Date ? v : new Date(v)).getTime())

export function subscriptionAccess(sub: SubscriptionAccessInput, now = new Date()): SubscriptionAccess {
  const kind = sub.kind ?? 'PERIOD'
  const blocked = sub.status === 'PAST_DUE' || sub.status === 'EXPIRED'
  const reason: SubscriptionBlockReason | null = blocked ? (sub.blockReason === 'lessons_exhausted' ? 'lessons_exhausted' : 'period_ended') : null
  const end = toMs(sub.currentPeriodEnd)
  const remainingDays = kind === 'PERIOD' && end != null ? Math.max(0, Math.ceil((end - now.getTime()) / 86_400_000)) : null
  const remainingLessons = kind === 'LESSONS' && sub.lessonsTotal != null ? Math.max(0, sub.lessonsTotal - (sub.lessonsUsed ?? 0)) : null
  return { active: sub.status === 'ACTIVE' && !blocked, blocked, reason, remainingDays, remainingLessons }
}

export type LifecycleStep =
  /** ACTIVE → PAST_DUE: the period ended */
  | 'block_period'
  /** ACTIVE → PAST_DUE: the bought lessons are used up */
  | 'block_lessons'
  /** PAST_DUE → EXPIRED: the grace period passed, seats are released */
  | 'expire'

/** The one transition the lifecycle worker should apply to a subscription right now, if any. */
export function nextLifecycleStep(sub: SubscriptionAccessInput, now = new Date()): LifecycleStep | null {
  const t = now.getTime()
  if (sub.status === 'ACTIVE') {
    const kind = sub.kind ?? 'PERIOD'
    if (kind === 'LESSONS') return sub.lessonsTotal != null && (sub.lessonsUsed ?? 0) >= sub.lessonsTotal ? 'block_lessons' : null
    const end = toMs(sub.currentPeriodEnd)
    return end != null && end <= t ? 'block_period' : null
  }
  if (sub.status === 'PAST_DUE') {
    const grace = toMs(sub.graceEndsAt)
    return grace != null && grace <= t ? 'expire' : null
  }
  return null
}

export interface ReminderInput extends SubscriptionAccessInput {
  expiryReminderAt?: string | Date | null
}

export type ReminderKind = 'expiring' | 'lessonsLow'

/**
 * Which reminder is due: `expiring` once per period when the period ends within `remindDays` days,
 * `lessonsLow` once per period when at most `lowLessons` lessons remain (never 0: that is a block, not a reminder).
 */
export function dueReminder(sub: ReminderInput, now = new Date(), remindDays = 3, lowLessons = 2): ReminderKind | null {
  if (sub.status !== 'ACTIVE') return null
  const access = subscriptionAccess(sub, now)
  const kind = sub.kind ?? 'PERIOD'
  if (kind === 'LESSONS') return access.remainingLessons != null && access.remainingLessons > 0 && access.remainingLessons <= lowLessons && sub.expiryReminderAt == null ? 'lessonsLow' : null
  const end = toMs(sub.currentPeriodEnd)
  if (end == null || end <= now.getTime()) return null
  const already = toMs(sub.expiryReminderAt)
  // A reminder sent for an earlier period (before this period started) does not count for the current one.
  const windowStart = end - remindDays * 86_400_000
  if (now.getTime() < windowStart) return null
  return already != null && already >= windowStart ? null : 'expiring'
}
