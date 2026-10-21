import { describe, expect, it } from 'vitest'
import { evaluateCheckIn, type AttendanceSnapshot } from './attendance.js'
import type { LessonSession, Student } from './types.js'

const session: LessonSession = { id: 'ses-g1-2026-10-07', groupId: 'g1', courseId: 'c1', date: '2026-10-07', start: '18:00', end: '19:30', status: 'scheduled', attendanceOpen: true, token: 'tok123' }
const student = (id: string, groupIds: string[]): Student => ({
  id,
  profile: { displayName: id, district: '', preferredLang: 'uz', reminders: false },
  subscription: { packageId: 'pkg-duo', groupIds, status: 'active' },
  savedCourseIds: [],
  savedTeacherIds: [],
  builder: { packageId: null, groupIds: [], meyosGrant: false },
})
const snapshot = (over: Partial<AttendanceSnapshot> = {}): AttendanceSnapshot => ({ sessions: [session], attendance: [], students: [student('a', ['g1']), student('b', ['g2'])], ...over })

describe('attendance check-in', () => {
  it('rejects unknown sessions and wrong tokens', () => {
    expect(evaluateCheckIn(snapshot(), { sessionId: 'nope', token: 'tok123', studentId: 'a' })).toEqual({ ok: false, reason: 'invalid-link' })
    expect(evaluateCheckIn(snapshot(), { sessionId: session.id, token: 'wrong', studentId: 'a' }).ok).toBe(false)
  })

  it('requires an established student identity', () => {
    const r = evaluateCheckIn(snapshot(), { sessionId: session.id, token: 'tok123', studentId: null })
    expect(r).toMatchObject({ ok: false, reason: 'no-identity' })
  })

  it('refuses students who are not enrolled in the group', () => {
    const r = evaluateCheckIn(snapshot(), { sessionId: session.id, token: 'tok123', studentId: 'b' })
    expect(r).toMatchObject({ ok: false, reason: 'not-enrolled' })
  })

  it('refuses check-ins while attendance is closed', () => {
    const closed = snapshot({ sessions: [{ ...session, attendanceOpen: false }] })
    expect(evaluateCheckIn(closed, { sessionId: session.id, token: 'tok123', studentId: 'a' })).toMatchObject({ ok: false, reason: 'closed' })
  })

  it('records a timestamped check-in for an enrolled student while open', () => {
    const now = new Date('2026-10-07T18:03:00.000Z')
    const r = evaluateCheckIn(snapshot(), { sessionId: session.id, token: 'tok123', studentId: 'a', now })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.alreadyRecorded).toBe(false)
      expect(r.record).toMatchObject({ sessionId: session.id, studentId: 'a', method: 'qr', checkedInAt: now.toISOString() })
    }
  })

  it('never duplicates or overwrites an existing record, even after attendance closes', () => {
    const first = evaluateCheckIn(snapshot(), { sessionId: session.id, token: 'tok123', studentId: 'a', now: new Date('2026-10-07T18:03:00.000Z') })
    if (!first.ok) throw new Error('expected success')
    const later = snapshot({ attendance: [first.record], sessions: [{ ...session, attendanceOpen: false }] })
    const again = evaluateCheckIn(later, { sessionId: session.id, token: 'tok123', studentId: 'a', now: new Date('2026-10-07T18:40:00.000Z') })
    expect(again.ok).toBe(true)
    if (again.ok) {
      expect(again.alreadyRecorded).toBe(true)
      expect(again.record.checkedInAt).toBe(first.record.checkedInAt)
    }
  })
})
