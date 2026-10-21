import { Timetable } from '../../components/Timetable'
import { Card, EmptyState, LinkButton, PageTitle } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { expandLessons, lessonsPerWeek, resolveGroups, weeklyHours } from '../../lib/schedule'
import { useCurrentStudent } from '../../store/selectors'
import { useStore } from '../../store/useStore'

export function StudentTimetable() {
  const { t, tr } = useT()
  const student = useCurrentStudent()
  const courses = useStore((s) => s.courses)
  if (!student) return null
  const groups = resolveGroups(student.subscription.status === 'active' ? student.subscription.groupIds : [], courses)
  const lessons = expandLessons(groups, courses)
  return (
    <div>
      <PageTitle eyebrow={t('dash.studentSpace')} title={t('student.timetable')} subtitle={groups.length ? `${lessonsPerWeek(groups)} ${t('student.lessonsPerWeek')} · ${weeklyHours(groups)} ${t('preview.hoursPerWeek')}` : undefined} />
      {groups.length === 0 ? <EmptyState title={t('student.timetable.empty')} action={<LinkButton to="/builder">{t('student.overview.buildOne')}</LinkButton>} /> : (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_0.6fr]">
          <Timetable groups={groups} courses={courses} />
          <div className="space-y-2">
            {[0, 1, 2, 3, 4, 5, 6].map((d) => {
              const day = lessons.filter((l) => l.day === d)
              if (!day.length) return null
              return (
                <Card key={d} className="p-4">
                  <div className="eyebrow mb-2">{t(`day.${d}` as 'day.0')}</div>
                  <ul className="space-y-1.5 text-sm">{day.map((l, i) => <li key={i} className="flex items-baseline gap-3"><span className="w-24 shrink-0 text-xs text-charcoal/55">{l.start}–{l.end}</span><span className="text-charcoal">{tr(l.course.title)}<span className="ml-1 text-xs text-charcoal/45">· {l.group.room}</span></span></li>)}</ul>
                </Card>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
