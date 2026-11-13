import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { activePercent, carouselCourses, countLabel, isOnlineCourse, isPublicListed, MAX_CART_COURSES, NOUNS, priceTotals } from '@ilmora/shared'
import type { TKey } from '../i18n/translations'
import { useT } from '../i18n/useT'
import { formatSom } from '../lib/format'
import { useStore } from '../store/useStore'
import type { Course, Package } from '../types'
import { CoursePrice, FormatBadge, PriceNow, ScheduleChips, TotalPrice } from './course/CourseCard'
import { SaleRibbon } from './course/DiscountShowcase'
import { getCoursePhotoUrl } from './course/courseImage'
import { Icon, LinkButton, SectionHeading } from './ui'
import { cx } from './ui/helpers'

/** The six steps from the catalog to the first lesson; the texts are in the dictionary (journey.s1 … journey.s6). */
const STEPS = [
  { icon: 'search', path: '/courses' },
  { icon: 'check', path: '/courses' },
  { icon: 'layers', path: '/builder' },
  { icon: 'star', path: '/builder' },
  { icon: 'cart', path: '/builder' },
  { icon: 'play', path: '/student' },
] as const

/** How long each step stays on screen while the tour plays by itself. */
const STEP_MS = 5200

/** The visitor's reduced-motion setting, followed live (false while rendering on the server). */
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)'
const subscribeReducedMotion = (onChange: () => void) => {
  const mq = window.matchMedia(REDUCED_MOTION)
  mq.addEventListener('change', onChange)
  return () => mq.removeEventListener('change', onChange)
}
const useReducedMotion = () => useSyncExternalStore(subscribeReducedMotion, () => window.matchMedia(REDUCED_MOTION).matches, () => false)

const key = (i: number, part: 'title' | 'body' | 'short') => `journey.s${i + 1}.${part}` as TKey

/** Real catalog data for the demonstration: discounted courses first (so the price step shows a real discount), then others. */
function useDemoData() {
  const courses = useStore((s) => s.courses)
  const packages = useStore((s) => s.site.packages)
  const offline = courses.filter((c) => isPublicListed(c) && !isOnlineCourse(c) && c.groups.length > 0)
  const discounted = carouselCourses(offline)
  const picks = [...discounted, ...offline.filter((c) => !discounted.includes(c))].slice(0, 3)
  const online = courses.find((c) => isPublicListed(c) && isOnlineCourse(c))
  const shown = online && picks.length >= 2 ? [picks[0], picks[1], online] : picks
  return { shown, chosen: picks.slice(0, 2), packages: packages.filter((p) => p.enabled) }
}

/** A small course tile made of the real card parts: photo, format, SALE ribbon, title and price. */
function MiniCourse({ course, picked, delay }: { course: Course; picked?: boolean; delay?: number }) {
  const { t, tr } = useT()
  const sale = isOnlineCourse(course) ? 0 : activePercent(course)
  return (
    <div className={cx('relative overflow-hidden rounded-xl border bg-paper shadow-2xs transition-colors duration-500', picked ? 'border-forest ring-2 ring-forest/30' : sale ? 'border-champagne/70' : 'border-charcoal/10')}>
      <div className="relative aspect-[16/9] overflow-hidden bg-sage/20">
        <img src={getCoursePhotoUrl(course)} alt="" loading="lazy" className="h-full w-full object-cover" />
        {sale > 0 && <SaleRibbon percent={sale} className="absolute right-1.5 top-1.5 scale-90" />}
        {picked && (
          <span className="journey-pop absolute left-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-forest text-ivory shadow" style={{ '--d': `${delay ?? 0}ms` } as CSSProperties}>
            <Icon name="check" className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
      <div className="space-y-1 p-2">
        <FormatBadge course={course} className="scale-90 origin-left" />
        <div className="line-clamp-1 font-display text-sm leading-snug text-charcoal">{tr(course.title)}</div>
        <div className="text-[11px]">{isOnlineCourse(course) ? <span className="font-semibold text-forest">{t('online.free')}</span> : <PriceNow course={course} withCurrency />}</div>
      </div>
    </div>
  )
}

/** The screen shown inside the frame for one step; every element is a real ILMORA component or real data. */
function DemoScreen({ step, data }: { step: number; data: ReturnType<typeof useDemoData> }) {
  const { t, tr, lang } = useT()
  const { shown, chosen, packages } = data
  const totals = priceTotals(chosen)
  if (shown.length < 2) return <p className="p-6 text-sm text-charcoal/60">{t(key(step, 'body'), { n: MAX_CART_COURSES })}</p>

  if (step === 0 || step === 1) {
    return (
      <div className="space-y-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          {(['format.all', 'format.offline', 'format.online'] as const).map((k, i) => (
            <span key={k} className={cx('rounded-lg px-2.5 py-1 text-[11px] font-semibold', i === 0 ? 'bg-forest text-ivory' : 'bg-sage/50 text-forest')}>{t(k)}</span>
          ))}
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-charcoal/12 bg-ivory/70 px-2.5 py-1 text-[11px] text-charcoal/50">
            <Icon name="search" className="h-3 w-3" />
            <span className="journey-typing">{t('courses.searchPlaceholder')}</span>
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {shown.map((c, i) => (
            <div key={c.id} className="journey-pop" style={{ '--d': `${120 + i * 140}ms` } as CSSProperties}>
              <MiniCourse course={c} picked={step === 1 && chosen.includes(c)} delay={500 + i * 450} />
            </div>
          ))}
        </div>
        {step === 1 && (
          <div className="journey-pop flex items-center justify-between rounded-lg bg-forest px-3 py-2 text-[11px] font-semibold text-ivory" style={{ '--d': '1300ms' } as CSSProperties}>
            <span>{chosen.length} {t('builder.coursesSelected')}</span>
            <Icon name="arrowRight" className="h-3.5 w-3.5" />
          </div>
        )}
      </div>
    )
  }

  if (step === 2) {
    const flex = packages.find((p) => p.maxCourses === chosen.length) ?? packages[0]
    const tiles: { id: string; name: string; range: string; pkg?: Package }[] = [
      ...packages.slice(0, 2).map((p) => ({ id: p.id, name: tr(p.name), range: countLabel(lang, p.maxCourses, NOUNS.course), pkg: p })),
      { id: 'custom', name: t('builder.custom'), range: t('packages.byoRange', { n: MAX_CART_COURSES }) },
    ]
    return (
      <div className="grid gap-2 p-3 sm:grid-cols-3 sm:p-4">
        {tiles.map((tile, i) => {
          const on = tile.id === flex?.id
          return (
            <div key={tile.id} className={cx('journey-pop relative rounded-xl border p-3 transition-colors', on ? 'border-forest bg-forest text-ivory shadow-soft' : 'border-charcoal/12 bg-paper text-charcoal')} style={{ '--d': `${150 + i * 160}ms` } as CSSProperties}>
              {on && <span className="journey-pop absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-champagne text-forest" style={{ '--d': '900ms' } as CSSProperties}><Icon name="check" className="h-3 w-3" /></span>}
              <Icon name={tile.pkg ? 'layers' : 'sparkle'} className={cx('h-4 w-4', on ? 'text-champagne' : 'text-forest')} />
              <div className="mt-2 font-display text-lg leading-tight">{tile.name}</div>
              <div className={cx('mt-0.5 text-[11px]', on ? 'text-ivory/75' : 'text-charcoal/55')}>{tile.range}</div>
            </div>
          )
        })}
      </div>
    )
  }

  if (step === 3) {
    return (
      <div className="space-y-2 p-3 sm:p-4">
        {chosen.map((c, i) => (
          <div key={c.id} className="journey-pop flex items-center justify-between gap-3 rounded-lg border border-charcoal/10 bg-paper px-3 py-2" style={{ '--d': `${150 + i * 160}ms` } as CSSProperties}>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-charcoal">{tr(c.title)}</div>
              {activePercent(c) > 0 && <SaleRibbon percent={activePercent(c)} className="mt-1 scale-90 origin-left" />}
            </div>
            <CoursePrice course={c} className="shrink-0 justify-end text-right" />
          </div>
        ))}
        <div className="journey-pop flex items-end justify-between gap-3 rounded-lg bg-gradient-to-r from-champagne/25 to-paper px-3 py-2" style={{ '--d': '700ms' } as CSSProperties}>
          <span className="text-xs font-semibold uppercase tracking-wider text-charcoal/55">{t('builder.monthlyTotal')}</span>
          <TotalPrice list={totals.list} final={totals.final} />
        </div>
      </div>
    )
  }

  if (step === 4) {
    return (
      <div className="p-3 sm:p-4">
        <div className="flex items-center justify-end gap-2">
          <span className="text-xs font-semibold text-charcoal/60">{t('nav.cart')}</span>
          <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-full border border-charcoal/12 bg-paper text-forest">
            <Icon name="cart" className="h-4 w-4" />
            <span className="journey-pop absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-champagne px-1 text-[10px] font-bold text-forest" style={{ '--d': '450ms' } as CSSProperties}>{chosen.length}</span>
          </span>
        </div>
        <div className="journey-pop ml-auto mt-2 max-w-sm rounded-xl border border-charcoal/10 bg-paper p-3 shadow-lift" style={{ '--d': '650ms' } as CSSProperties}>
          {chosen.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 border-b border-charcoal/8 py-1.5 text-xs last:border-0">
              <span className="truncate text-charcoal">{tr(c.title)}</span>
              <span className="shrink-0 font-semibold text-forest"><PriceNow course={c} /></span>
            </div>
          ))}
          <div className="mt-2 flex items-center justify-between text-xs">
            <span className="text-charcoal/55">{t('builder.monthlyTotal')}</span>
            <span className="font-display text-base text-charcoal">{formatSom(totals.final, lang)}</span>
          </div>
          <span className="mt-2 flex items-center justify-center gap-1.5 rounded-control bg-forest px-3 py-2 text-xs font-semibold text-ivory">
            {t('checkout.title')} <Icon name="arrowRight" className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
    )
  }

  // Step 6: the student cabinet after payment.
  const first = chosen[0]
  return (
    <div className="grid gap-3 p-3 sm:grid-cols-[9rem_1fr] sm:p-4">
      <div className="hidden space-y-1 rounded-xl bg-sage/40 p-2 text-[11px] text-forest sm:block">
        {(['dash.overview', 'student.subscription', 'student.timetable', 'student.attendance'] as const).map((k, i) => (
          <div key={k} className={cx('rounded-md px-2 py-1', i === 0 && 'bg-forest text-ivory')}>{t(k)}</div>
        ))}
      </div>
      <div className="space-y-2">
        <div className="journey-pop text-[11px] font-semibold uppercase tracking-wider text-champagne" style={{ '--d': '100ms' } as CSSProperties}>{t('dash.studentSpace')}</div>
        <div className="journey-pop rounded-xl border border-charcoal/10 bg-paper p-3" style={{ '--d': '300ms' } as CSSProperties}>
          <div className="text-[11px] text-charcoal/55">{t('student.nextLesson')}</div>
          <div className="mt-0.5 font-display text-base text-charcoal">{tr(first.title)}</div>
          {first.groups[0] && <div className="mt-1"><ScheduleChips group={first.groups[0]} compact /></div>}
        </div>
        <div className="journey-pop flex items-center gap-2 rounded-xl border border-champagne/60 bg-champagne/15 px-3 py-2 text-xs text-forest" style={{ '--d': '550ms' } as CSSProperties}>
          <Icon name="grid" className="h-4 w-4" />
          <span className="font-semibold">{t('attend.title')}</span>
          <span className="text-charcoal/60">· {t('session.qrTitle')}</span>
        </div>
      </div>
    </div>
  )
}

/**
 * "How ILMORA works" (section type `journey`, home and How It Works pages): six steps beside a browser frame that shows
 * each step with the real catalog, packages, prices, cart and student cabinet. The tour plays by itself while on screen
 * (there is no pause control; it only rests while hovered or focused), and every step can be opened directly; with
 * reduced motion it never plays by itself and the screens appear without animation.
 */
export function JourneySection({ title, subtitle }: { title?: string; subtitle?: string }) {
  const { t } = useT()
  const data = useDemoData()
  const [step, setStep] = useState(0)
  const [hovered, setHovered] = useState(false)
  const [inView, setInView] = useState(false)
  const reduced = useReducedMotion()
  const root = useRef<HTMLElement>(null)
  const playing = inView && !hovered && !reduced

  useEffect(() => {
    const el = root.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.35 })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  useEffect(() => {
    if (!playing) return
    const timer = setTimeout(() => setStep((s) => (s + 1) % STEPS.length), STEP_MS)
    return () => clearTimeout(timer)
  }, [playing, step])

  const go = (i: number) => setStep((i + STEPS.length) % STEPS.length)

  return (
    <section ref={root} className="relative overflow-hidden bg-paper py-20 lg:py-28">
      <div className="float-a pointer-events-none absolute -right-28 top-12 h-80 w-80 rounded-full border border-champagne/30" aria-hidden="true" />
      <div className="container-x relative">
        <SectionHeading eyebrow={t('journey.eyebrow')} title={title || t('journey.title')} subtitle={subtitle || t('journey.subtitle')} align="center" />
        <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.3fr)] lg:items-start" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocus={() => setHovered(true)} onBlur={() => setHovered(false)}>
          {/* Steps: a vertical list with a progress line on wide screens, a scrollable row of chips on phones */}
          <ol className="relative flex gap-2 overflow-x-auto pb-1 lg:block lg:space-y-1 lg:overflow-visible lg:pb-0" aria-label={t('journey.title')}>
            <span className="pointer-events-none absolute bottom-6 left-[1.45rem] top-6 hidden w-px bg-charcoal/12 lg:block" aria-hidden="true" />
            <span className="journey-progress pointer-events-none absolute left-[1.45rem] top-6 hidden w-px origin-top bg-forest lg:block" style={{ height: 'calc(100% - 3rem)', transform: `scaleY(${step / (STEPS.length - 1)})` }} aria-hidden="true" />
            {STEPS.map((s, i) => {
              const active = i === step
              const done = i < step
              return (
                <li key={i} className="shrink-0 lg:shrink">
                  <button
                    type="button"
                    onClick={() => go(i)}
                    aria-current={active ? 'step' : undefined}
                    className={cx('group relative flex w-full items-start gap-3 rounded-2xl px-2 py-2 text-left transition-colors duration-300 lg:px-2.5 lg:py-3', active ? 'bg-ivory shadow-soft ring-1 ring-champagne/50' : 'hover:bg-ivory/60')}
                  >
                    <span className={cx('relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors duration-300', active ? 'journey-current border-champagne bg-champagne text-forest' : done ? 'border-forest bg-forest text-ivory' : 'border-charcoal/20 bg-paper text-charcoal/55')}>
                      {done ? <Icon name="check" className="h-3.5 w-3.5" /> : <Icon name={s.icon} className="h-3.5 w-3.5" />}
                    </span>
                    <span className="min-w-0 pr-1">
                      <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-champagne">{t('journey.step', { n: i + 1 })}</span>
                      <span className={cx('block whitespace-nowrap font-display text-base leading-snug lg:whitespace-normal lg:text-lg', active ? 'text-forest' : 'text-charcoal')}>
                        <span className="lg:hidden">{t(key(i, 'short'))}</span>
                        <span className="hidden lg:inline">{t(key(i, 'title'))}</span>
                      </span>
                      {active && <span className="mt-1 hidden text-sm leading-relaxed text-charcoal/65 lg:block">{t(key(i, 'body'), { n: MAX_CART_COURSES })}</span>}
                      {active && (
                        <span className="mt-2 hidden h-0.5 w-full overflow-hidden rounded-full bg-charcoal/10 lg:block" aria-hidden="true">
                          <span key={step} className="journey-timer block h-full bg-champagne" style={{ animationDuration: `${STEP_MS}ms`, animationPlayState: playing ? 'running' : 'paused' }} />
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>

          {/* The browser frame with the screen for the current step */}
          <div>
            <div className="overflow-hidden rounded-[1.25rem] border border-charcoal/12 bg-ivory shadow-lift">
              <div className="flex items-center gap-2 border-b border-charcoal/10 bg-paper px-3 py-2">
                <span className="flex gap-1" aria-hidden="true"><span className="h-2.5 w-2.5 rounded-full bg-charcoal/15" /><span className="h-2.5 w-2.5 rounded-full bg-charcoal/15" /><span className="h-2.5 w-2.5 rounded-full bg-charcoal/15" /></span>
                <span className="mx-auto truncate rounded-md bg-ivory px-3 py-0.5 text-[11px] text-charcoal/55">ilmoraa.uz{STEPS[step].path}</span>
                {/* Same width as the three dots, so the address stays centred */}
                <span className="w-[38px] shrink-0" aria-hidden="true" />
              </div>
              <div key={step} className="journey-screen min-h-[17rem] bg-gradient-to-b from-ivory to-paper" aria-live="polite">
                <span className="sr-only">{t('journey.step', { n: step + 1 })}: {t(key(step, 'title'))}. {t(key(step, 'body'), { n: MAX_CART_COURSES })}</span>
                <DemoScreen step={step} data={data} />
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className="text-sm leading-relaxed text-charcoal/65 lg:hidden">{t(key(step, 'body'), { n: MAX_CART_COURSES })}</p>
              <p className="hidden text-[11px] text-charcoal/45 lg:block">{t('journey.demoNote')}</p>
              <div className="flex shrink-0 gap-1.5">
                <button type="button" onClick={() => go(step - 1)} aria-label={t('common.back')} className="flex h-9 w-9 items-center justify-center rounded-full border border-charcoal/15 bg-paper text-charcoal/65 hover:border-forest/40 hover:text-forest"><Icon name="arrowLeft" className="h-4 w-4" /></button>
                <button type="button" onClick={() => go(step + 1)} aria-label={t('common.next')} className="flex h-9 w-9 items-center justify-center rounded-full border border-charcoal/15 bg-paper text-charcoal/65 hover:border-forest/40 hover:text-forest"><Icon name="arrowRight" className="h-4 w-4" /></button>
              </div>
            </div>
          </div>
        </div>
        <div className="mt-10 flex flex-wrap justify-center gap-3">
          <LinkButton to="/builder" size="lg">{t('journey.cta')} <Icon name="arrowRight" className="h-4 w-4" /></LinkButton>
          <LinkButton to="/course-finder" size="lg" variant="secondary">{t('finder.title')}</LinkButton>
        </div>
      </div>
    </section>
  )
}

/**
 * The same six steps as a compact tracker beside the course selection in the builder. Steps done so far are ticked, the
 * current one is highlighted and explained in one line, and each reachable step takes the student to its part of the page.
 */
export function JourneyTracker({ done, current, onStep, canReview }: { done: boolean[]; current: number; onStep: (step: number) => void; canReview: boolean }) {
  const { t } = useT()
  return (
    <nav aria-label={t('journey.title')} className="mb-8 rounded-card border border-champagne/40 bg-gradient-to-r from-paper via-ivory to-sage/30 px-3 py-4 sm:px-5">
      <ol className="relative grid grid-cols-6">
        {STEPS.map((s, i) => {
          const isDone = done[i]
          const isCurrent = i === current
          // Step 6 (start learning) happens after payment; step 5 opens the review and payment page once the selection is complete.
          const reachable = i < 4 || (i === 4 && canReview)
          return (
            <li key={i} className="relative flex flex-col items-center text-center">
              {i > 0 && <span className={cx('absolute right-1/2 top-4 h-px w-full -translate-y-1/2 transition-colors duration-500', done[i - 1] ? 'bg-forest/60' : 'bg-charcoal/15')} aria-hidden="true" />}
              <button
                type="button"
                disabled={!reachable}
                onClick={() => onStep(i)}
                aria-current={isCurrent ? 'step' : undefined}
                className="group relative z-10 flex flex-col items-center gap-1.5 rounded-control px-0.5 disabled:cursor-default"
              >
                <span className={cx(
                  'flex h-8 w-8 items-center justify-center rounded-full border text-xs font-semibold transition duration-300',
                  isDone ? 'border-forest bg-forest text-ivory' : isCurrent ? 'journey-current relative border-champagne bg-champagne text-forest' : 'border-charcoal/20 bg-paper text-charcoal/55',
                  reachable && !isDone && !isCurrent && 'group-hover:border-forest/50 group-hover:text-forest',
                )}>
                  {isDone ? <Icon name="check" className="h-3.5 w-3.5" /> : <Icon name={s.icon} className="h-3.5 w-3.5" />}
                </span>
                <span className={cx('text-[10px] font-medium leading-tight sm:text-xs', isCurrent ? 'text-forest' : 'text-charcoal/60')}>{t(key(i, 'short'))}</span>
                <span className="sr-only">{t('journey.step', { n: i + 1 })}: {t(key(i, 'title'))}{isDone ? `, ${t('journey.done')}` : ''}</span>
              </button>
            </li>
          )
        })}
      </ol>
      <p className="mt-3 text-center text-xs leading-relaxed text-charcoal/65" aria-live="polite">
        <span className="font-semibold text-forest">{t('journey.step', { n: current + 1 })}: {t(key(current, 'title'))}.</span> {t(key(current, 'body'), { n: MAX_CART_COURSES })}
      </p>
    </nav>
  )
}
