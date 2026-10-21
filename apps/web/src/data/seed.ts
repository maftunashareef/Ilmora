import { generateSessions, sampleData } from '@ilmora/shared'
import type { AttendanceRecord, DemoState, LessonSession } from '../types'

export const { centers, categories, teachers, subjects, courses, videos, playlists, resources, students, site } = sampleData

/** Deterministic pseudo-random in [0, 1) from a string, so sample attendance is stable between resets. */
const hash01 = (key: string) => {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) }
  return ((h >>> 0) % 1000) / 1000
}

/** Lesson sessions for every group: two weeks back, three weeks ahead. Past sessions get sample QR check-ins (~80%). */
function seedSessions(now = new Date()): { sessions: LessonSession[]; attendance: AttendanceRecord[] } {
  const from = new Date(now)
  from.setDate(from.getDate() - 14)
  const sessions = courses.flatMap((c) => c.groups.flatMap((g) => generateSessions(g, from, 35, now)))
  const attendance: AttendanceRecord[] = []
  for (const ses of sessions) {
    if (ses.status !== 'completed') continue
    for (const st of students) {
      if (st.subscription.status !== 'active' || !st.subscription.groupIds.includes(ses.groupId)) continue
      if (hash01(`${ses.id}:${st.id}`) > 0.8) continue
      const at = new Date(`${ses.date}T${ses.start}:00`)
      at.setMinutes(at.getMinutes() + Math.floor(hash01(`${st.id}:${ses.id}`) * 12))
      attendance.push({ id: `att-${ses.id}-${st.id}`, sessionId: ses.id, studentId: st.id, checkedInAt: at.toISOString(), method: 'qr' })
    }
  }
  return { sessions, attendance }
}

export function createSeed(): DemoState {
  // Deep clone so runtime mutations never touch the module constants
  const base = JSON.parse(JSON.stringify({ site, centers, categories, teachers, subjects, courses, videos, playlists, resources, students })) as Omit<DemoState, 'sessions' | 'attendance'>
  return { ...base, ...seedSessions() }
}
