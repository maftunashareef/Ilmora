'use client'
import { useEffect, useState } from 'react'
import { isPreparationTrack, MAX_CART_COURSES, priceTotals, universityDirections, universityName } from '@ilmora/shared'
import { PriceNow, ScheduleChips, TotalPrice } from '../../components/course/CourseCard'
import { Timetable } from '../../components/Timetable'
import { Badge, Button, Card, cx, EmptyState, Eyebrow, Icon, LinkButton, Notice, PageTitle } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { api, isApiError } from '../../lib/api'
import { arrangeCartByPackage } from '../../lib/cartPackages'
import { formatSom } from '../../lib/format'
import { UniversityLogo } from './Universities'
import { enrolledCount, isGroupFull } from '../../lib/enrollment'
import { findConflicts, lessonsPerWeek, resolveGroups, weeklyHours } from '../../lib/schedule'
import { Link, useLocation, useNavigate } from '../../lib/router'
import { useCurrentStudent } from '../../store/selectors'
import { type PaymentProviderId, useStore } from '../../store/useStore'

const PROVIDER_LABEL: Record<PaymentProviderId, string> = { PAYME: 'Payme' }

/** Step 3: review the selection and go to Payme's hosted payment page (Payme only since 10.11 — Click was removed). */
export function PreviewPage() {
  const { t, tr, lang } = useT()
  const nav = useNavigate()
  const { pathname } = useLocation()
  const auth = useStore((s) => s.auth)
  const student = useCurrentStudent()
  const packages = useStore((s) => s.site.packages)
  const courses = useStore((s) => s.courses)
  const centers = useStore((s) => s.centers)
  const students = useStore((s) => s.students)
  const setBuilderGrant = useStore((s) => s.setBuilderGrant)
  const checkout = useStore((s) => s.checkout)
  const notify = useStore((s) => s.notify)
  const cartBundles = useStore((s) => s.cartBundles)
  const presets = useStore((s) => s.site.presets)
  const universities = useStore((s) => s.site.universities)
  const [providers, setProviders] = useState<Record<PaymentProviderId, boolean> | null>(null)
  const provider: PaymentProviderId = 'PAYME'
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api<Record<PaymentProviderId, boolean>>('/payments/providers', { auth: false })
      .then((p) => setProviders({ PAYME: !!p.PAYME }))
      .catch(() => setProviders({ PAYME: false }))
  }, [])

  const builder = student?.builder ?? { packageId: null, groupIds: [], meyosGrant: false }
  const pkg = packages.find((p) => p.id === builder.packageId)
  const groups = resolveGroups(builder.groupIds, courses)
  const conflicts = findConflicts(groups)
  // Display only: the server charges the same rule (finalPriceMinor) at checkout and decides the amount.
  const totals = priceTotals(groups.map((g) => courses.find((x) => x.id === g.courseId)).filter((c): c is NonNullable<typeof c> => !!c))
  const fullGroups = groups.filter((g) => isGroupFull(g, students, student?.id))
  // A package needs exactly its number of courses; without one (custom selection) any 1..MAX_CART_COURSES courses will do.
  const countOk = pkg ? groups.length === pkg.maxCourses : groups.length >= 1 && groups.length <= MAX_CART_COURSES
  const ok = countOk && conflicts.length === 0 && fullGroups.length === 0
  const grantCourses = groups.map((g) => courses.find((c) => c.id === g.courseId)).filter((c): c is NonNullable<typeof c> => !!c?.meyosGrant)
  const hasSubscription = student?.subscription.status === 'active'
  const { packages: cartPackages } = arrangeCartByPackage(groups, cartBundles, presets ?? [], universities ?? [])

  if (auth.status === 'anonymous') {
    return (
      <div className="container-x py-16">
        <Card className="mx-auto max-w-xl px-8 py-10 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-sage text-forest"><Icon name="user" className="h-5 w-5" /></div>
          <h1 className="font-display text-3xl text-charcoal">{t('checkout.title')}</h1>
          <p className="mt-3 text-sm text-charcoal/65">{t('checkout.signInFirst')}</p>
          <Button size="lg" className="mt-6" onClick={() => nav(`/login?next=${encodeURIComponent(pathname)}`)}>{t('auth.signIn')} <Icon name="arrowRight" className="h-4 w-4" /></Button>
        </Card>
      </div>
    )
  }

  if (!student || groups.length === 0) {
    return (
      <div className="container-x py-16">
        <EmptyState title={t('preview.emptyTitle')} body={t('preview.emptyBody')} action={<LinkButton to="/builder">{t('builder.title')}</LinkButton>} />
      </div>
    )
  }

  const onPay = async () => {
    setBusy(true)
    try {
      const r = await checkout(provider)
      if (!r.url) { window.location.assign(`/${lang}/payments/${r.paymentId}/return`); return }
      notify(t('checkout.redirecting'))
      window.location.assign(r.url)
    } catch (err) {
      if (isApiError(err) && err.code === 'full') notify(`${t('capacity.full')} — ${t('capacity.fullHint')}`, 'warn')
      setBusy(false)
    }
  }

  return (
    <div className="container-x py-12 lg:py-16">
      <PageTitle eyebrow={t('builder.step3')} title={t('preview.title')} subtitle={t('preview.subtitle')} action={<LinkButton to="/builder" variant="secondary"><Icon name="arrowLeft" className="h-4 w-4" />{t('preview.editSelection')}</LinkButton>} />
      <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
          <Timetable groups={groups} courses={courses} conflicts={conflicts} />
          {cartPackages.length > 0 && (
            <ul className="space-y-3">
              {cartPackages.map((p) => {
                const where = p.university && p.directionId ? universityDirections(p.university).find((x) => x.direction.id === p.directionId) : undefined
                const sum = priceTotals(p.groups.map((g) => courses.find((c) => c.id === g.courseId)).filter((c): c is NonNullable<typeof c> => !!c))
                return (
                  <li key={p.presetId} className="flex flex-wrap items-center gap-4 rounded-card border border-champagne/55 bg-gradient-to-r from-ivory via-paper to-sage/35 p-4">
                    {p.university && <UniversityLogo university={p.university} height={44} maxWidth={96} />}
                    <div className="min-w-0 flex-1">
                      <div className="eyebrow">{t('uni.cartPackage')}</div>
                      <div className="mt-0.5 break-words font-display text-xl leading-tight text-charcoal">{p.university ? universityName(p.university, lang) : tr(p.preset.name)}</div>
                      {where && <div className="break-words text-xs text-charcoal/60">{[p.university && isPreparationTrack(p.university) ? '' : tr(where.faculty.name), tr(where.direction.name)].filter(Boolean).join(' · ')}</div>}
                      <div className="mt-0.5 break-words text-xs font-semibold text-forest">{tr(p.preset.name)} · {p.groups.map((g) => tr(courses.find((c) => c.id === g.courseId)?.title)).join(', ')}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-[11px] text-charcoal/50">{t('uni.packagePrice')}</div>
                      <div className="whitespace-nowrap font-display text-xl text-charcoal">{formatSom(sum.final, lang)}</div>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          <ul className="grid gap-3 sm:grid-cols-2">
            {groups.map((g) => {
              const c = courses.find((x) => x.id === g.courseId)!
              const center = centers.find((x) => x.id === c.centerId)
              const full = isGroupFull(g, students, student.id)
              return (
                <li key={g.id} className={cx('card p-4', full && 'border-amber-300')}>
                  <Link to={`/courses/${c.slug ?? c.id}`} className="font-display text-xl text-charcoal hover:text-forest">{tr(c.title)}</Link>
                  <div className="mt-1 text-xs text-charcoal/55">{center?.name} · {g.name} · {t('common.room')} {g.room}</div>
                  <div className="mt-2 flex flex-wrap items-center gap-2"><ScheduleChips group={g} /><Badge tone={full ? 'warn' : 'muted'}>{t('capacity.students', { n: enrolledCount(students, g.id, student.id), max: g.capacity })}</Badge></div>
                  {full && <div className="mt-2 text-xs text-amber-800">{t('capacity.full')} — {t('capacity.fullHint')}</div>}
                  <div className="mt-3 text-sm font-medium text-charcoal"><PriceNow course={c} withCurrency /> <span className="text-xs font-normal text-charcoal/50">{t('common.perMonth')}</span></div>
                </li>
              )
            })}
          </ul>

          <Card>
            <div className="flex items-center justify-between gap-3"><Eyebrow>{t('payment.title')}</Eyebrow></div>
            <div className="mt-4 text-sm font-medium text-charcoal">{t('checkout.provider')}</div>
            {/* One provider: Payme. Shown as a card (no choice to make), with «not connected yet» while the API has no keys. */}
            <div className={cx('mt-2 flex items-center gap-3 rounded-control border px-4 py-3 text-sm', providers?.PAYME ? 'border-forest bg-sage/40' : 'border-charcoal/12 opacity-60')}>
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-forest text-ivory"><Icon name="package" className="h-4 w-4" /></span>
              <span className="font-medium text-charcoal">{PROVIDER_LABEL.PAYME}</span>
              {!providers?.PAYME && <Badge tone="muted" className="ml-auto">{providers ? t('checkout.providerUnavailable') : '…'}</Badge>}
            </div>
            <Notice tone="info" className="mt-3 text-xs">{t('checkout.note', { h: 24 })}</Notice>

            {grantCourses.length > 0 && (
              <div className="mt-5 border-t border-charcoal/10 pt-5">
                <label className={cx('flex cursor-pointer items-start gap-3 rounded-card border p-4 transition', builder.meyosGrant ? 'border-champagne bg-champagne/15' : 'border-charcoal/12 hover:border-champagne/70')}>
                  <input type="checkbox" className="mt-1 h-4 w-4 accent-forest" checked={builder.meyosGrant} onChange={(e) => setBuilderGrant(student.id, e.target.checked)} />
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
            <div className="flex items-center justify-between"><Eyebrow>{t('student.sub.package')}</Eyebrow><Badge tone="sage">{pkg ? tr(pkg.name) : t('builder.custom')}</Badge></div>
            <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
              <div><dt className="text-charcoal/50">{t('common.courses')}</dt><dd className="mt-0.5 font-medium text-charcoal">{pkg ? `${groups.length} / ${pkg.maxCourses}` : groups.length}</dd></div>
              <div><dt className="text-charcoal/50">{t('common.week')}</dt><dd className="mt-0.5 font-medium text-charcoal">{lessonsPerWeek(groups)} {t('student.lessonsPerWeek')} · {weeklyHours(groups)} h</dd></div>
              <div><dt className="text-charcoal/50">{t('checkout.provider')}</dt><dd className="mt-0.5 font-medium text-charcoal">{PROVIDER_LABEL[provider]}</dd></div>
              {grantCourses.length > 0 && <div><dt className="text-charcoal/50">{t('grant.meyos')}</dt><dd className="mt-0.5 font-medium text-charcoal">{builder.meyosGrant ? t('grant.selected') : t('grant.notSelected')}</dd></div>}
            </dl>
            <div className="mt-5 flex items-end justify-between gap-3 border-t border-charcoal/10 pt-4">
              <span className="pb-1 text-sm text-charcoal/60">{t('builder.monthlyTotal')}</span>
              <TotalPrice list={totals.list} final={totals.final} />
            </div>
            <p className="mt-2 text-[11px] text-charcoal/45">{t('builder.transparent')}</p>
            <div className="mt-5 space-y-2">
              {conflicts.length > 0 ? <Notice tone="warn">{t('preview.fixIssues')}: {t('builder.conflict')}</Notice> : <Notice tone="info"><Icon name="check" className="mr-1 inline h-3.5 w-3.5" />{t('builder.noConflicts')}</Notice>}
              {fullGroups.length > 0 && <Notice tone="warn">{t('capacity.full')}: {fullGroups.map((g) => g.name).join(', ')}. {t('capacity.fullHint')}</Notice>}
              {hasSubscription && <Notice tone="warn">{t('student.sub.alreadyActive')}</Notice>}
            </div>
            <Button size="lg" className="mt-5 w-full" disabled={!ok || busy || hasSubscription || !(providers?.[provider] ?? false)} onClick={onPay}>
              {busy ? <Icon name="refresh" className="h-4 w-4 animate-spin" /> : <Icon name="arrowRight" className="h-4 w-4" />} {t('checkout.pay')} · {PROVIDER_LABEL[provider]}
            </Button>
            <p className="mt-3 text-center text-[11px] text-charcoal/45">{t('preview.renewalNote')}</p>
          </Card>
        </aside>
      </div>
    </div>
  )
}
