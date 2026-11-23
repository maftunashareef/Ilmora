'use client'
import { DashboardShell, type DashNavItem } from '../../components/layout/DashboardShell'
import { useT } from '../../i18n/useT'
import { Navigate } from '../../lib/router'
import { useLocation } from '../../lib/routerHooks'
import { isCenterManagerOnly, managerOpens } from '../../lib/workspaceHome'
import { useStore } from '../../store/useStore'

/** Workspace of an Educational Center: its teachers, courses with groups and schedules, lessons and attendance, students, QR and settings. */
export function CenterLayout() {
  const { t } = useT()
  const roles = useStore((s) => s.auth.user?.roles ?? [])
  const { pathname } = useLocation()
  const all: DashNavItem[] = [
    { id: 'overview', to: '/center', end: true, label: t('dash.overview'), icon: 'grid' },
    { id: 'notifications', to: '/center/notifications', label: t('notif.title'), icon: 'bell' },
    { id: 'courses', to: '/center/courses', label: t('center.courses'), icon: 'book' },
    { id: 'teachers', to: '/center/teachers', label: t('center.teachers'), icon: 'users' },
    { id: 'attendance', to: '/center/attendance', label: t('center.attendance'), icon: 'check' },
    { id: 'students', to: '/center/students', label: t('center.students'), icon: 'user' },
    { id: 'journal', to: '/center/journal', label: t('journal.title'), icon: 'list' },
    { id: 'settings', to: '/center/settings', label: t('center.settings'), icon: 'settings' },
  ]
  // The center's manager (№15): the students' table and the journal only; any other page of the workspace leads there.
  const manager = isCenterManagerOnly(roles)
  if (manager && !managerOpens(pathname)) return <Navigate to="/center/students" />
  const items = manager ? all.filter((it) => managerOpens(it.to)) : all
  return <DashboardShell role="center" title={t('dash.center')} subtitle={manager ? t('center.managerSubtitle') : t('center.subtitle')} items={items} />
}
