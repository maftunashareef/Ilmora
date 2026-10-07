import type { AttendanceRecord, LessonSession, Student } from '../types'
import { useStore } from '../store/useStore'

/**
 * Attendance service boundary.
 *
 * Everything a server would own later — identity, token validation, enrollment
 * checks, shared persistence — goes through this interface. The demo implementation
 * below runs against the local zustand store (same-browser only): a QR link alone
 * cannot identify a student, and separate devices do not share localStorage.
 */

export interface CheckInInput {
  sessionId: string
  token: string
  /** Established identity (demo: the active student in this browser). null = unknown. */
  studentId: string | null
  now?: Date
}

export type CheckInResult =
  | { ok: true; record: AttendanceRecord; alreadyRecorded: boolean; session: LessonSession }
  | { ok: false; reason: 'invalid-link' | 'no-identity' | 'closed' | 'not-enrolled'; session?: LessonSession }

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

export interface AttendanceService {
  checkIn(input: CheckInInput): CheckInResult
  openSession(sessionId: string): void
  closeSession(sessionId: string): void
  recordsForSession(sessionId: string): AttendanceRecord[]
  recordsForStudent(studentId: string): AttendanceRecord[]
}

/** Same-browser demo implementation backed by the persisted store. Swap for an HTTP client when a backend exists. */
export const localAttendanceService: AttendanceService = {
  checkIn(input) {
    const state = useStore.getState()
    const result = evaluateCheckIn({ sessions: state.sessions, attendance: state.attendance, students: state.students }, input)
    if (result.ok && !result.alreadyRecorded) state.recordCheckIn(result.record)
    return result
  },
  openSession(sessionId) { useStore.getState().setSessionAttendance(sessionId, true) },
  closeSession(sessionId) { useStore.getState().setSessionAttendance(sessionId, false) },
  recordsForSession(sessionId) { return useStore.getState().attendance.filter((r) => r.sessionId === sessionId) },
  recordsForStudent(studentId) { return useStore.getState().attendance.filter((r) => r.studentId === studentId) },
}
