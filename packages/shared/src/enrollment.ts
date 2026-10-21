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
