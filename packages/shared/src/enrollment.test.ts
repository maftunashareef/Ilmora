import { describe, expect, it } from 'vitest'
import { enrolledCount, isGroupFull, migratedCapacity, seatsLeft, validateCapacity } from './enrollment.js'
import type { Group, Student } from './types.js'

const student = (id: string, groupIds: string[], status: 'active' | 'none' = 'active'): Student => ({
  id,
  profile: { displayName: id, district: '', preferredLang: 'uz', reminders: false },
  subscription: { packageId: 'pkg-duo', groupIds, status },
  savedCourseIds: [],
  savedTeacherIds: [],
  builder: { packageId: null, groupIds: [], meyosGrant: false },
})

const group: Group = { id: 'g1', courseId: 'c1', name: 'A', days: [0], start: '18:00', end: '19:00', room: '1', capacity: 2 }

describe('enrollment', () => {
  it('counts only active subscriptions that include the group', () => {
    const students = [student('a', ['g1']), student('b', ['g1'], 'none'), student('c', ['g2'])]
    expect(enrolledCount(students, 'g1')).toBe(1)
  })

  it('ignores the enrolling student so re-selecting their own seat never counts against them', () => {
    const students = [student('a', ['g1']), student('b', ['g1'])]
    expect(isGroupFull(group, students)).toBe(true)
    expect(isGroupFull(group, students, 'a')).toBe(false)
  })

  it('frees the seat again when a student cancels', () => {
    const full = [student('a', ['g1']), student('b', ['g1'])]
    expect(isGroupFull(group, full)).toBe(true)
    const afterCancel = [student('a', ['g1']), student('b', [], 'none')]
    expect(isGroupFull(group, afterCancel)).toBe(false)
    expect(seatsLeft(group, afterCancel)).toBe(1)
  })

  it('rejects non-positive or fractional capacity and reductions below enrollment', () => {
    expect(validateCapacity(0, 0)).toEqual({ ok: false, reason: 'not-integer', enrolled: 0 })
    expect(validateCapacity(2.5, 0)).toEqual({ ok: false, reason: 'not-integer', enrolled: 0 })
    expect(validateCapacity(3, 5)).toEqual({ ok: false, reason: 'below-enrolled', enrolled: 5 })
    expect(validateCapacity(5, 5)).toEqual({ ok: true })
  })

  it('migrates legacy seats with a fallback that never undercuts current enrollment', () => {
    expect(migratedCapacity(8, 3)).toBe(8)
    expect(migratedCapacity(undefined, 3)).toBe(12)
    expect(migratedCapacity(2, 5)).toBe(5)
    expect(migratedCapacity('oops', 0)).toBe(12)
  })
})
