import { billedSom } from '@ilmora/shared'
import { Link } from '@/lib/router'
import { FormatBadge, ScheduleChips } from '../../components/course/CourseCard'
import { Badge, Card, EmptyState, Eyebrow, Icon, LinkButton, Notice, PageTitle, Stat } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { checkAccess } from '../../lib/access'
import { formatDate, formatSom } from '../../lib/format'
import { expandLessons, resolveGroups, upcomingLessons } from '../../lib/schedule'
import { useCurrentStudent, useViewer } from '../../store/selectors'
import { useStore } from '../../store/useStore'
import { OnlineCoursesSection } from './OnlineCourses'

export function StudentOverview() {
  const { t, tr, lang } = useT()
  const student = useCurrentStudent()
  const viewer = useViewer()
  const s = useStore()
  if (!student) return null
  const active = student.subscription.status === 'active'
  const groups = resolveGroups(student.subscription.groupIds, s.courses)
  const lessons = expandLessons(groups, s.courses)
  const upcoming = upcomingLessons(lessons, 4)
  const pkg = s.site.packages.find((p) => p.id === student.subscription.packageId)
  // What is billed each period is fixed at checkout (discounts included); demo data without it falls back to list prices.
  const total = billedSom(student.subscription.amountMinor) ?? groups.reduce((n, g) => n + (s.courses.find((c) => c.id === g.courseId)?.price ?? 0), 0)
  const myTeacherIds = new Set(groups.map((g) => s.courses.find((c) => c.id === g.courseId)?.teacherId))
  const videos = s.videos.filter((v) => { const a = checkAccess(v, viewer); return a.allowed && (a.reason !== 'public' || myTeacherIds.has(v.teacherId)) })
  const resources = s.resources.filter((r) => { const a = checkAccess(r, viewer); return a.allowed && (a.reason !== 'public' || myTeacherIds.has(r.teacherId)) })
  const assigned = [...videos, ...resources].filter((x) => x.visibility === 'private').length
  const anns = s.site.announcements.filter((a) => a.enabled && (a.audience === 'all' || a.audience === 'students'))

  return (
    <div>
      <PageTitle eyebrow={t('dash.studentSpace')} title={<>{t('student.overview.hello')} {student.profile.displayName}</>} subtitle={active && pkg ? `${tr(pkg.name)} · ${groups.length} ${t('common.courses').toLowerCase()} · ${formatSom(total, lang)} ${t('common.perMonth')}` : t('student.overview.noSub')} action={!active && <LinkButton to="/builder">{t('student.overview.buildOne')} <Icon name="arrowRight" className="h-4 w-4" /></LinkButton>} />
      {s.site.features.announcements && anns.length > 0 && <div className="mb-6 grid gap-3 md:grid-cols-2">{anns.map((a) => <Notice key={a.id} tone="info"><span className="font-medium">{tr(a.title)}</span> — {tr(a.body)}</Notice>)}</div>}
      {!active ? (
        <EmptyState title={t('student.overview.noSub')} body={t('builder.subtitle')} action={<LinkButton to="/builder">{t('student.overview.buildOne')}</LinkButton>} />
      ) : (
        <>
          <div className="reveal-stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={t('student.sub.package')} value={pkg ? tr(pkg.name) : '—'} hint={`${groups.length}/${pkg?.maxCourses ?? 0} ${t('builder.slots')}`} />
            <Stat label={t('builder.monthlyTotal')} value={formatSom(total, lang, false)} hint={`${t('common.som')} ${t('common.perMonth')}`} />
            <Stat label={t('student.sub.renews')} value={formatDate(student.subscription.renewsAt, lang)} />
            <Stat label={t('student.overview.newMaterials')} value={videos.length + resources.length} hint={`${assigned} ${t('access.privateBadge').toLowerCase()}`} />
          </div>
          <div className="mt-10 grid gap-8 lg:grid-cols-[1.1fr_0.9fr]">
            <section>
              <div className="mb-4 flex items-center justify-between"><Eyebrow>{t('student.overview.upcoming')}</Eyebrow><Link to="/student/timetable" className="text-xs font-medium text-forest">{t('student.timetable')} →</Link></div>
              <ul className="space-y-2.5">
                {upcoming.map((l, i) => (
                  <li key={`${l.group.id}-${l.day}-${i}`} className="card group flex items-center gap-4 p-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lift hover:border-forest/30">
                    <div className="w-14 shrink-0 text-center">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-charcoal/50 flex items-center justify-center gap-1">
                        {l.inDays === 0 ? <><span className="h-1.5 w-1.5 rounded-full bg-forest animate-ping" />{t('common.today')}</> : t(`dayShort.${l.day}` as 'dayShort.0')}
                      </div>
                      <div className="font-display text-2xl text-charcoal group-hover:text-forest transition-colors">{l.start}</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <Link to={`/courses/${l.course.id}`} className="truncate font-medium text-charcoal hover:text-forest block transition-colors">
                        {tr(l.course.title)}
                      </Link>
                      <div className="mt-0.5 text-xs text-charcoal/60">{l.group.name} · {t('common.room')} {l.group.room} · {l.start}–{l.end}</div>
                    </div>
                    {i === 0 && <Badge tone="champagne">{t('student.nextLesson')}</Badge>}
                  </li>
                ))}
              </ul>
            </section>
            <section>
              <div className="mb-4 flex items-center justify-between"><Eyebrow>{t('student.courses')}</Eyebrow><Link to="/student/courses" className="text-xs font-medium text-forest">{t('common.all')} →</Link></div>
              <ul className="space-y-2.5">
                {groups.map((g) => { const c = s.courses.find((x) => x.id === g.courseId)!; const te = s.teachers.find((x) => x.id === c.teacherId); return (
                  <li key={g.id} className="card group p-4 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-lift hover:border-champagne/40">
                    <div className="mb-1"><FormatBadge course={c} /></div>
                    <Link to={`/courses/${c.id}`} className="font-medium text-charcoal group-hover:text-forest block transition-colors">{tr(c.title)}</Link>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-charcoal/60"><span>{te?.name}</span><ScheduleChips group={g} compact /></div>
                  </li>
                ) })}
              </ul>
              <Card className="mt-4 p-4 text-xs text-charcoal/60 bg-paper/60 border-dashed border-charcoal/15">{t('preview.renewalNote')}</Card>
            </section>
          </div>
        </>
      )}
      <OnlineCoursesSection />
    </div>
  )
}
