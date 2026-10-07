import { Link, useNavigate } from 'react-router-dom'
import { ScheduleChips } from '../../components/course/CourseCard'
import { Badge, Button, Card, EmptyState, Eyebrow, Icon, LinkButton, Notice, PageTitle } from '../../components/ui'
import type { TKey } from '../../i18n/translations'
import { useT } from '../../i18n/useT'
import { formatDate, formatSom } from '../../lib/format'
import { lessonsPerWeek, resolveGroups, weeklyHours } from '../../lib/schedule'
import { useCurrentStudent } from '../../store/selectors'
import { useStore } from '../../store/useStore'

export function StudentSubscription() {
  const { t, tr, lang } = useT()
  const nav = useNavigate()
  const student = useCurrentStudent()
  const s = useStore()
  if (!student) return null
  const sub = student.subscription
  const pkg = s.site.packages.find((p) => p.id === sub.packageId)
  const groups = resolveGroups(sub.groupIds, s.courses)
  const total = groups.reduce((n, g) => n + (s.courses.find((c) => c.id === g.courseId)?.price ?? 0), 0)
  if (sub.status !== 'active' || !pkg) return <div><PageTitle eyebrow={t('dash.studentSpace')} title={t('student.subscription')} /><EmptyState title={t('student.overview.noSub')} action={<LinkButton to="/builder">{t('student.overview.buildOne')}</LinkButton>} /></div>
  return (
    <div>
      <PageTitle eyebrow={t('dash.studentSpace')} title={t('student.subscription')} action={<><Button variant="secondary" onClick={() => { s.setBuilderPackage(student.id, pkg.id); nav('/builder') }}><Icon name="edit" className="h-4 w-4" />{t('student.sub.change')}</Button><Button onClick={() => { s.renewSubscription(student.id); s.notify(t('student.sub.renewed')) }}><Icon name="refresh" className="h-4 w-4" />{t('student.sub.renewNow')}</Button></>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card className="p-7">
          <div className="flex items-start justify-between"><div><Eyebrow>{t('student.sub.package')}</Eyebrow><div className="mt-1 font-display text-5xl text-charcoal">{tr(pkg.name)}</div></div><Badge tone="forest">{t('common.enabled')}</Badge></div>
          <p className="mt-3 text-sm text-charcoal/65">{tr(pkg.description)}</p>
          <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-charcoal/10 pt-5 text-sm">
            <div><dt className="text-xs text-charcoal/50">{t('student.sub.started')}</dt><dd className="mt-0.5 font-medium text-charcoal">{formatDate(sub.startedAt, lang)}</dd></div>
            <div><dt className="text-xs text-charcoal/50">{t('student.sub.renews')}</dt><dd className="mt-0.5 font-medium text-charcoal">{formatDate(sub.renewsAt, lang)}</dd></div>
            <div><dt className="text-xs text-charcoal/50">{t('student.sub.usage')}</dt><dd className="mt-0.5 font-medium text-charcoal">{groups.length} / {pkg.maxCourses}</dd></div>
            <div><dt className="text-xs text-charcoal/50">{t('common.week')}</dt><dd className="mt-0.5 font-medium text-charcoal">{lessonsPerWeek(groups)} {t('student.lessonsPerWeek')} · {weeklyHours(groups)} h</dd></div>
            <div><dt className="text-xs text-charcoal/50">{t('payment.method')}</dt><dd className="mt-0.5 font-medium text-charcoal">{sub.payment ? t(`payment.${sub.payment.method}` as TKey) : '—'}<span className="ml-1 text-xs font-normal text-charcoal/45">· {t('payment.simulated')}</span></dd></div>
            <div><dt className="text-xs text-charcoal/50">{t('grant.label')}</dt><dd className="mt-0.5 font-medium text-charcoal">{sub.funding?.meyosGrant ? <>{t('grant.meyos')} <Badge tone="champagne">{t('grant.selected')}</Badge></> : t('grant.notSelected')}</dd></div>
          </dl>
          <div className="mt-6 flex items-end justify-between border-t border-charcoal/10 pt-5"><span className="text-sm text-charcoal/60">{t('builder.monthlyTotal')}</span><span className="font-display text-3xl text-charcoal">{formatSom(total, lang)}</span></div>
          <p className="mt-2 text-[11px] text-charcoal/45">{t('builder.transparent')}</p>
          <Notice tone="info" className="mt-5 text-xs">{t('preview.renewalNote')} {t('preview.paymentNote')}</Notice>
          <Button variant="danger" size="sm" className="mt-5" onClick={() => { if (confirm(t('common.confirmDelete'))) { s.cancelSubscription(student.id); s.notify(t('common.saved')) } }}>{t('student.sub.cancel')}</Button>
        </Card>
        <div>
          <Eyebrow className="mb-3">{t('student.courses')}</Eyebrow>
          <ul className="space-y-2">
            {groups.map((g) => { const c = s.courses.find((x) => x.id === g.courseId)!; const center = s.centers.find((x) => x.id === c.centerId); return (
              <li key={g.id} className="card flex flex-wrap items-center gap-4 p-4">
                <div className="min-w-0 flex-1"><Link to={`/courses/${c.id}`} className="font-medium text-charcoal hover:text-forest">{tr(c.title)}</Link><div className="mt-1 text-xs text-charcoal/55">{center?.name} · {g.name} · {t('common.room')} {g.room}</div><div className="mt-1.5"><ScheduleChips group={g} compact /></div></div>
                <div className="text-right text-sm font-medium text-charcoal">{formatSom(c.price, lang)}</div>
              </li>
            ) })}
          </ul>
          <ul className="mt-5 space-y-2 text-sm text-charcoal/70">{pkg.perks.map((p, i) => <li key={i} className="flex gap-2"><Icon name="check" className="mt-0.5 h-4 w-4 text-forest" />{tr(p)}</li>)}</ul>
        </div>
      </div>
    </div>
  )
}
