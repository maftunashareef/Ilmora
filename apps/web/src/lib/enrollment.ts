import { validateCapacity as sharedValidateCapacity, type CapacityCheck, type Group, type Student } from '@ilmora/shared'

export { DEFAULT_CAPACITY, migratedCapacity } from '@ilmora/shared'
export type { CapacityCheck }

/**
 * Seat counts come from the API (ACTIVE + pending holds per group) and are published here by the store,
 * so the existing pages keep calling `enrolledCount(students, groupId, excludeStudentId)` unchanged.
 * `students` is only used to know whether the excluded student already holds a seat in the group.
 */
const seatCounts = new Map<string, number>()

export function publishSeatCounts(groups: { id: string; enrolled?: number }[]) {
  for (const g of groups) if (typeof g.enrolled === 'number') seatCounts.set(g.id, g.enrolled)
}

export const enrolledStudents = (students: Student[], groupId: string): Student[] =>
  students.filter((s) => s.subscription.status === 'active' && s.subscription.groupIds.includes(groupId))

export const enrolledCount = (students: Student[], groupId: string, excludeStudentId?: string): number => {
  const total = seatCounts.get(groupId) ?? enrolledStudents(students, groupId).length
  const me = excludeStudentId ? students.find((s) => s.id === excludeStudentId) : undefined
  const holdsSeat = !!me && me.subscription.status === 'active' && me.subscription.groupIds.includes(groupId)
  return Math.max(0, total - (holdsSeat ? 1 : 0))
}

export const seatsLeft = (group: Group, students: Student[], excludeStudentId?: string): number =>
  Math.max(0, group.capacity - enrolledCount(students, group.id, excludeStudentId))

export const isGroupFull = (group: Group, students: Student[], excludeStudentId?: string): boolean =>
  enrolledCount(students, group.id, excludeStudentId) >= group.capacity

export const validateCapacity = (capacity: number, enrolled: number): CapacityCheck => sharedValidateCapacity(capacity, enrolled)

/** First group whose capacity is invalid or below its current enrollment, if any. */
export const groupsCapacityError = (groups: Group[], students: Student[]) => {
  for (const g of groups) {
    const check = validateCapacity(g.capacity, enrolledCount(students, g.id))
    if (!check.ok) return { group: g, check }
  }
  return null
}
