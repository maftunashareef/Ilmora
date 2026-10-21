import { attendanceUrl as buildAttendanceUrl, type LessonSession } from '@ilmora/shared'

export {
  generateSessions, isoDate, isPastSession, makeToken, mergeSessions, scheduleDates, sessionEnd, sessionId, sessionStart, sortSessions, weekdayIndex,
} from '@ilmora/shared'

/** Attendance link for a session, honouring the deployment base path (e.g. GitHub Pages /ilmora-demo/). */
export function attendanceUrl(session: Pick<LessonSession, 'id' | 'token'>, origin = typeof location !== 'undefined' ? location.origin : ''): string {
  return buildAttendanceUrl(session, origin, '')
}
