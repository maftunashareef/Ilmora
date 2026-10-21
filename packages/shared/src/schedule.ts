import type { Course, Group } from './types.js'

export const toMin = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h * 60 + (m || 0)
}

export const overlaps = (a: Group, b: Group) =>
  a.days.some((d) => b.days.includes(d)) && toMin(a.start) < toMin(b.end) && toMin(b.start) < toMin(a.end)

export interface Conflict { a: Group; b: Group }

export function findConflicts(groups: Group[]): Conflict[] {
  const out: Conflict[] = []
  for (let i = 0; i < groups.length; i++)
    for (let j = i + 1; j < groups.length; j++) if (overlaps(groups[i], groups[j])) out.push({ a: groups[i], b: groups[j] })
  return out
}

export const groupHours = (g: Group) => ((toMin(g.end) - toMin(g.start)) / 60) * g.days.length

export const weeklyHours = (groups: Group[]) => groups.reduce((sum, g) => sum + groupHours(g), 0)

export const lessonsPerWeek = (groups: Group[]) => groups.reduce((n, g) => n + g.days.length, 0)

export interface Lesson { group: Group; course: Course; day: number; start: string; end: string }

/** Expand groups into individual weekly lessons, sorted by day then time. */
export function expandLessons(groups: Group[], courses: Course[]): Lesson[] {
  const byId = new Map(courses.map((c) => [c.id, c]))
  const out: Lesson[] = []
  for (const g of groups) {
    const course = byId.get(g.courseId)
    if (!course) continue
    for (const day of g.days) out.push({ group: g, course, day, start: g.start, end: g.end })
  }
  return out.sort((x, y) => x.day - y.day || toMin(x.start) - toMin(y.start))
}

/** Monday = 0 … Sunday = 6 */
export const todayIndex = (d = new Date()) => (d.getDay() + 6) % 7

/** Next N lessons from now (wrapping to next week). */
export function upcomingLessons(lessons: Lesson[], n = 4, now = new Date()): (Lesson & { inDays: number })[] {
  const today = todayIndex(now)
  const nowMin = now.getHours() * 60 + now.getMinutes()
  const scored = lessons.map((l) => {
    let inDays = (l.day - today + 7) % 7
    if (inDays === 0 && toMin(l.end) <= nowMin) inDays = 7
    return { ...l, inDays }
  })
  return scored.sort((a, b) => a.inDays - b.inDays || toMin(a.start) - toMin(b.start)).slice(0, n)
}

export const groupsById = (courses: Course[]) => new Map(courses.flatMap((c) => c.groups).map((g) => [g.id, g]))

export const resolveGroups = (ids: string[], courses: Course[]) => {
  const map = groupsById(courses)
  return ids.map((id) => map.get(id)).filter(Boolean) as Group[]
}
