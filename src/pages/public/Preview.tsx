import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ScheduleChips } from '../../components/course/CourseCard'
import { Timetable } from '../../components/Timetable'
import { Badge, Button, Card, cx, EmptyState, Eyebrow, Icon, LinkButton, Notice, PageTitle } from '../../components/ui'
import type { TKey } from '../../i18n/translations'
import { useT } from '../../i18n/useT'
import { enrolledCount, isGroupFull } from '../../lib/enrollment'
import { formatSom } from '../../lib/format'
import { findConflicts, lessonsPerWeek, resolveGroups, weeklyHours } from '../../lib/schedule'
import { useCurrentStudent } from '../../store/selectors'
import { useStore } from '../../store/useStore'

export function PreviewPage() {
  const { t, tr, lang } = useT()
  const nav = useNavigate()
  const student = useCurrentStudent()
  const packages = useStore((s) => s.site.packages)
  const payments = useStore((s) => s.site.payments)
  const courses = useStore((s) => s.courses)
  const centers = useStore((s) => s.centers)
  const students = useStore((s) => s.students)
  const activate = useStore((s) => s.activateSubscription)
  const setBuilderGrant = useStore((s) => s.setBuilderGrant)
  const setRole = useStore((s) => s.setRole)
  const notify = useStore((s) => s.notify)
  const [done, setDone] = useState(false)

  const pkg = packages.find((p) => p.id === student?.builder.packageId)
  const groups = resolveGroups(student?.builder.groupIds ?? [], courses)
  const conflicts = findConflicts(groups)
  const total = groups.reduce((n, g) => n + (courses.find((c) => c.id === g.courseId)?.price ?? 0), 0)
  const fullGroups = groups.filter((g) => isGroupFull(g, students, student?.id))
  const ok = !!pkg && groups.length === pkg.maxCourses && conflicts.length === 0 && fullGroups.length === 0
  // Grant funding is offered only when the selection contains a grant-eligible course (Bazis).
  const grantCourses = groups.map((g) => courses.find((c) => c.id === g.courseId)).filter((c): c is NonNullable<typeof c> => !!c?.meyosGrant)
  const methods = payments.methods.filter((m) => m.enabled)
  const method = methods[0]

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

  const onActivate = () => {
    const r = activate(student.id)
    if (r.ok) { setRole('student'); setDone(true); notify(t('preview.activated')); return }
    if (r.reason === 'full') {
      const g = groups.find((x) => x.id === r.groupId)
      notify(`${t('capacity.full')}${g ? ` — ${tr(courses.find((c) => c.id === g.courseId)?.title)} · ${g.name}` : ''}. ${t('capacity.fullHint')}`, 'warn')
    } else notify(t('preview.fixIssues'), 'warn')
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
              const full = isGroupFull(g, students, student.id)
              return (
                <li key={g.id} className={cx('card p-4', full && 'border-amber-300')}>
                  <Link to={`/courses/${c.id}`} className="font-display text-xl text-charcoal hover:text-forest">{tr(c.title)}</Link>
                  <div className="mt-1 text-xs text-charcoal/55">{center?.name} · {g.name} · {t('common.room')} {g.room}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2"><ScheduleChips group={g} /><Badge tone={full ? 'warn' : 'muted'}>{t('capacity.students', { n: enrolledCount(students, g.id, student.id), max: g.capacity })}</Badge></div>
                  {full && <div className="mt-2 text-xs text-amber-800">{t('capacity.full')} — {t('capacity.fullHint')}</div>}
                  <div className="mt-3 text-sm font-medium text-charcoal">{formatSom(c.price, lang)} <span className="text-xs font-normal text-charcoal/50">{t('common.perMonth')}</span></div>
                </li>
              )
            })}
          </ul>

          {/* Payment: card is the only enabled method; the config keeps room for more later. */}
          <Card>
            <div className="flex items-center justify-between gap-3"><Eyebrow>{t('payment.title')}</Eyebrow><Badge tone="muted">{t('payment.simulated')}</Badge></div>
            <div className="mt-4 text-sm font-medium text-charcoal">{t('payment.method')}</div>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {methods.map((m) => (
                <label key={m.id} className="flex cursor-pointer items-center gap-3 rounded-control border border-forest bg-sage/40 px-4 py-3 text-sm ring-inset-forest">
                  <input type="radio" name="payment" className="accent-forest" checked readOnly />
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-forest text-ivory"><Icon name="package" className="h-4 w-4" /></span>
                  <span className="font-medium text-charcoal">{t(`payment.${m.id}` as TKey)}</span>
                </label>
              ))}
            </div>
            <p className="mt-3 text-xs text-charcoal/55">{t('payment.onlyCard')}</p>
            <Notice tone="info" className="mt-3 text-xs">{t('payment.cardNote')}</Notice>

            {grantCourses.length > 0 && (
              <div className="mt-5 border-t border-charcoal/10 pt-5">
                <label className={cx('flex cursor-pointer items-start gap-3 rounded-card border p-4 transition', student.builder.meyosGrant ? 'border-champagne bg-champagne/15' : 'border-charcoal/12 hover:border-champagne/70')}>
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-forest" checked={student.builder.meyosGrant} onChange={(e) => setBuilderGrant(student.id, e.target.checked)} />
                  <span>
                    <span className="flex flex-wrap items-center gap-2"><span className="font-display text-xl text-charcoal">{t('grant.meyos')}</span><Badge tone="champagne">{t('grant.label')}</Badge></span>
                    <span className="mt-1 block text-xs text-charcoal/60">{t('grant.availableFor', { course: grantCourses.map((c) => tr(c.title)).join(', ') })}</span>
                    <span className="mt-2 block text-xs leading-relaxed text-charcoal/55">{t('grant.hint')}</span>
                  </span>
                </label>
              </div>
            )}
          </Card>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <Card className="p-6">
            <div className="flex items-center justify-between"><Eyebrow>{t('student.sub.package')}</Eyebrow><Badge tone="sage">{tr(pkg.name)}</Badge></div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <div><dt className="text-charcoal/50">{t('common.courses')}</dt><dd className="mt-0.5 font-medium text-charcoal">{groups.length} / {pkg.maxCourses}</dd></div>
              <div><dt className="text-charcoal/50">{t('common.week')}</dt><dd className="mt-0.5 font-medium text-charcoal">{lessonsPerWeek(groups)} {t('student.lessonsPerWeek')} · {weeklyHours(groups)} h</dd></div>
              <div><dt className="text-charcoal/50">{t('payment.method')}</dt><dd className="mt-0.5 font-medium text-charcoal">{method ? t(`payment.${method.id}` as TKey) : '—'}</dd></div>
              {grantCourses.length > 0 && <div><dt className="text-charcoal/50">{t('grant.meyos')}</dt><dd className="mt-0.5 font-medium text-charcoal">{student.builder.meyosGrant ? t('grant.selected') : t('grant.notSelected')}</dd></div>}
            </dl>
            <div className="mt-5 flex items-end justify-between border-t border-charcoal/10 pt-4">
              <span className="text-sm text-charcoal/60">{t('builder.monthlyTotal')}</span>
              <span className="font-display text-3xl text-charcoal">{formatSom(total, lang)}</span>
            </div>
            <p className="mt-2 text-[11px] text-charcoal/45">{t('builder.transparent')}</p>
            <div className="mt-5 space-y-2">
              {conflicts.length > 0 ? <Notice tone="warn">{t('preview.fixIssues')}: {t('builder.conflict')}</Notice> : <Notice tone="info"><Icon name="check" className="mr-1 inline h-3.5 w-3.5" />{t('builder.noConflicts')}</Notice>}
              {fullGroups.length > 0 && <Notice tone="warn">{t('capacity.full')}: {fullGroups.map((g) => g.name).join(', ')}. {t('capacity.fullHint')}</Notice>}
              <Notice tone="info" className="text-xs">{t('preview.paymentNote')}</Notice>
            </div>
            <Button size="lg" className="mt-5 w-full" disabled={!ok} onClick={onActivate}>{t('preview.activate')}</Button>
            <p className="mt-3 text-center text-[11px] text-charcoal/45">{t('preview.renewalNote')}</p>
          </Card>
        </aside>
      </div>
    </div>
  )
}
