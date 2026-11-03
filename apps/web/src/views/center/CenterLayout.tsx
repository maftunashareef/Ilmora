'use client'
import { DashboardShell } from '../../components/layout/DashboardShell'
import { useT } from '../../i18n/useT'

/** Workspace of an Educational Center: its teachers, courses with groups and schedules, lessons and attendance, students, QR and settings. */
export function CenterLayout() {
  const { t } = useT()
  return (
    <DashboardShell role="center" title={t('dash.center')} subtitle={t('center.subtitle')} items={[
      { id: 'overview', to: '/center', end: true, label: t('dash.overview'), icon: 'grid' },
      { id: 'notifications', to: '/center/notifications', label: t('notif.title'), icon: 'bell' },
      { id: 'courses', to: '/center/courses', label: t('center.courses'), icon: 'book' },
      { id: 'teachers', to: '/center/teachers', label: t('center.teachers'), icon: 'users' },
      { id: 'attendance', to: '/center/attendance', label: t('center.attendance'), icon: 'check' },
      { id: 'students', to: '/center/students', label: t('center.students'), icon: 'user' },
      { id: 'settings', to: '/center/settings', label: t('center.settings'), icon: 'settings' },
    ]} />
  )
}
