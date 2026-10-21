import type { AttendanceRecord, LessonSession, Student } from './types.js'

/**
 * Pure check-in validation shared by the API (against a database snapshot) and the
 * demo/offline client. Order of checks mirrors the server contract:
 * invalid link → identity → enrollment → existing record (idempotent) → window open.
 */

export interface CheckInInput {
  sessionId: string
  token: string
  /** Established identity (server: the authenticated student). null = unknown. */
  studentId: string | null
  now?: Date
}

export type CheckInFailure = 'invalid-link' | 'no-identity' | 'closed' | 'not-enrolled' | 'expired'

export type CheckInResult =
  | { ok: true; record: AttendanceRecord; alreadyRecorded: boolean; session: LessonSession }
  | { ok: false; reason: CheckInFailure; session?: LessonSession }

export interface AttendanceSnapshot {
  sessions: LessonSession[]
  attendance: AttendanceRecord[]
  students: Student[]
}

/** Pure validation + idempotent record creation. Returns the record to persist (or the existing one). */
export function evaluateCheckIn(snapshot: AttendanceSnapshot, input: CheckInInput): CheckInResult {
  const session = snapshot.sessions.find((s) => s.id === input.sessionId)
  if (!session || !input.token || session.token !== input.token) return { ok: false, reason: 'invalid-link' }
  if (!input.studentId) return { ok: false, reason: 'no-identity', session }
  const student = snapshot.students.find((s) => s.id === input.studentId)
  const enrolled = !!student && student.subscription.status === 'active' && student.subscription.groupIds.includes(session.groupId)
  if (!enrolled) return { ok: false, reason: 'not-enrolled', session }
  // An existing record always wins — repeated scans never duplicate or overwrite the original timestamp.
  const existing = snapshot.attendance.find((r) => r.sessionId === session.id && r.studentId === input.studentId)
  if (existing) return { ok: true, record: existing, alreadyRecorded: true, session }
  if (!session.attendanceOpen || session.status === 'cancelled') return { ok: false, reason: 'closed', session }
  const record: AttendanceRecord = {
    id: `att-${session.id}-${input.studentId}`,
    sessionId: session.id,
    studentId: input.studentId,
    checkedInAt: (input.now ?? new Date()).toISOString(),
    method: 'qr',
  }
  return { ok: true, record, alreadyRecorded: false, session }
}
