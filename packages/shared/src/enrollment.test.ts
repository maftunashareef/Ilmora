import { describe, expect, it } from 'vitest'
import { enrolledCount, isGroupFull, mergeCartGroups, migratedCapacity, seatsLeft, validateCapacity } from './enrollment.js'
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

describe('mergeCartGroups', () => {
  const g = (id: string, courseId: string, day: number, start = '18:00', end = '19:00', capacity = 5): Group => ({ id, courseId, name: id, days: [day], start, end, room: '1', capacity })
  const groups = [g('a1', 'a', 0), g('a2', 'a', 1), g('b1', 'b', 1), g('c1', 'c', 2), g('d1', 'd', 0, '18:30', '19:30'), g('e1', 'e', 3)]
  const opts = { limit: 3 }

  it('keeps the account selection first and adds new guest courses without duplicates', () => {
    const r = mergeCartGroups(['a1'], ['b1', 'a1', 'b1'], groups, opts)
    expect(r.groupIds).toEqual(['a1', 'b1'])
    expect(r.dropped).toEqual([])
  })

  it('lets the account win when the same course is in another group', () => {
    const r = mergeCartGroups(['a1'], ['a2'], groups, opts)
    expect(r.groupIds).toEqual(['a1'])
    expect(r.dropped).toEqual([{ groupId: 'a2', reason: 'duplicate' }])
  })

  it('drops overlapping, full, unknown and over-limit guest groups and reports why', () => {
    const r = mergeCartGroups(['a1'], ['d1', 'zz', 'c1', 'b1', 'e1'], groups, { limit: 3, isFull: (x) => x.id === 'c1' })
    expect(r.groupIds).toEqual(['a1', 'b1', 'e1'])
    expect(r.dropped).toEqual([
      { groupId: 'd1', reason: 'conflict' },
      { groupId: 'zz', reason: 'unknown' },
      { groupId: 'c1', reason: 'full' },
    ])
    expect(mergeCartGroups(['a1', 'b1', 'c1'], ['e1'], groups, opts).dropped).toEqual([{ groupId: 'e1', reason: 'limit' }])
  })

  it('returns the account selection unchanged when the guest cart is empty', () => {
    expect(mergeCartGroups(['a1', 'a1'], [], groups, opts)).toEqual({ groupIds: ['a1'], dropped: [] })
  })
})
