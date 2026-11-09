import { useState } from 'react'
import { billedSom } from '@ilmora/shared'
import { Link, useNavigate } from '@/lib/router'
import { FormatBadge, ScheduleChips } from '../../components/course/CourseCard'
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
  const [busy, setBusy] = useState<'renew' | 'cancel' | null>(null)
  if (!student) return null
  const sub = student.subscription
  // Renewal is paid on the provider's page: the store redirects there once the API has created the payment; errors are toasted by the store.
  const renew = async () => {
    if (busy) return
    setBusy('renew')
    try { await s.renewSubscription(student.id) } catch { /* toasted by the store */ } finally { setBusy(null) }
  }
  const cancel = async () => {
    if (busy || !confirm(t('common.confirmDelete'))) return
    setBusy('cancel')
    try { await s.cancelSubscription(student.id); s.notify(t('common.saved')) } catch { /* toasted by the store */ } finally { setBusy(null) }
  }
  const pkg = s.site.packages.find((p) => p.id === sub.packageId)
  const groups = resolveGroups(sub.groupIds, s.courses)
  const listTotal = groups.reduce((n, g) => n + (s.courses.find((c) => c.id === g.courseId)?.price ?? 0), 0)
  // What is billed each period is fixed at checkout (discounts included); demo data without it falls back to list prices.
  const total = billedSom(sub.amountMinor) ?? listTotal
  // A custom selection (bought without a package) has no package record; it is still an active subscription.
  if (sub.status !== 'active') return <div><PageTitle eyebrow={t('dash.studentSpace')} title={t('student.subscription')} /><EmptyState title={t('student.overview.noSub')} action={<LinkButton to="/builder">{t('student.overview.buildOne')}</LinkButton>} /></div>
  return (
    <div>
      <PageTitle eyebrow={t('dash.studentSpace')} title={t('student.subscription')} action={<><Button variant="secondary" onClick={() => { s.setBuilderPackage(student.id, pkg?.id ?? null); nav('/builder') }}><Icon name="edit" className="h-4 w-4" />{t('student.sub.change')}</Button><Button disabled={busy !== null} onClick={() => void renew()}><Icon name="refresh" className={busy === 'renew' ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />{busy === 'renew' ? t('checkout.redirecting') : t('student.sub.renewNow')}</Button></>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card className="p-7">
          <div className="flex items-start justify-between"><div><Eyebrow>{t('student.sub.package')}</Eyebrow><div className="mt-1 font-display text-5xl text-charcoal">{pkg ? tr(pkg.name) : t('builder.custom')}</div></div>{sub.blocked ? <Badge tone="danger">{t('student.sub.blocked')}</Badge> : <Badge tone="forest">{t('common.enabled')}</Badge>}</div>
          {pkg && <p className="mt-3 text-sm text-charcoal/65">{tr(pkg.description)}</p>}
          {sub.blocked && (
            <Notice tone="warn" className="mt-4">
              {t(sub.blockReason === 'lessons_exhausted' ? 'student.sub.blockedBody.lessons_exhausted' : 'student.sub.blockedBody.period_ended', { date: formatDate(sub.graceEndsAt ?? undefined, lang) })}
            </Notice>
          )}
          <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-charcoal/10 pt-5 text-sm">
            <div><dt className="text-xs text-charcoal/50">{t('student.sub.started')}</dt><dd className="mt-0.5 font-medium text-charcoal">{formatDate(sub.startedAt, lang)}</dd></div>
            {(sub.kind ?? 'PERIOD') === 'LESSONS'
              ? <div><dt className="text-xs text-charcoal/50">{t('student.sub.kind.LESSONS')}</dt><dd className="mt-0.5 font-medium text-charcoal">{t('student.sub.lessonsUsed', { used: sub.lessonsUsed ?? 0, total: sub.lessonsTotal ?? 0 })}</dd></div>
              : <div><dt className="text-xs text-charcoal/50">{t('student.sub.renews')}</dt><dd className="mt-0.5 font-medium text-charcoal">{formatDate(sub.renewsAt, lang)}{sub.renewsAt && !sub.blocked && <span className="ml-1 text-xs font-normal text-charcoal/45">· {t('student.sub.remainingDays', { n: Math.max(0, Math.ceil((new Date(sub.renewsAt).getTime() - new Date().getTime()) / 86_400_000)) })}</span>}</dd></div>}
            <div><dt className="text-xs text-charcoal/50">{t('student.sub.usage')}</dt><dd className="mt-0.5 font-medium text-charcoal">{pkg ? `${groups.length} / ${pkg.maxCourses}` : groups.length}</dd></div>
            <div><dt className="text-xs text-charcoal/50">{t('common.week')}</dt><dd className="mt-0.5 font-medium text-charcoal">{lessonsPerWeek(groups)} {t('student.lessonsPerWeek')} · {weeklyHours(groups)} h</dd></div>
            <div><dt className="text-xs text-charcoal/50">{t('payment.method')}</dt><dd className="mt-0.5 font-medium text-charcoal">{sub.payment ? t(`payment.${sub.payment.method}` as TKey) : '—'}{sub.payment?.simulated && <span className="ml-1 text-xs font-normal text-charcoal/45">· {t('payment.simulated')}</span>}</dd></div>
            <div><dt className="text-xs text-charcoal/50">{t('grant.label')}</dt><dd className="mt-0.5 font-medium text-charcoal">{sub.funding?.meyosGrant ? <>{t('grant.meyos')} <Badge tone="champagne">{t('grant.selected')}</Badge></> : t('grant.notSelected')}</dd></div>
          </dl>
          <div className="mt-6 flex items-end justify-between border-t border-charcoal/10 pt-5"><span className="text-sm text-charcoal/60">{t('builder.monthlyTotal')}</span><span className="font-display text-3xl text-charcoal">{formatSom(total, lang)}</span></div>
          {total < listTotal && <p className="mt-1 text-[11px] text-charcoal/45">{t('discount.applied')}</p>}
          <p className="mt-2 text-[11px] text-charcoal/45">{t('builder.transparent')}</p>
          <Notice tone="info" className="mt-5 text-xs">{t('preview.renewalNote')} {t('preview.paymentNote')}</Notice>
          <Button variant="danger" size="sm" className="mt-5" disabled={busy !== null} onClick={() => void cancel()}>{t('student.sub.cancel')}</Button>
        </Card>
        <div>
          <Eyebrow className="mb-3">{t('student.courses')}</Eyebrow>
          <ul className="space-y-2">
            {groups.map((g) => { const c = s.courses.find((x) => x.id === g.courseId)!; const center = s.centers.find((x) => x.id === c.centerId); return (
              <li key={g.id} className="card flex flex-wrap items-center gap-4 p-4">
                <div className="min-w-0 flex-1"><div className="mb-1"><FormatBadge course={c} /></div><Link to={`/courses/${c.id}`} className="font-medium text-charcoal hover:text-forest">{tr(c.title)}</Link><div className="mt-1 text-xs text-charcoal/55">{center?.name} · {g.name} · {t('common.room')} {g.room}</div><div className="mt-1.5"><ScheduleChips group={g} compact /></div></div>
                <div className="text-right text-sm font-medium text-charcoal">{formatSom(c.price, lang)}</div>
              </li>
            ) })}
          </ul>
          <ul className="mt-5 space-y-2 text-sm text-charcoal/70">{pkg?.perks.map((p, i) => <li key={i} className="flex gap-2"><Icon name="check" className="mt-0.5 h-4 w-4 text-forest" />{tr(p)}</li>)}</ul>
        </div>
      </div>
    </div>
  )
}
