import { Link } from 'react-router-dom'
import { Timetable } from '../../components/Timetable'
import { Card, Eyebrow, Icon, Notice, PageTitle, Stat } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { useCurrentTeacher } from '../../store/selectors'
import { useStore } from '../../store/useStore'

export function StudioOverview() {
  const { t, tr } = useT()
  const teacher = useCurrentTeacher()
  const s = useStore()
  const mine = [...s.courses, ...s.videos, ...s.playlists, ...s.resources].filter((x) => x.teacherId === teacher?.id)
  const myCourses = s.courses.filter((c) => c.teacherId === teacher?.id)
  const groups = myCourses.flatMap((c) => c.groups)
  const groupIds = new Set(groups.map((g) => g.id))
  const studentsInGroups = s.students.filter((st) => st.subscription.status === 'active' && st.subscription.groupIds.some((g) => groupIds.has(g))).length
  const anns = s.site.announcements.filter((a) => a.enabled && (a.audience === 'all' || a.audience === 'teachers'))
  const quick = [
    { to: '/teacher/videos?new=1', label: t('studio.newVideo'), icon: 'video' },
    { to: '/teacher/resources?new=1', label: t('studio.newResource'), icon: 'file' },
    { to: '/teacher/playlists?new=1', label: t('studio.newPlaylist'), icon: 'list' },
    { to: '/teacher/subjects?new=1', label: t('studio.newCourse'), icon: 'book' },
  ]
  return (
    <div>
      <PageTitle eyebrow={t('dash.teacherStudio')} title={<>{t('studio.overview.hello')} {teacher?.name}</>} subtitle={t('studio.overview.body')} />
      <div className="reveal-stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={t('studio.stat.public')} value={mine.filter((x) => x.status === 'published' && x.visibility === 'public').length} />
        <Stat label={t('studio.stat.private')} value={mine.filter((x) => x.status === 'published' && x.visibility === 'private').length} />
        <Stat label={t('studio.stat.drafts')} value={mine.filter((x) => x.status === 'draft').length} hint={mine.some((x) => x.reviewRequested) ? t('studio.reviewPending') : undefined} />
        <Stat label={t('studio.stat.students')} value={studentsInGroups} hint={`${groups.length} ${t('common.groups').toLowerCase()}`} />
      </div>
      {s.site.features.announcements && anns.length > 0 && (
        <div className="mt-6 grid gap-3 md:grid-cols-2">{anns.map((a) => <Notice key={a.id} tone="info"><span className="font-medium">{tr(a.title)}</span> — {tr(a.body)}</Notice>)}</div>
      )}
      <div className="mt-10 grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
        <section>
          <Eyebrow className="mb-4">{t('admin.overview.quick')}</Eyebrow>
          <div className="grid gap-3 sm:grid-cols-2">
            {quick.map((q) => (
              <Link key={q.to} to={q.to} className="card group flex items-center gap-3 p-4 transition hover:-translate-y-0.5 hover:shadow-lift">
                <span className="flex h-10 w-10 items-center justify-center rounded-control bg-sage text-forest"><Icon name={q.icon} className="h-5 w-5" /></span>
                <span className="text-sm font-medium text-charcoal group-hover:text-forest">{q.label}</span>
              </Link>
            ))}
          </div>
          <Card className="mt-4 text-xs text-charcoal/60">
            <div className="mb-2 flex items-center gap-2 text-charcoal"><Icon name="lock" className="h-4 w-4 text-champagne" /><span className="font-medium">{t('vis.chooseTitle')}</span></div>
            <p>{t('vis.publicHint')}</p><p className="mt-1.5">{t('vis.privateHint')}</p><p className="mt-1.5">{t('status.draftHint')}</p>
          </Card>
        </section>
        <section>
          <Eyebrow className="mb-4">{t('studio.mySchedule')}</Eyebrow>
          <Timetable groups={groups} courses={myCourses} compact />
        </section>
      </div>
    </div>
  )
}
