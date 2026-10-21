import { Link } from '@/lib/router'
import { ScheduleChips } from '../../components/course/CourseCard'
import { ArtCover, Avatar, Badge, EmptyState, Icon, LinkButton, Notice, PageTitle } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { formatSom } from '../../lib/format'
import { resolveGroups } from '../../lib/schedule'
import { useCurrentStudent } from '../../store/selectors'
import { useStore } from '../../store/useStore'

export function StudentCourses() {
  const { t, tr, lang } = useT()
  const student = useCurrentStudent()
  const s = useStore()
  const switchOn = s.site.permissions.student.switchGroups
  if (!student) return null
  const groups = resolveGroups(student.subscription.status === 'active' ? student.subscription.groupIds : [], s.courses)
  return (
    <div>
      <PageTitle eyebrow={t('dash.studentSpace')} title={t('student.courses')} />
      {groups.length === 0 ? <EmptyState title={t('student.overview.noSub')} action={<LinkButton to="/builder">{t('student.overview.buildOne')}</LinkButton>} /> : (
        <div className="grid gap-5 md:grid-cols-2">
          {groups.map((g) => {
            const c = s.courses.find((x) => x.id === g.courseId)!
            const te = s.teachers.find((x) => x.id === c.teacherId)
            const center = s.centers.find((x) => x.id === c.centerId)
            return (
              <article key={g.id} className="card overflow-hidden p-0">
                <ArtCover seed={c.coverSeed} tone={center?.tone} imageUrl={c.imageUpload?.previewUrl || c.imageUrl} className="aspect-[16/6] w-full" />
                <div className="p-5">
                  <div className="flex flex-wrap items-center gap-2"><Badge tone="sage">{tr(s.categories.find((x) => x.id === c.categoryId)?.name)}</Badge><Badge tone="forest">{t('student.myGroup')}: {g.name}</Badge></div>
                  <h2 className="mt-3 font-display text-2xl text-charcoal"><Link to={`/courses/${c.id}`} className="hover:text-forest">{tr(c.title)}</Link></h2>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-charcoal/55"><span>{center?.name}</span><span>{t('common.room')} {g.room}</span><span>{formatSom(c.price, lang)} {t('common.perMonth')}</span></div>
                  <div className="mt-3"><ScheduleChips group={g} /></div>
                  {te && (
                    <div className="mt-4 flex items-center gap-3 border-t border-charcoal/10 pt-4">
                      <Avatar name={te.name} seed={te.avatarSeed} size={36} url={te.avatarUpload?.previewUrl} />
                      <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-charcoal">{te.name}</div><div className="truncate text-xs text-charcoal/55">{tr(te.title)}</div></div>
                      {s.site.features.teacherChannels && te.channelActive && <Link to={`/teachers/${te.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-forest">{t('courses.seeChannel')} <Icon name="arrowRight" className="h-3.5 w-3.5" /></Link>}
                    </div>
                  )}
                  {c.groups.length > 1 && (
                    <div className="mt-3 text-[11px] text-charcoal/50">{switchOn ? <Link to="/student/subscription" className="text-forest underline">{t('builder.changeGroup')}</Link> : <><Icon name="lock" className="mr-1 inline h-3 w-3" />{t('studio.lockedByAdmin')}: {t('perm.student.switchGroups')}</>}</div>
                  )}
                </div>
              </article>
            )
          })}
        </div>
      )}
      <Notice tone="info" className="mt-6 text-xs">{t('vis.enrollmentNote')}</Notice>
    </div>
  )
}
