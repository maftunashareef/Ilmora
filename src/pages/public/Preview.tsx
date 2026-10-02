import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ScheduleChips } from '../../components/course/CourseCard'
import { Timetable } from '../../components/Timetable'
import { Badge, Button, Card, EmptyState, Eyebrow, Icon, LinkButton, Notice, PageTitle } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { formatSom } from '../../lib/format'
import { findConflicts, lessonsPerWeek, resolveGroups, weeklyHours } from '../../lib/schedule'
import { useCurrentStudent } from '../../store/selectors'
import { useStore } from '../../store/useStore'

export function PreviewPage() {
  const { t, tr, lang } = useT()
  const nav = useNavigate()
  const student = useCurrentStudent()
  const packages = useStore((s) => s.site.packages)
  const courses = useStore((s) => s.courses)
  const centers = useStore((s) => s.centers)
  const activate = useStore((s) => s.activateSubscription)
  const setRole = useStore((s) => s.setRole)
  const notify = useStore((s) => s.notify)
  const [done, setDone] = useState(false)

  const pkg = packages.find((p) => p.id === student?.builder.packageId)
  const groups = resolveGroups(student?.builder.groupIds ?? [], courses)
  const conflicts = findConflicts(groups)
  const total = groups.reduce((n, g) => n + (courses.find((c) => c.id === g.courseId)?.price ?? 0), 0)
  const ok = !!pkg && groups.length === pkg.maxCourses && conflicts.length === 0

  if (!student || !pkg || groups.length === 0) {
    return (
      <div className="container-x py-16">
        <EmptyState title={t('preview.emptyTitle')} body={t('preview.emptyBody')} action={<LinkButton to="/builder">{t('builder.title')}</LinkButton>} />
      </div>
    )
  }

  if (done) {
    return (
      <div className="container-x py-16">
        <Card className="mx-auto max-w-xl px-8 py-12 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-forest text-ivory"><Icon name="check" className="h-6 w-6" /></div>
          <h1 className="font-display text-4xl text-charcoal">{t('preview.activated')}</h1>
          <p className="mt-3 text-charcoal/65">{t('preview.activatedBody')}</p>
          <p className="mt-2 text-xs text-charcoal/45">{t('preview.renewalNote')}</p>
          <Button size="lg" className="mt-8" onClick={() => nav('/student')}>{t('preview.goToDashboard')} <Icon name="arrowRight" className="h-4 w-4" /></Button>
        </Card>
      </div>
    )
  }

  return (
    <div className="container-x py-12 lg:py-16">
      <PageTitle eyebrow={t('builder.step3')} title={t('preview.title')} subtitle={t('preview.subtitle')} action={<LinkButton to="/builder" variant="secondary"><Icon name="arrowLeft" className="h-4 w-4" />{t('preview.editSelection')}</LinkButton>} />
      <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <Timetable groups={groups} courses={courses} conflicts={conflicts} />
          <ul className="grid gap-3 sm:grid-cols-2">
            {groups.map((g) => {
              const c = courses.find((x) => x.id === g.courseId)!
              const center = centers.find((x) => x.id === c.centerId)
              return (
                <li key={g.id} className="card p-4">
                  <Link to={`/courses/${c.id}`} className="font-display text-xl text-charcoal hover:text-forest">{tr(c.title)}</Link>
                  <div className="mt-1 text-xs text-charcoal/55">{center?.name} · {g.name} · {t('common.room')} {g.room}</div>
                  <div className="mt-2"><ScheduleChips group={g} /></div>
                  <div className="mt-3 text-sm font-medium text-charcoal">{formatSom(c.price, lang)} <span className="text-xs font-normal text-charcoal/50">{t('common.perMonth')}</span></div>
                </li>
              )
            })}
          </ul>
        </div>
        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card className="p-6">
            <div className="flex items-center justify-between"><Eyebrow>{t('student.sub.package')}</Eyebrow><Badge tone="sage">{tr(pkg.name)}</Badge></div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <div><dt className="text-charcoal/50">{t('common.courses')}</dt><dd className="mt-0.5 font-medium text-charcoal">{groups.length} / {pkg.maxCourses}</dd></div>
              <div><dt className="text-charcoal/50">{t('common.week')}</dt><dd className="mt-0.5 font-medium text-charcoal">{lessonsPerWeek(groups)} {t('student.lessonsPerWeek')} · {weeklyHours(groups)} h</dd></div>
            </dl>
            <div className="mt-5 flex items-end justify-between border-t border-charcoal/10 pt-4">
              <span className="text-sm text-charcoal/60">{t('builder.monthlyTotal')}</span>
              <span className="font-display text-3xl text-charcoal">{formatSom(total, lang)}</span>
            </div>
            <p className="mt-2 text-[11px] text-charcoal/45">{t('builder.transparent')}</p>
            <div className="mt-5 space-y-2">
              {conflicts.length > 0 ? <Notice tone="warn">{t('preview.fixIssues')}: {t('builder.conflict')}</Notice> : <Notice tone="info"><Icon name="check" className="mr-1 inline h-3.5 w-3.5" />{t('builder.noConflicts')}</Notice>}
              <Notice tone="info" className="text-xs">{t('preview.paymentNote')}</Notice>
            </div>
            <Button size="lg" className="mt-5 w-full" disabled={!ok} onClick={() => { if (activate(student.id)) { setRole('student'); setDone(true); notify(t('preview.activated')) } }}>
              {t('preview.activate')}
            </Button>
            <p className="mt-3 text-center text-[11px] text-charcoal/45">{t('preview.renewalNote')}</p>
          </Card>
        </aside>
      </div>
    </div>
  )
}
