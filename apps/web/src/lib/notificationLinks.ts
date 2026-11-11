import type { AppNotification } from '@ilmora/shared'

export type DashboardRole = 'admin' | 'center' | 'teacher' | 'student'

/** The dashboard role of the signed-in account, or null for a visitor (who has no notifications). */
export const dashboardRole = (role: string): DashboardRole | null => (role === 'admin' || role === 'center' || role === 'teacher' || role === 'student' ? role : null)

/** Where a dashboard's notifications page lives. */
export const notificationsPath = (role: DashboardRole) => `/${role}/notifications`

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)

/**
 * The page a notification opens, for the reader's dashboard. One event reaches several roles (a check-in goes to the
 * teacher, a new enrollment to the teacher and the center, a registration to the owner), so the target depends on who
 * is reading. Unknown types open the notifications page itself.
 */
export function notificationHref(n: Pick<AppNotification, 'type' | 'params'>, role: DashboardRole): string {
  const p = (n.params ?? {}) as Record<string, unknown>
  const centerId = str(p.centerId)
  const groupId = str(p.groupId)
  const date = str(p.date)
  const teacherGroup = groupId ? `/teacher/groups/${groupId}` : '/teacher/groups'
  const centerDay = date ? `/center/attendance?date=${date}` : '/center/attendance'
  const [kind] = n.type.split('.')
  switch (kind) {
    case 'center':
      if (role === 'admin') return centerId ? `/admin/centers/${centerId}` : '/admin/centers'
      if (role === 'teacher') return '/teacher'
      return '/center'
    case 'attendance':
      if (role === 'student') return '/student/attendance'
      if (role === 'teacher') return teacherGroup
      if (role === 'center') return centerDay
      return centerId ? `/admin/centers/${centerId}?tab=attendance${date ? `&date=${date}` : ''}` : '/admin/centers'
    case 'schedule':
      if (role === 'student') return '/student/timetable'
      if (role === 'teacher') return teacherGroup
      if (role === 'center') return centerDay
      return '/admin/courses'
    case 'enrollment':
      if (role === 'teacher') return teacherGroup
      if (role === 'center') return '/center/students'
      if (role === 'student') return '/student/courses'
      return '/admin/people'
    case 'refund':
      // A finance admin opens the request in the refunds queue (security review 10.11 №42); the student their subscription.
      if (role === 'admin') return str(p.queuePath)?.startsWith('/admin/finance') ? str(p.queuePath)! : '/admin/finance'
      return role === 'student' ? '/student/subscription' : notificationsPath(role)
    case 'vacancy':
      // An institution sent its students a vacancy (ТЗ «Вакансии у учреждения», 3.2).
      return role === 'student' ? '/student/vacancies' : notificationsPath(role)
    case 'contact':
      // A company asks for the student's contacts (ТЗ 5.1, 5.3): the student answers in «Запросы от компаний».
      return role === 'student' ? '/student/requests' : notificationsPath(role)
    case 'subscription':
    case 'payment':
      return role === 'student' ? '/student/subscription' : role === 'admin' ? '/admin/finance' : notificationsPath(role)
    default:
      return notificationsPath(role)
  }
}
