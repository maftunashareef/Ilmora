import { Link } from '@/lib/router'
import { DashboardShell, type DashNavItem } from '../../components/layout/DashboardShell'
import { Icon } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { useCurrentTeacher } from '../../store/selectors'
import { useStore } from '../../store/useStore'

export function TeacherLayout() {
  const { t } = useT()
  const teacher = useCurrentTeacher()
  const modules = useStore((s) => s.site.dashboards.teacher)
  const all: DashNavItem[] = [
    { id: 'overview', to: '/teacher', end: true, label: t('dash.overview'), icon: 'grid' },
    { id: 'subjects', to: '/teacher/subjects', label: t('studio.subjects'), icon: 'book' },
    { id: 'videos', to: '/teacher/videos', label: t('studio.videos'), icon: 'video' },
    { id: 'playlists', to: '/teacher/playlists', label: t('studio.playlists'), icon: 'list' },
    { id: 'resources', to: '/teacher/resources', label: t('studio.resources'), icon: 'file' },
    { id: 'groups', to: '/teacher/groups', label: t('studio.groups'), icon: 'calendar' },
    { id: 'channel', to: '/teacher/channel', label: t('studio.channel'), icon: 'palette' },
    { id: 'visibility', to: '/teacher/visibility', label: t('studio.visibility'), icon: 'eye' },
  ]
  const items = all.filter((it) => modules.find((m) => m.id === it.id)?.enabled ?? true)
  return (
    <DashboardShell role="teacher" title={t('dash.teacherStudio')} subtitle={teacher?.name} items={items} extra={
      teacher && <Link to={`/teachers/${teacher.id}`} className="flex items-center gap-2 rounded-control border border-charcoal/10 px-3 py-2 text-xs font-medium text-charcoal/70 hover:border-forest/40 hover:text-forest"><Icon name="external" className="h-3.5 w-3.5" />{t('dash.viewChannel')}</Link>
    } />
  )
}
