'use client'
import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from 'react'
import { countLabel, foldForSearch, isPreparationTrack, MAX_CART_COURSES, NOUNS, presetCartPlan, priceTotals, universityDirections, universityName } from '@ilmora/shared'
import { Link } from '@/lib/router'
import { useNavigate, useSearchParams } from '@/lib/routerHooks'
import { PriceNow, ScheduleChips } from '../../components/course/CourseCard'
import { PaymeLogo } from '../../components/PaymeLogo'
import { Timetable } from '../../components/Timetable'
import { ArtCover, Badge, Button, Card, Eyebrow, Icon, Input, Modal, Notice, PageTitle, Select } from '../../components/ui'
import { cx } from '../../components/ui/helpers'
import { useT } from '../../i18n/useT'
import { isPublicListed } from '../../lib/access'
import { api } from '../../lib/api'
import { UniversityPackagesSection } from './UniversityPackages'
import { UniversityLogo } from './Universities'
import { arrangeCartByPackage } from '../../lib/cartPackages'
import { subscribableCourses } from '../../lib/builderCourses'
import { formatSom } from '../../lib/format'
import { usePresetCart } from '../../store/usePresetCart'
import { CourseFinderPrompt } from './CourseFinder'
import { JourneyTracker } from '../../components/JourneySteps'
import { enrolledCount, isGroupFull } from '../../lib/enrollment'
import { findConflicts, overlaps, resolveGroups, weeklyHours } from '../../lib/schedule'
import { useCurrentStudent } from '../../store/selectors'
import { useStore, type PaymentProviderId } from '../../store/useStore'
import type { Course, Group, Preset, University } from '../../types'

/** One course of the cart: center, group and schedule, price, and buttons to switch the group or take it out. */
function CartLine({ group, course, clash, onChangeGroup, onRemove }: { group: Group; course: Course; clash: boolean; onChangeGroup?: () => void; onRemove: () => void }) {
  const { t, tr } = useT()
  const center = useStore((s) => s.centers.find((x) => x.id === course.centerId))
  return (
    <li className="flex items-start justify-between gap-3 py-3">
      <div className="min-w-0">
        <div className="break-words text-sm font-medium text-charcoal">{tr(course.title)}</div>
        <div className="mt-0.5 break-words text-[11px] text-charcoal/55">{[center?.name, group.name].filter(Boolean).join(' · ')}</div>
        <div className="mt-1"><ScheduleChips group={group} compact /></div>
        {clash && <div className="mt-1 text-[11px] text-red-700">{t('builder.conflict')}</div>}
      </div>
      <div className="flex shrink-0 flex-col items-end gap-1">
        <div className="whitespace-nowrap text-right text-sm text-charcoal"><PriceNow course={course} /></div>
        <div className="flex gap-0.5">
          {onChangeGroup && <button type="button" onClick={onChangeGroup} aria-label={t('builder.changeGroup')} title={t('builder.changeGroup')} className="rounded-full p-1.5 text-charcoal/45 transition hover:bg-sage hover:text-forest"><Icon name="refresh" className="h-3.5 w-3.5" /></button>}
          <button type="button" onClick={onRemove} aria-label={t('common.remove')} title={t('common.remove')} className="rounded-full p-1.5 text-charcoal/45 transition hover:bg-red-50 hover:text-red-700"><Icon name="x" className="h-3.5 w-3.5" /></button>
        </div>
      </div>
    </li>
  )
}

/**
 * A university package in the cart: the university, the chosen faculty and direction, the package name, its courses
 * (children), the package's monthly price and a button that takes the whole package out.
 */
function CartPackage({ preset, university, directionId, groups, onRemove, children }: { preset: Preset; university?: University; directionId?: string; groups: Group[]; onRemove: () => void; children: ReactNode }) {
  const { t, tr, lang } = useT()
  const courses = useStore((s) => s.courses)
  const place = university && directionId ? universityDirections(university).find((x) => x.direction.id === directionId) : undefined
  const track = !!university && isPreparationTrack(university)
  const total = priceTotals(groups.map((g) => courses.find((c) => c.id === g.courseId)).filter((c): c is Course => !!c))
  return (
    <section className="rounded-card border border-champagne/55 bg-gradient-to-br from-ivory via-paper to-sage/35 p-4" aria-label={tr(preset.name)}>
      <div className="flex items-center justify-between gap-3">
        {university ? <UniversityLogo university={university} height={40} maxWidth={150} align="start" /> : <span className="eyebrow">{t('uni.cartPackage')}</span>}
        <button type="button" onClick={onRemove} className="inline-flex shrink-0 items-center gap-1 rounded-full border border-charcoal/10 bg-paper px-2.5 py-1 text-[11px] font-medium text-charcoal/60 transition hover:border-red-200 hover:bg-red-50 hover:text-red-700"><Icon name="trash" className="h-3.5 w-3.5" />{t('uni.removePackage')}</button>
      </div>
      {university && <div className="eyebrow mt-3">{t('uni.cartPackage')}</div>}
      {university && <div className="mt-0.5 break-words font-display text-lg leading-tight text-charcoal">{universityName(university, lang)}</div>}
      {place && <div className="mt-0.5 break-words text-[11px] text-charcoal/60">{[track ? '' : tr(place.faculty.name), tr(place.direction.name)].filter(Boolean).join(' · ')}</div>}
      <div className="mt-1 break-words text-xs font-semibold text-forest">{tr(preset.name)}</div>
      <ul className="mt-2 divide-y divide-charcoal/10">{children}</ul>
      <div className="flex items-baseline justify-between gap-3 border-t border-champagne/50 pt-2.5 text-sm">
        <span className="text-charcoal/60">{t('uni.packagePrice')}</span>
        <span className="whitespace-nowrap font-semibold tabular-nums text-charcoal">
          {total.saved > 0 && <span className="mr-1.5 text-xs font-normal text-charcoal/45 line-through">{formatSom(total.list, lang, false)}</span>}
          {formatSom(total.final, lang)}
        </span>
      </div>
    </section>
  )
}

export function BuilderPage() {
  const { t, tr, lang } = useT()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const student = useCurrentStudent()
  const packages = useStore((s) => s.site.packages)
  const courses = useStore((s) => s.courses)
  const categories = useStore((s) => s.categories)
  const centers = useStore((s) => s.centers)
  const teachers = useStore((s) => s.teachers)
  const students = useStore((s) => s.students)
  const setBuilderPackage = useStore((s) => s.setBuilderPackage)
  const addBuilderGroup = useStore((s) => s.addBuilderGroup)
  const removeBuilderCourse = useStore((s) => s.removeBuilderCourse)
  const removeCartBundle = useStore((s) => s.removeCartBundle)
  const clearBuilder = useStore((s) => s.clearBuilder)
  const cartBundles = useStore((s) => s.cartBundles)
  const notify = useStore((s) => s.notify)
  const guestHydrated = useStore((s) => s.guestHydrated)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [picker, setPicker] = useState<Course | null>(null)
  // The payment system is named beside the total only while the API says it is connected (the checkout page asks the same).
  const [paymeReady, setPaymeReady] = useState(false)
  useEffect(() => {
    api<Record<PaymentProviderId, boolean>>('/payments/providers', { auth: false }).then((p) => setPaymeReady(!!p.PAYME)).catch(() => setPaymeReady(false))
  }, [])
  const presets = useStore((s) => s.site.presets)
  const universities = useStore((s) => s.site.universities)

  // ?package=… (from a package card) is applied once per link, and only after a visitor's saved cart has been read from
  // the device, so it switches the package without wiping the chosen courses. Afterwards the student's own choice with
  // the package buttons wins (re-applying it on every change used to snap the package back to the one in the link).
  const appliedPackageParam = useRef<string | null>(null)
  useEffect(() => {
    const p = params.get('package')
    if (!p || !student || !guestHydrated || appliedPackageParam.current === p) return
    // ?package=custom is "Build Your Own" (no package); any other value must be an enabled package.
    if (p === 'custom') {
      appliedPackageParam.current = p
      if (student.builder.packageId !== null) setBuilderPackage(student.id, null)
    } else if (packages.some((x) => x.id === p && x.enabled)) {
      appliedPackageParam.current = p
      if (student.builder.packageId !== p) setBuilderPackage(student.id, p)
    }
  }, [params, student, packages, setBuilderPackage, guestHydrated])

  const pkg = packages.find((p) => p.id === student?.builder.packageId)
  const selectedGroups = useMemo(() => resolveGroups(student?.builder.groupIds ?? [], courses), [student, courses])
  const conflicts = findConflicts(selectedGroups)
  const totals = priceTotals(selectedGroups.map((g) => courses.find((x) => x.id === g.courseId)).filter((c): c is Course => !!c))
  // Only offline courses with a group (seats and a schedule) can be put in a subscription; online courses open on the provider's site.
  const publicCourses = subscribableCourses(courses)
  const list = publicCourses.filter((c) => (!cat || c.categoryId === cat) && (!q || foldForSearch(`${tr(c.title)} ${teachers.find((x) => x.id === c.teacherId)?.name ?? ''}`).includes(foldForSearch(q.trim()))))
  const selectedCourseIds = new Set(selectedGroups.map((g) => g.courseId))
  // Without a package this is a custom selection: any number of courses from one up to the cart limit.
  const maxSelectable = pkg?.maxCourses ?? MAX_CART_COURSES
  const complete = (pkg ? selectedGroups.length === pkg.maxCourses : selectedGroups.length >= 1) && conflicts.length === 0
  // How It Works tracker: courses chosen, the package's course count met, the selection checked (no clashes); then review.
  // The six steps of "How ILMORA works": browse, choose, package, price, cart (review and payment), learn.
  const hasCourses = selectedGroups.length > 0
  const journeyDone = [hasCourses, hasCourses, pkg ? selectedGroups.length === pkg.maxCourses : hasCourses, complete, false, false]
  const journeyCurrent = Math.min(journeyDone.indexOf(false), 4)
  const goToStep = (step: number) => {
    if (step === 0) { nav('/courses'); return }
    if (step === 4) { if (complete) nav('/preview'); return }
    document.getElementById(['', 'builder-courses', 'builder-packages', 'builder-summary'][step])?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const tryAdd = (groupId: string) => {
    if (!student) return
    const r = addBuilderGroup(student.id, groupId)
    if (r.ok) { notify(t('courses.inPlan')); setPicker(null); return }
    const conflictName = r.conflictWith ? tr(courses.find((c) => c.id === r.conflictWith)?.title) : ''
    const msg = { 'no-package': t('builder.pickPackageFirst'), limit: pkg ? t('builder.limitReached') : t('builder.customLimit', { n: MAX_CART_COURSES }), duplicate: t('builder.duplicate'), conflict: `${t('builder.conflict')} — ${conflictName}. ${t('builder.conflictHint')}`, disabled: t('builder.packageDisabled'), full: `${t('capacity.full')} — ${t('capacity.fullHint')}` }[r.reason]
    notify(msg, 'warn')
  }
  const clearCart = () => {
    if (!student || !confirm(t('builder.clearCartConfirm'))) return
    clearBuilder(student.id)
    notify(t('builder.cartCleared'))
  }
  const onAddCourse = (c: Course) => {
    if (selectedCourseIds.has(c.id)) { notify(t('builder.duplicate'), 'warn'); return }
    if (c.groups.length === 1) tryAdd(c.groups[0].id)
    else setPicker(c)
  }

  // A ready-made package goes into the same cart in one step (groups picked automatically, nothing added half-way).
  const addPreset = usePresetCart()
  const startPreset = (preset: Preset, chosenOptional?: string[]) => {
    if (student && presetCartPlan(preset, courses, student.builder.groupIds, chosenOptional).toAdd.length === 0) { notify(t('preset.allInCart')); return }
    addPreset(preset, { chosenOptional })
  }

  // /builder?preset=<id>&extra=<slotIds> (older links to a university package) adds that published package once, with the chosen extras.
  const startPresetFromLink = useEffectEvent((preset: Preset, extra: string[]) => startPreset(preset, extra))
  const handledPreset = useRef<string | null>(null)
  useEffect(() => {
    const id = params.get('preset')
    const key = `${id}|${params.get('extra') ?? ''}`
    if (!id || !student || !guestHydrated || handledPreset.current === key) return
    const preset = (presets ?? []).find((p) => p.id === id && p.enabled)
    if (!preset) return
    handledPreset.current = key
    startPresetFromLink(preset, (params.get('extra') ?? '').split(',').filter(Boolean))
  }, [params, student, presets, guestHydrated]) // handledPreset makes this run once per link

  // /builder#cart ("Go to cart" after adding a package) opens on the summary, which on phones sits below the course list.
  useEffect(() => {
    if (window.location.hash !== '#cart') return
    const timer = setTimeout(() => document.getElementById('cart')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120)
    return () => clearTimeout(timer)
  }, [])

  // University packages in the cart are shown together (each course once); the remaining courses follow on their own.
  const { packages: cartPackages, loose: looseGroups } = arrangeCartByPackage(selectedGroups, cartBundles, presets ?? [], universities ?? [])
  const cartLine = (g: (typeof selectedGroups)[number]) => {
    const c = courses.find((x) => x.id === g.courseId)!
    return <CartLine key={g.id} group={g} course={c} clash={conflicts.some((k) => k.a.id === g.id || k.b.id === g.id)} onChangeGroup={c.groups.length > 1 ? () => setPicker(c) : undefined} onRemove={() => student && removeBuilderCourse(student.id, c.id)} />
  }

  // /builder?add=<courseId> (from the saved courses page) adds that course once, opening the group picker when it has several.
  const addCourseFromLink = useEffectEvent((c: Course) => onAddCourse(c))
  const handledAdd = useRef<string | null>(null)
  useEffect(() => {
    const id = params.get('add')
    if (!id || !student || handledAdd.current === id) return
    const c = courses.find((x) => x.id === id && isPublicListed(x))
    if (!c) return
    handledAdd.current = id
    addCourseFromLink(c)
  }, [params, student, courses]) // handledAdd makes this run once per link

  return (
    <div className="container-x py-12 lg:py-16">
      <PageTitle title={t('builder.title')} subtitle={t('builder.subtitle')} />

      {/* The cart comes first: what is chosen, then the total and the way on to review and payment. Everything for
          choosing more follows below it. */}
      <section id="builder-summary" className="mb-10 scroll-mt-24" aria-labelledby="cart-title">
        <span id="cart" className="block scroll-mt-24" aria-hidden="true" />
        <Card className="p-5 sm:p-7">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Eyebrow>{t('builder.yourSelection')}</Eyebrow>
              <h2 id="cart-title" className="mt-1 font-display text-3xl leading-none text-charcoal sm:text-4xl">{t('nav.cart')}</h2>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {pkg ? <Badge tone="sage">{tr(pkg.name)} · {selectedGroups.length}/{pkg.maxCourses}</Badge> : <Badge tone="sage">{t('builder.custom')} · {selectedGroups.length}</Badge>}
              {selectedGroups.length > 0 && <Button size="sm" variant="ghost" onClick={clearCart}><Icon name="trash" className="h-3.5 w-3.5" />{t('builder.clearCart')}</Button>}
            </div>
          </div>
          {pkg && (
            <div className="mt-3 flex gap-1.5">
              {Array.from({ length: pkg.maxCourses }).map((_, i) => <span key={i} className={cx('h-1.5 flex-1 rounded-full', i < selectedGroups.length ? 'bg-forest' : 'bg-charcoal/10')} />)}
            </div>
          )}
          {selectedGroups.length === 0 ? (
            <p className="mt-5 text-sm text-charcoal/55">{t('builder.emptySelection')}</p>
          ) : (
            <div className="mt-5 space-y-4">
              {cartPackages.map((p) => (
                <CartPackage key={p.presetId} preset={p.preset} university={p.university} directionId={p.directionId} groups={p.groups} onRemove={() => student && removeCartBundle(student.id, p.presetId)}>
                  {p.groups.map(cartLine)}
                </CartPackage>
              ))}
              {looseGroups.length > 0 && (
                <div>
                  {cartPackages.length > 0 && <div className="text-[11px] font-semibold uppercase tracking-wider text-charcoal/50">{t('uni.otherCourses')}</div>}
                  <ul className="divide-y divide-charcoal/10">{looseGroups.map(cartLine)}</ul>
                </div>
              )}
            </div>
          )}

          {/* Total and the way on to review and payment, under the chosen courses: the one dark panel of the page, so
              the eye lands on the sum and the button. */}
          <div className="mt-6 overflow-hidden rounded-card bg-forest text-ivory shadow-lift">
            <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[1fr_22rem] lg:items-center lg:gap-10">
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-[0.2em] text-champagne">{t('builder.monthlyTotal')}</div>
                <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-1">
                  <span className="font-display text-5xl leading-none sm:text-6xl">{formatSom(totals.final, lang)}</span>
                  {totals.list > totals.final && <span className="pb-1.5 text-base text-ivory/50 line-through"><span className="sr-only">{t('discount.was')}: </span>{formatSom(totals.list, lang)}</span>}
                </div>
                {totals.list > totals.final && <div className="mt-3 inline-flex rounded-full bg-champagne/20 px-3 py-1 text-xs font-semibold text-champagne">{t('builder.saving', { price: formatSom(totals.list - totals.final, lang) })}</div>}
                <p className="mt-3 text-xs leading-relaxed text-ivory/60">{t('builder.transparent')}{selectedGroups.length > 0 && <> · {weeklyHours(selectedGroups)} {t('preview.hoursPerWeek')}</>}</p>
              </div>
              <div className="space-y-3">
                {conflicts.length > 0 && <Notice tone="warn"><Icon name="warn" className="mr-1 inline h-3.5 w-3.5" />{t('builder.conflictHint')}</Notice>}
                {conflicts.length === 0 && selectedGroups.length > 1 && <p className="flex items-center gap-2 text-sm text-ivory/85"><Icon name="check" className="h-4 w-4 shrink-0 text-champagne" />{t('builder.noConflicts')}</p>}
                {pkg && selectedGroups.length !== pkg.maxCourses && <p className="text-xs text-ivory/70">{t('builder.needExactly', { n: pkg.maxCourses })}</p>}
                {!pkg && selectedGroups.length === 0 && <p className="text-xs text-ivory/70">{t('builder.selectOne')}</p>}
                <Button variant="champagne" size="lg" className="w-full !py-4 !text-base font-semibold" disabled={!complete} onClick={() => nav('/preview')}>{t('builder.continue')} <Icon name="arrowRight" className="h-4 w-4" /></Button>
                {paymeReady && (
                  <div className="flex items-center gap-3 rounded-control border border-ivory/15 bg-ivory/5 px-3.5 py-3">
                    <PaymeLogo />
                    <span className="min-w-0 text-[11px] leading-snug text-ivory/70"><Icon name="lock" className="mr-1 inline h-3 w-3 text-champagne" />{t('preview.paymentNote')}</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </Card>
        {selectedGroups.length > 0 && (
          <details className="mt-4 rounded-card border border-charcoal/10 bg-paper px-5 py-4">
            <summary className="cursor-pointer select-none text-sm font-medium text-forest">{t('builder.weeklyPreview')}</summary>
            <div className="mt-4"><Timetable groups={selectedGroups} courses={courses} conflicts={conflicts} compact /></div>
          </details>
        )}
      </section>

      {/* While choosing more further down, a slim bar keeps the cart's count and total in view and leads back up to it. */}
      {selectedGroups.length > 0 && (
        <div className="pointer-events-none sticky top-20 z-30 mb-8 flex justify-center lg:top-24">
          <div className="pointer-events-auto flex max-w-full items-center gap-3 rounded-full border border-forest/15 bg-paper/95 py-1.5 pl-4 pr-1.5 text-sm shadow-soft backdrop-blur">
            <Icon name="cart" className="h-4 w-4 shrink-0 text-forest" />
            <span className="min-w-0 truncate text-charcoal/75"><span className="font-medium text-charcoal">{t('favorites.inCart')}:</span> {countLabel(lang, selectedGroups.length, NOUNS.course)} · {formatSom(totals.final, lang)}</span>
            <Button size="sm" onClick={() => document.getElementById('builder-summary')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>{t('uni.goToCart')}</Button>
          </div>
        </div>
      )}

      {/* Everything for choosing more: how it works, packages, university packages and the course list. */}
      <JourneyTracker done={journeyDone} current={journeyCurrent} canReview={complete} onStep={goToStep} />
      <CourseFinderPrompt className="mb-10" />

      {/* Step 1 — package */}
      <section id="builder-packages" className="mb-10 scroll-mt-40">
        <Eyebrow className="mb-4">{t('builder.step1')}</Eyebrow>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {packages.map((p) => {
            const active = pkg?.id === p.id
            return (
              <button key={p.id} type="button" disabled={!p.enabled} aria-pressed={active} onClick={() => { if (student) { if (p.maxCourses < selectedGroups.length) notify(t('builder.switchPackageWarn'), 'warn'); setBuilderPackage(student.id, p.id) } }} className={cx('card flex items-start justify-between gap-3 p-5 text-left transition disabled:opacity-40', active ? 'ring-inset-forest border-forest bg-sage/40' : 'hover:border-forest/40')}>
                <div>
                  <div className="font-display text-3xl text-charcoal">{tr(p.name)}</div>
                  <div className="text-xs text-charcoal/55">{t('builder.simultaneous', { n: p.maxCourses })}</div>
                  <p className="mt-2 text-sm text-charcoal/65">{tr(p.description)}</p>
                  {!p.enabled && <div className="mt-2 text-xs text-amber-800">{t('builder.packageDisabled')}</div>}
                </div>
                <span className={cx('mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border', active ? 'border-forest bg-forest text-ivory' : 'border-charcoal/20')}>{active && <Icon name="check" className="h-3.5 w-3.5" />}</span>
              </button>
            )
          })}
          <button type="button" aria-pressed={!pkg} onClick={() => { if (student) setBuilderPackage(student.id, null) }} className={cx('card flex items-start justify-between gap-3 p-5 text-left transition', !pkg ? 'ring-inset-forest border-forest bg-sage/40' : 'hover:border-forest/40')}>
            <div>
              <div className="font-display text-3xl text-charcoal">{t('builder.custom')}</div>
              <p className="mt-2 text-sm text-charcoal/65">{t('builder.customHint', { n: MAX_CART_COURSES })}</p>
            </div>
            <span className={cx('mt-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border', !pkg ? 'border-forest bg-forest text-ivory' : 'border-charcoal/20')}>{!pkg && <Icon name="check" className="h-3.5 w-3.5" />}</span>
          </button>
        </div>
      </section>

      {/* Ready-made packages next to Flex, Winx and Build Your Own: university preparation packages (published ones only). */}
      <UniversityPackagesSection presets={presets ?? []} universities={universities ?? []} courses={courses} cartGroupIds={student?.builder.groupIds ?? []} onAdd={startPreset} />

        {/* Step 2 — courses */}
        <section id="builder-courses" className="min-w-0 scroll-mt-40">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <Eyebrow>{t('builder.step2')}</Eyebrow>
            <div className="flex gap-2">
              <div className="relative min-w-0 flex-1 sm:flex-none"><Icon name="search" className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-charcoal/40" /><Input aria-label={t('common.search')} className="w-full pl-9 py-2 sm:w-48" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
              <div className="w-36 shrink-0 sm:w-44"><Select aria-label={t('common.category')} className="py-2" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">{t('common.all')}</option>{categories.map((c) => <option key={c.id} value={c.id}>{tr(c.name)}</option>)}</Select></div>
            </div>
          </div>
          {!pkg && <Notice tone="info" className="mb-4">{t('builder.customHint', { n: MAX_CART_COURSES })}</Notice>}
          <ul className="space-y-2">
            {list.map((c) => {
              const selected = selectedCourseIds.has(c.id)
              const g = selectedGroups.find((x) => x.courseId === c.id)
              const clashes = !selected && c.groups.every((cg) => selectedGroups.some((sg) => overlaps(cg, sg)))
              const limit = !selected && selectedGroups.length >= maxSelectable
              const allFull = !selected && c.groups.every((cg) => isGroupFull(cg, students, student?.id))
              const center = centers.find((x) => x.id === c.centerId)
              return (
                <li key={c.id} className={cx('card flex flex-wrap items-center gap-x-4 gap-y-3 p-3 transition sm:flex-nowrap', selected && 'border-forest/50 bg-sage/30')}>
                  <ArtCover seed={c.coverSeed} tone={center?.tone} imageUrl={c.imageUpload?.previewUrl || c.imageUrl} className="hidden h-16 w-24 shrink-0 rounded-control sm:block" />
                  <div className="w-full min-w-0 sm:w-auto sm:flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link to={`/courses/${c.id}`} className="truncate font-medium text-charcoal hover:text-forest">{tr(c.title)}</Link>
                      <Badge tone="muted">{tr(categories.find((x) => x.id === c.categoryId)?.name)}</Badge>
                      {clashes && <Badge tone="danger"><Icon name="warn" className="h-3 w-3" />{t('builder.conflict')}</Badge>}
                      {allFull && <Badge tone="warn">{t('capacity.full')}</Badge>}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-charcoal/55">
                      <span>{center?.name}</span>
                      <ScheduleChips group={g ?? c.groups[0]} compact />
                      {c.groups.length > 1 && !g && <span className="text-charcoal/40">+{countLabel(lang, c.groups.length - 1, NOUNS.group)}</span>}
                    </div>
                  </div>
                  <div className="mr-auto shrink-0 sm:mr-0 sm:text-right">
                    <div className="text-sm font-medium text-charcoal"><PriceNow course={c} /></div>
                    <div className="text-[10px] text-charcoal/45">{t('common.som')} {t('common.perMonth')}</div>
                  </div>
                  {selected ? (
                    <div className="flex shrink-0 gap-1">
                      {c.groups.length > 1 && <Button size="sm" variant="ghost" onClick={() => setPicker(c)} aria-label={t('builder.changeGroup')}><Icon name="refresh" className="h-3.5 w-3.5" /></Button>}
                      <Button size="sm" variant="secondary" onClick={() => student && removeBuilderCourse(student.id, c.id)}><Icon name="x" className="h-3.5 w-3.5" />{t('common.remove')}</Button>
                    </div>
                  ) : (
                    <Button size="sm" disabled={limit || allFull} title={limit ? (pkg ? t('builder.limitReached') : t('builder.customLimit', { n: MAX_CART_COURSES })) : allFull ? t('capacity.fullHint') : undefined} onClick={() => onAddCourse(c)}><Icon name="plus" className="h-3.5 w-3.5" />{t('common.add')}</Button>
                  )}
                </li>
              )
            })}
          </ul>
        </section>

      <Modal closeOnBackdrop open={!!picker} onClose={() => setPicker(null)} title={picker ? `${t('courses.chooseGroup')} — ${tr(picker.title)}` : ''}>
        {picker && (
          <ul className="space-y-2">
            {picker.groups.map((g) => {
              const clash = selectedGroups.filter((sg) => sg.courseId !== picker.id).find((sg) => overlaps(g, sg))
              const current = student?.builder.groupIds.includes(g.id)
              const full = isGroupFull(g, students, student?.id)
              return (
                <li key={g.id}>
                  <button type="button" disabled={!!clash || full} onClick={() => tryAdd(g.id)} className={cx('card flex w-full items-center justify-between gap-3 p-4 text-left transition disabled:opacity-50', current ? 'border-forest bg-sage/40' : 'hover:border-forest/40')}>
                    <div>
                      <div className="text-sm font-medium text-charcoal">{g.name}</div>
                      <div className="mt-1"><ScheduleChips group={g} /></div>
                      <div className="mt-1 text-[11px] text-charcoal/50">{t('common.room')} {g.room} · {t('capacity.students', { n: enrolledCount(students, g.id, student?.id), max: g.capacity })}</div>
                      {clash && <div className="mt-1 text-[11px] text-red-700">{t('builder.conflict')}: {tr(courses.find((c) => c.id === clash.courseId)?.title)}</div>}
                      {full && <div className="mt-1 text-[11px] text-amber-800">{t('capacity.full')} — {t('capacity.fullHint')}</div>}
                    </div>
                    {current ? <Icon name="check" className="h-5 w-5 text-forest" /> : <Icon name="plus" className="h-5 w-5 text-charcoal/40" />}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </Modal>
    </div>
  )
}
