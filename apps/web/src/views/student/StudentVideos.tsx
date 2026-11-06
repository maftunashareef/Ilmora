import { useEffect, useState } from 'react'
import { EmptyState, Eyebrow, Icon, PageTitle, Segmented } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { checkAccess } from '../../lib/access'
import { resolveGroups } from '../../lib/schedule'
import { useCurrentStudent, useViewer } from '../../store/selectors'
import { useStore } from '../../store/useStore'
import { PlaylistCard, VideoCard } from '../public/TeacherChannel'

type Filter = 'mine' | 'assigned' | 'all'

export function StudentVideos() {
  const { t } = useT()
  const student = useCurrentStudent()
  const viewer = useViewer()
  const s = useStore()
  const [filter, setFilter] = useState<Filter>('mine')
  // The lists come from /public/content (public items plus what was shared with this student); the store reloads them on sign-in.
  const { contentStatus, loadPublicContent } = s
  useEffect(() => { if (contentStatus === 'idle') void loadPublicContent() }, [contentStatus, loadPublicContent])
  if (!student) return null
  const groups = resolveGroups(student.subscription.status === 'active' ? student.subscription.groupIds : [], s.courses)
  const myTeacherIds = new Set(groups.map((g) => s.courses.find((c) => c.id === g.courseId)?.teacherId))
  const pass = (item: { teacherId: string; visibility: string } & Parameters<typeof checkAccess>[0]) => {
    const a = checkAccess(item, viewer)
    if (!a.allowed) return false
    if (filter === 'assigned') return a.reason === 'assigned-group' || a.reason === 'assigned-student'
    if (filter === 'mine') return a.reason !== 'public' || myTeacherIds.has(item.teacherId)
    return true
  }
  const videos = s.videos.filter(pass)
  const playlists = s.playlists.filter(pass)
  return (
    <div>
      <PageTitle eyebrow={t('dash.studentSpace')} title={t('student.videos')} subtitle={t('channel.privateHint')} action={<Segmented<Filter> size="sm" value={filter} onChange={setFilter} options={[{ id: 'mine', label: t('student.ownMaterials') }, { id: 'assigned', label: t('student.assignedOnly') }, { id: 'all', label: t('common.all') }]} />} />
      {contentStatus !== 'ready' ? (
        <div className="flex min-h-[30vh] items-center justify-center text-sm text-charcoal/55" role="status" aria-live="polite"><Icon name="refresh" className="mr-2 h-4 w-4 animate-spin" /> {t('common.loading')}</div>
      ) : videos.length === 0 && playlists.length === 0 ? <EmptyState title={t('student.videos.empty')} /> : (
        <div className="space-y-10">
          {playlists.length > 0 && <section><Eyebrow className="mb-4">{t('common.playlists')}</Eyebrow><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{playlists.map((p) => <PlaylistCard key={p.id} p={p} videos={s.videos} />)}</div></section>}
          {videos.length > 0 && <section><Eyebrow className="mb-4">{t('common.videos')}</Eyebrow><div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{videos.map((v) => <VideoCard key={v.id} v={v} />)}</div></section>}
        </div>
      )}
    </div>
  )
}
