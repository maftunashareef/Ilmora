import { useEffect, useState } from 'react'
import { DashboardShell, type DashNavItem } from '../../components/layout/DashboardShell'
import { Icon } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { pendingInvite } from '../../lib/pendingInvite'
import { Link } from '../../lib/router'
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
    { id: 'homework', to: '/student/homework', label: t('hw.mine'), icon: 'edit' },
    { id: 'centers', to: '/student/centers', label: t('mycenters.title'), icon: 'building' },
    { id: 'saved', to: '/student/saved', label: t('student.saved'), icon: 'bookmark' },
    { id: 'profile', to: '/student/profile', label: t('student.profile'), icon: 'user' },
  ]
  const items = all.filter((it) => (modules.find((m) => m.id === it.id)?.enabled ?? true) && (it.id !== 'saved' || savedOn))
  // A center's invitation opened before signing up waits in this tab: the way back to it (ТЗ 2026-11-18, 4.3).
  const [invited, setInvited] = useState(false)
  useEffect(() => { setInvited(pendingInvite.has()) }, [])
  const extra = invited ? <Link to="/invite" className="flex items-center gap-2 rounded-control border border-forest/30 bg-sage/60 px-3 py-2 text-xs font-medium text-forest"><Icon name="bell" className="h-3.5 w-3.5" />{t('invite.pending')}</Link> : undefined
  return <DashboardShell role="student" title={t('dash.studentSpace')} subtitle={student?.profile.displayName} items={items} extra={extra} />
}
