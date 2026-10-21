import type { Group, LessonSession } from './types.js'

/** ISO date (YYYY-MM-DD) in local time. */
export const isoDate = (d: Date): string => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Monday = 0 … Sunday = 6, matching Group.days */
export const weekdayIndex = (d: Date): number => (d.getDay() + 6) % 7

/** Start/end instants. API sessions carry absolute `startsAt`/`endsAt`; local sample data only has wall-clock `date` + `start`/`end`. */
export const sessionStart = (s: Pick<LessonSession, 'date' | 'start'> & { startsAt?: string }): Date => (s.startsAt ? new Date(s.startsAt) : new Date(`${s.date}T${s.start}:00`))
export const sessionEnd = (s: Pick<LessonSession, 'date' | 'end'> & { endsAt?: string }): Date => (s.endsAt ? new Date(s.endsAt) : new Date(`${s.date}T${s.end}:00`))
export const isPastSession = (s: Pick<LessonSession, 'date' | 'end'> & { endsAt?: string }, now = new Date()): boolean => sessionEnd(s).getTime() < now.getTime()

/** Deterministic id so regenerating never duplicates an occurrence. */
export const sessionId = (groupId: string, date: string) => `ses-${groupId}-${date}`

/** Random, URL-safe per-session token. The server stores only a hash of the token it issues. */
export function makeToken(): string {
  const bytes = new Uint8Array(12)
  const webCrypto = (globalThis as { crypto?: { getRandomValues?: (b: Uint8Array) => void } }).crypto
  if (webCrypto?.getRandomValues) webCrypto.getRandomValues(bytes)
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256)
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20)
}

/**
 * Expand a group's weekly schedule into individual lesson sessions
 * between `from` (inclusive) and `from + days` (exclusive).
 */
export function generateSessions(group: Group, from: Date, days: number, now = new Date()): LessonSession[] {
  const out: LessonSession[] = []
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  for (let i = 0; i < days; i++) {
    if (group.days.includes(weekdayIndex(cursor))) {
      const date = isoDate(cursor)
      const s: LessonSession = {
        id: sessionId(group.id, date),
        groupId: group.id,
        courseId: group.courseId,
        date,
        start: group.start,
        end: group.end,
        status: 'scheduled',
        attendanceOpen: false,
        token: makeToken(),
      }
      if (isPastSession(s, now)) s.status = 'completed'
      out.push(s)
    }
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

/**
 * Dates (YYYY-MM-DD) on which a group meets between `from` (inclusive) and `from + days` (exclusive).
 * Pure calendar expansion used by the API's daily session-generation job.
 */
export function scheduleDates(days: number[], from: Date, span: number): string[] {
  const out: string[] = []
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate())
  for (let i = 0; i < span; i++) {
    if (days.includes(weekdayIndex(cursor))) out.push(isoDate(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return out
}

/** Merge newly generated sessions into an existing list without touching sessions that already exist. */
export function mergeSessions(existing: LessonSession[], generated: LessonSession[]): LessonSession[] {
  const known = new Set(existing.map((s) => s.id))
  return [...existing, ...generated.filter((s) => !known.has(s.id))]
}

export const sortSessions = (list: LessonSession[]) => [...list].sort((a, b) => sessionStart(a).getTime() - sessionStart(b).getTime())

/**
 * Attendance link for a session. `origin` is the public web origin (e.g. https://ilmora.uz),
 * `basePath` an optional sub-path when the site is served below the root.
 */
export function attendanceUrl(session: Pick<LessonSession, 'id' | 'token'>, origin: string, basePath = ''): string {
  const base = basePath.replace(/\/$/, '')
  return `${origin}${base}/attend/${session.id}?t=${session.token}`
}
