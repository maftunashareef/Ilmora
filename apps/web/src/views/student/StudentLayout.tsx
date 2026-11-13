import { DashboardShell, type DashNavItem } from '../../components/layout/DashboardShell'
import { useT } from '../../i18n/useT'
import { useCurrentStudent } from '../../store/selectors'
import { useStore } from '../../store/useStore'

export function StudentLayout() {
  const { t } = useT()
  const student = useCurrentStudent()
  const modules = useStore((s) => s.site.dashboards.student)
  const savedOn = useStore((s) => s.site.features.savedItems)
  const all: DashNavItem[] = [
    { id: 'overview', to: '/student', end: true, label: t('dash.overview'), icon: 'grid' },
    { id: 'questionnaire', to: '/student/questionnaire', label: t('q.title'), icon: 'edit' },
    { id: 'contract-help', to: '/student/contract-help', label: t('st.h.title'), icon: 'shield' },
    { id: 'vacancies', to: '/student/vacancies', label: t('st.v.title'), icon: 'briefcase' },
    { id: 'requests', to: '/student/requests', label: t('st.r.title'), icon: 'chat' },
    { id: 'consents', to: '/student/consents', label: t('st.c.title'), icon: 'lock' },
    { id: 'notifications', to: '/student/notifications', label: t('notif.title'), icon: 'bell' },
    { id: 'subscription', to: '/student/subscription', label: t('student.subscription'), icon: 'package' },
    { id: 'courses', to: '/student/courses', label: t('student.courses'), icon: 'book' },
    { id: 'timetable', to: '/student/timetable', label: t('student.timetable'), icon: 'calendar' },
    { id: 'videos', to: '/student/videos', label: t('student.videos'), icon: 'video' },
    { id: 'resources', to: '/student/resources', label: t('student.resources'), icon: 'file' },
    { id: 'attendance', to: '/student/attendance', label: t('student.attendance'), icon: 'check' },
    { id: 'saved', to: '/student/saved', label: t('student.saved'), icon: 'bookmark' },
    { id: 'profile', to: '/student/profile', label: t('student.profile'), icon: 'user' },
  ]
  const items = all.filter((it) => (modules.find((m) => m.id === it.id)?.enabled ?? true) && (it.id !== 'saved' || savedOn))
  return <DashboardShell role="student" title={t('dash.studentSpace')} subtitle={student?.profile.displayName} items={items} />
}
