import { overlaps } from './schedule.js'
import type { Group, Student } from './types.js'

/**
 * Shared enrollment rules. Enrollment is derived from student subscriptions
 * (a student is enrolled in a group when their active subscription includes it),
 * so counts never drift from the roster.
 */

export const enrolledStudents = (students: Student[], groupId: string): Student[] =>
  students.filter((s) => s.subscription.status === 'active' && s.subscription.groupIds.includes(groupId))

/** Number of enrolled students, optionally ignoring one student (the one who is (re)enrolling). */
export const enrolledCount = (students: Student[], groupId: string, excludeStudentId?: string): number =>
  enrolledStudents(students, groupId).filter((s) => s.id !== excludeStudentId).length

export const seatsLeft = (group: Group, students: Student[], excludeStudentId?: string): number =>
  Math.max(0, group.capacity - enrolledCount(students, group.id, excludeStudentId))

export const isGroupFull = (group: Group, students: Student[], excludeStudentId?: string): boolean =>
  enrolledCount(students, group.id, excludeStudentId) >= group.capacity

export type CapacityCheck = { ok: true } | { ok: false; reason: 'not-integer' | 'below-enrolled'; enrolled: number }

/** Capacity must be a positive integer and may not drop below the current enrollment. */
export function validateCapacity(capacity: number, enrolled: number): CapacityCheck {
  if (!Number.isInteger(capacity) || capacity < 1) return { ok: false, reason: 'not-integer', enrolled }
  if (capacity < enrolled) return { ok: false, reason: 'below-enrolled', enrolled }
  return { ok: true }
}

/**
 * Fallback used when migrating groups persisted before capacity existed:
 * the previous `seats` value (or 12 when missing), never below the current enrollment.
 */
export const DEFAULT_CAPACITY = 12
export const migratedCapacity = (previousSeats: unknown, enrolled: number): number => {
  const seats = Number(previousSeats)
  const base = Number.isInteger(seats) && seats > 0 ? seats : DEFAULT_CAPACITY
  return Math.max(base, enrolled, 1)
}

/**
 * A custom selection (no package) may hold any number of courses (decided 2026-11-03); only the weekly schedule limits
 * it, since groups may not overlap. This bound is technical, not a business rule: it caps one request (web cart and
 * draft endpoint) far above the catalog's offline courses, and the interface never presents it as a limit.
 */
export const MAX_CART_COURSES = 30

/**
 * How long a checkout holds the seats while the student pays (hours): the API's PAYMENT_EXPIRES_HOURS, 1 by default and
 * on the live server. The checkout page says it in words; change both together.
 */
export const PAYMENT_HOLD_HOURS = 1

export type CartDropReason = 'unknown' | 'duplicate' | 'full' | 'limit' | 'conflict'
export interface CartMergeResult {
  groupIds: string[]
  dropped: { groupId: string; reason: CartDropReason }[]
}

/**
 * Merges a guest's cart into the account's draft. The account always wins: its groups are kept as they are, and a
 * guest group is added only when its course is new, it still has a free seat, the limit allows it and it does not
 * overlap anything already kept. Anything else is reported in `dropped` instead of silently replacing a choice.
 */
export function mergeCartGroups(
  accountGroupIds: string[],
  guestGroupIds: string[],
  groups: Group[],
  opts: { limit: number; isFull?: (g: Group) => boolean },
): CartMergeResult {
  const byId = new Map(groups.map((g) => [g.id, g]))
  const kept: string[] = []
  const keptGroups: Group[] = []
  const courses = new Set<string>()
  for (const id of accountGroupIds) {
    if (kept.includes(id)) continue
    kept.push(id)
    const g = byId.get(id)
    if (g) {
      keptGroups.push(g)
      courses.add(g.courseId)
    }
  }
  const dropped: CartMergeResult['dropped'] = []
  for (const id of guestGroupIds) {
    if (kept.includes(id)) continue
    const g = byId.get(id)
    if (!g) dropped.push({ groupId: id, reason: 'unknown' })
    else if (courses.has(g.courseId)) dropped.push({ groupId: id, reason: 'duplicate' })
    else if (opts.isFull?.(g)) dropped.push({ groupId: id, reason: 'full' })
    else if (kept.length >= opts.limit) dropped.push({ groupId: id, reason: 'limit' })
    else if (keptGroups.some((k) => overlaps(k, g))) dropped.push({ groupId: id, reason: 'conflict' })
    else {
      kept.push(id)
      keptGroups.push(g)
      courses.add(g.courseId)
    }
  }
  return { groupIds: kept, dropped }
}
