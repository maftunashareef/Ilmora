import type { Group, LessonSession } from '../types'

/** ISO date (YYYY-MM-DD) in local time. */
export const isoDate = (d: Date): string => {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Monday = 0 … Sunday = 6, matching Group.days */
export const weekdayIndex = (d: Date): number => (d.getDay() + 6) % 7

export const sessionStart = (s: LessonSession): Date => new Date(`${s.date}T${s.start}:00`)
export const sessionEnd = (s: LessonSession): Date => new Date(`${s.date}T${s.end}:00`)
export const isPastSession = (s: LessonSession, now = new Date()): boolean => sessionEnd(s).getTime() < now.getTime()

/** Deterministic id so regenerating never duplicates an occurrence. */
export const sessionId = (groupId: string, date: string) => `ses-${groupId}-${date}`

/** Random, URL-safe per-session token (demo: not a cryptographic secret without server-side validation). */
export function makeToken(): string {
  const bytes = new Uint8Array(12)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes)
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

/** Merge newly generated sessions into an existing list without touching sessions that already exist. */
export function mergeSessions(existing: LessonSession[], generated: LessonSession[]): LessonSession[] {
  const known = new Set(existing.map((s) => s.id))
  return [...existing, ...generated.filter((s) => !known.has(s.id))]
}

export const sortSessions = (list: LessonSession[]) => [...list].sort((a, b) => sessionStart(a).getTime() - sessionStart(b).getTime())

/** Attendance link for a session, honouring the deployment base path (e.g. GitHub Pages /ilmora-demo/). */
export function attendanceUrl(session: LessonSession, origin = typeof location !== 'undefined' ? location.origin : ''): string {
  const base = (import.meta.env?.BASE_URL ?? '/').replace(/\/$/, '')
  return `${origin}${base}/attend/${session.id}?t=${session.token}`
}
