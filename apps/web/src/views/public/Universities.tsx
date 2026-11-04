import { isPreparationTrack, isUniversityListed, presetCourses, presetNeedsConfirmation, universityName, presetDurationMonths, presetsForDirection, presetTotal, priceTotals, universityDirections } from '@ilmora/shared'
import Image from 'next/image'
import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams } from '@/lib/router'
import { NotFound } from '../../components/AccessGate'
import { CountUp } from '../../components/motion'
import { CoursePrice, PriceNow, ScheduleChips, TotalPrice } from '../../components/course/CourseCard'
import { Badge, Button, cx, Eyebrow, Icon, LinkButton, PageTitle } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { dict, type TKey } from '../../i18n/translations'
import { formatSom } from '../../lib/format'
import { balancedLogoSize } from '../../lib/logoSize'
import { useCurrentStudent } from '../../store/selectors'
import { usePresetCart } from '../../store/usePresetCart'
import { useStore } from '../../store/useStore'
import type { AdmissionSource, Course, Preset, PresetSlot, Section, University, UniversityDirection } from '../../types'

/**
 * University Admission: university → faculty → direction → package → cart. Only published packages are shown (the
 * public site configuration carries no drafts). A university appears when the admin marked it published or once it has
 * a published package; one whose packages are still being verified shows its faculties and directions without a package.
 * Prices are the included courses' own monthly prices with their active discounts. "Add to cart" puts the whole package
 * in the regular cart at once (usePresetCart), so groups, schedule checks and payment stay the existing ones.
 */

interface UniversityGroup {
  university: University
  presets: Preset[]
}

/**
 * How each ready-made preparation direction looks, in the order they are shown: its photo, the icon it shows in place of a
 * logo, and the subjects named on its card (the detail page lists the exact requirements of each route).
 */
const TRACK_VISUALS: Record<string, { image: string; position?: string; icon: string; subjects: TKey[] }> = {
  'prep-general': { image: '/images/courses/mathematics.jpg', position: '38% 62%', icon: 'cap', subjects: ['uni.subject.native', 'uni.subject.math', 'uni.subject.historyUz', 'uni.subject.english'] },
  'prep-medical': { image: '/images/courses/science-lab.jpg', position: '52% 55%', icon: 'medical', subjects: ['uni.subject.biology', 'uni.subject.chemistry', 'uni.subject.english'] },
  'prep-law': { image: '/images/admission/law-library.jpg', position: '50% 40%', icon: 'scale', subjects: ['uni.subject.law', 'uni.subject.history', 'uni.subject.foreign'] },
  'prep-it': { image: '/images/courses/frontend-dev.jpg', position: '32% 42%', icon: 'cpu', subjects: ['uni.subject.math', 'uni.subject.physics', 'uni.subject.computing'] },
  'prep-economics': { image: '/images/courses/python-data.jpg', position: '40% 62%', icon: 'chart', subjects: ['uni.subject.math', 'uni.subject.foreign'] },
}
const TRACK_ORDER = Object.keys(TRACK_VISUALS)
const trackRank = (u: University): number => (TRACK_ORDER.includes(u.id) ? TRACK_ORDER.indexOf(u.id) : TRACK_ORDER.length)

/**
 * What visitors see, each with its published packages: those with a package first, then alphabetical. Universities by
 * default; `tracks` gives the ready-made preparation directions instead (in the order of TRACK_VISUALS), and `all` both.
 */
function useListedUniversities(which: 'universities' | 'tracks' | 'all' = 'universities'): UniversityGroup[] {
  const { lang } = useT()
  const presets = useStore((s) => s.site.presets)
  const universities = useStore((s) => s.site.universities)
  return useMemo(() => {
    const live = (presets ?? []).filter((p) => p.enabled && p.universityId)
    return (universities ?? [])
      .filter((university) => isUniversityListed(university, live) && (which === 'all' || (which === 'tracks') === isPreparationTrack(university)))
      .map((university) => ({ university, presets: live.filter((p) => p.universityId === university.id) }))
      .sort((a, b) => trackRank(a.university) - trackRank(b.university) || Number(b.presets.length > 0) - Number(a.presets.length > 0) || universityName(a.university, lang).localeCompare(universityName(b.university, lang), lang))
  }, [presets, universities, which, lang])
}

/** Lowest monthly price among the packages, counting only their required courses (0 when none can be priced). */
const lowestPrice = (presets: Preset[], courses: Course[]): number => {
  const prices = presets.map((p) => presetTotal(presetCourses(p, courses, []))).filter((n) => n > 0)
  return prices.length ? Math.min(...prices) : 0
}

/** A city or country in the reader's language (the stored values are English; unknown ones are shown as stored). */
export const placeName = (t: (key: TKey) => string, value?: string): string => {
  const key = `uni.place.${value}`
  return value ? (key in dict ? t(key as TKey) : value) : ''
}

/** "City, Country" in the reader's language. */
function usePlace(university?: Pick<University, 'city' | 'country'>): string {
  const { t } = useT()
  return [placeName(t, university?.city), placeName(t, university?.country)].filter(Boolean).join(', ')
}

/**
 * The official logo straight on the background: no box, frame or padding. Its size is balanced by shape
 * (balancedLogoSize), so a square emblem and a wide word mark look equally large without being forced into one size;
 * the logo keeps its own proportions and is never cropped. The area is always `height` tall, so cards line up. A logo
 * with its own background (CAU's navy square) keeps it; a light logo marked "on dark" sits on a green plate. A
 * preparation track shows its icon on a medallion, a university without a logo its short name.
 */
export function UniversityLogo({ university, height = 56, maxWidth, align = 'center', className }: { university: University; height?: number; maxWidth?: number; align?: 'center' | 'start'; className?: string }) {
  const { t, lang } = useT()
  const [failed, setFailed] = useState(false)
  const [aspect, setAspect] = useState<number | null>(null)
  // Also measures an image that finished loading before React attached its handlers (server-rendered pages).
  const measure = useCallback((img: HTMLImageElement | null) => {
    if (img?.complete && img.naturalWidth > 0 && img.naturalHeight > 0) setAspect(img.naturalWidth / img.naturalHeight)
  }, [])
  const zone = cx('flex shrink-0 items-center', align === 'start' ? 'justify-start' : 'justify-center', className)
  const room = maxWidth ?? height * 3.4

  if (isPreparationTrack(university) && !university.logoUrl) {
    const d = Math.round(height * 0.86)
    return (
      <span aria-hidden="true" className={zone} style={{ height }}>
        <span className="flex items-center justify-center rounded-full bg-gradient-to-br from-forest to-[color-mix(in_srgb,var(--c-forest)_78%,var(--c-champagne))] text-champagne shadow-soft ring-4 ring-champagne/25" style={{ width: d, height: d }}>
          <Icon name={TRACK_VISUALS[university.id]?.icon ?? 'layers'} className="h-[42%] w-[42%]" />
        </span>
      </span>
    )
  }
  if (university.logoUrl && !failed) {
    const plate = !!university.logoOnDark
    const size = aspect ? balancedLogoSize(aspect, plate ? height * 0.66 : height, plate ? room - 32 : room) : null
    const img = (
      <img
        ref={measure}
        src={university.logoUrl}
        alt={t('uni.logoAlt', { name: universityName(university, lang) })}
        decoding="async"
        onLoad={(e) => measure(e.currentTarget)}
        onError={() => setFailed(true)}
        className={cx('block max-w-full rounded-[min(12%,10px)] object-contain transition-opacity duration-500', size ? 'opacity-100' : 'opacity-0')}
        style={size ?? { height: height * 0.6 }}
      />
    )
    return <span className={zone} style={{ height }}>{plate ? <span className="flex h-full items-center rounded-2xl bg-forest px-4">{img}</span> : img}</span>
  }
  const label = university.shortName || university.name
  return (
    <span aria-hidden="true" className={zone} style={{ height }}>
      <span className="font-display font-semibold leading-none tracking-wide text-forest" style={{ fontSize: Math.round(Math.max(14, Math.min(height * 0.5, room / Math.max(label.length * 0.62, 2)))) }}>{label}</span>
    </span>
  )
}

/** A small figure with its label above it (no plural forms needed: "Directions · 19"). */
function Stat({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx('min-w-0', className)}>
      <dt className="text-[10px] font-semibold uppercase tracking-[0.18em] text-charcoal/45">{label}</dt>
      <dd className="mt-1 font-display text-2xl leading-none text-charcoal lining-nums">{children}</dd>
    </div>
  )
}

function UniversityCard({ group, courses }: { group: UniversityGroup; courses: Course[] }) {
  const { t, lang } = useT()
  const { university, presets } = group
  const directions = universityDirections(university).length
  const from = lowestPrice(presets, courses)
  const toConfirm = presets.some(presetNeedsConfirmation)
  const place = usePlace(university)
  return (
    <Link
      to={`/universities/${university.id}`}
      className="reveal group relative flex h-full min-w-0 flex-col overflow-hidden rounded-card border border-charcoal/10 bg-paper shadow-soft transition duration-500 ease-[var(--ease-out-soft)] hover:-translate-y-1.5 hover:border-champagne/70 hover:shadow-lift focus:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2"
    >
      {/* A gold line drawn along the top edge on hover. */}
      <span aria-hidden="true" className="absolute inset-x-0 top-0 h-[3px] origin-center scale-x-0 bg-gradient-to-r from-transparent via-champagne to-transparent transition-transform duration-700 group-hover:scale-x-100" />
      <div className="relative flex justify-center px-6 pt-8">
        {/* Soft light behind the logo on hover: part of the card, not a box. */}
        <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-2 h-32 w-64 -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--c-champagne)_24%,transparent),transparent)] opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
        <UniversityLogo key={university.logoUrl} university={university} height={84} maxWidth={290} className="relative transition-transform duration-500 ease-[var(--ease-out-soft)] group-hover:scale-[1.05]" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col px-6 pb-6 pt-5">
        <span aria-hidden="true" className="mx-auto mb-5 h-px w-14 bg-gradient-to-r from-transparent via-champagne to-transparent" />
        {university.shortName && <div className="eyebrow">{university.shortName}</div>}
        <h3 className="mt-1.5 line-clamp-4 break-words font-display text-[1.65rem] leading-[1.12] text-charcoal transition-colors duration-300 group-hover:text-forest">{universityName(university, lang)}</h3>
        <div className="mt-2 flex min-w-0 items-center gap-1.5 text-xs text-charcoal/55">
          <Icon name="pin" className="h-3.5 w-3.5 shrink-0 text-champagne" />
          <span className="truncate">{place}</span>
        </div>
        {toConfirm && <span className="mt-3 inline-flex w-fit items-center gap-1 rounded-full bg-champagne/20 px-2.5 py-1 text-[11px] font-medium text-forest"><Icon name="info" className="h-3 w-3" />{t('uni.needsReview')}</span>}
        <dl className="mt-5 grid grid-cols-2 divide-x divide-charcoal/10 border-y border-charcoal/10 py-3.5 text-center">
          <Stat label={t('uni.stat.directions')}>{directions || '—'}</Stat>
          <Stat label={t('uni.stat.packages')}>{presets.length || <span className="text-sm text-charcoal/50">{t('uni.packagesSoon')}</span>}</Stat>
        </dl>
        <div className="mt-auto flex items-end justify-between gap-3 pt-5">
          <div className="min-w-0">
            {from > 0 && (
              <>
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-charcoal/45">{t('uni.perMonth')}</div>
                <div className="mt-0.5 whitespace-nowrap font-display text-xl text-forest lining-nums">{t('uni.fromPrice', { price: formatSom(from, lang) })}</div>
              </>
            )}
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-forest/25 px-4 py-2 text-xs font-semibold text-forest transition-all duration-300 group-hover:border-forest group-hover:bg-forest group-hover:text-ivory group-hover:shadow-soft">
            {t('uni.viewDetails')}<Icon name="arrowRight" className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>
    </Link>
  )
}

/**
 * A ready-made preparation direction: its photo, title, short description, subjects, the real "from" price and the way
 * into the direction's own page. Unverified requirements are marked on the photo.
 */
function DirectionCard({ group, courses, shape, className }: { group: UniversityGroup; courses: Course[]; shape: 'large' | 'solo' | 'regular'; className?: string }) {
  const { t, tr, lang } = useT()
  const { university, presets } = group
  const visual = TRACK_VISUALS[university.id]
  const from = lowestPrice(presets, courses)
  const summary = `uni.track.${university.id}`
  return (
    <Link
      to={`/universities/${university.id}`}
      className={cx('reveal group flex h-full min-w-0 flex-col overflow-hidden rounded-card border border-charcoal/10 bg-paper shadow-soft transition duration-500 ease-[var(--ease-out-soft)] hover:-translate-y-1.5 hover:border-champagne/70 hover:shadow-lift focus:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2', className)}
    >
      <div className={cx('relative isolate overflow-hidden bg-forest', { large: 'aspect-[16/10] lg:aspect-[16/8]', solo: 'aspect-[16/10] sm:aspect-[16/6] lg:aspect-[16/10]', regular: 'aspect-[16/10]' }[shape])}>
        {visual && (
          <Image
            src={visual.image}
            alt=""
            fill
            sizes={shape === 'large' ? '(min-width: 1024px) 590px, (min-width: 640px) 50vw, 100vw' : '(min-width: 1024px) 390px, (min-width: 640px) 50vw, 100vw'}
            className="object-cover transition-transform duration-[1400ms] ease-[var(--ease-out-soft)] group-hover:scale-[1.06]"
            style={{ objectPosition: visual.position }}
          />
        )}
        <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-forest via-forest/40 to-forest/5" />
        <span aria-hidden="true" className="absolute left-4 top-4 flex h-11 w-11 items-center justify-center rounded-full bg-forest/85 text-champagne ring-1 ring-champagne/50 transition duration-500 group-hover:bg-champagne group-hover:text-forest">
          <Icon name={visual?.icon ?? 'layers'} className="h-5 w-5" />
        </span>
        {presets.some(presetNeedsConfirmation) && <span className="absolute right-4 top-4 inline-flex max-w-[60%] items-center gap-1 rounded-full bg-paper/90 px-2.5 py-1 text-[11px] font-medium leading-tight text-forest"><Icon name="info" className="h-3 w-3 shrink-0" />{t('uni.needsReview')}</span>}
        <h3 className="absolute inset-x-5 bottom-4 break-words font-display text-[1.75rem] leading-[1.1] text-ivory">{universityName(university, lang)}</h3>
      </div>
      <div className="flex flex-1 flex-col p-5">
        <p className="text-sm leading-relaxed text-charcoal/70">{summary in dict ? t(summary as TKey) : tr(university.description)}</p>
        {visual && (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {visual.subjects.map((subject) => <li key={subject} className="rounded-full border border-forest/15 bg-sage/40 px-2.5 py-0.5 text-[11px] font-medium text-forest">{t(subject)}</li>)}
          </ul>
        )}
        <div className="mt-auto flex flex-wrap items-end justify-between gap-x-3 gap-y-3 pt-5">
          <div>
            {from > 0 && (
              <>
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-charcoal/45">{t('uni.perMonth')}</div>
                <div className="mt-0.5 whitespace-nowrap font-display text-xl text-forest lining-nums">{t('uni.fromPrice', { price: formatSom(from, lang) })}</div>
              </>
            )}
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-forest/25 px-3.5 py-2 text-xs font-semibold text-forest transition-all duration-300 group-hover:border-forest group-hover:bg-forest group-hover:text-ivory group-hover:shadow-soft">
            {t('uni.track.cta')}<Icon name="arrowRight" className="h-3.5 w-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
          </span>
        </div>
      </div>
    </Link>
  )
}

/** The directions as a composed grid: with five, two large cards above three regular ones. */
function DirectionGrid({ tracks, courses }: { tracks: UniversityGroup[]; courses: Course[] }) {
  const twoLarge = tracks.length % 3 === 2
  return (
    <div className="reveal-stagger mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-6">
      {tracks.map((g, i) => {
        const large = twoLarge && i < 2
        const solo = tracks.length % 2 === 1 && i === tracks.length - 1
        return <DirectionCard key={g.university.id} group={g} courses={courses} shape={large ? 'large' : solo ? 'solo' : 'regular'} className={cx(large ? 'lg:col-span-3' : 'lg:col-span-2', solo && 'sm:col-span-2')} />
      })}
    </div>
  )
}

/** "Other universities": room for the ones whose requirements are still being checked. */
function MoreSoonCard() {
  const { t } = useT()
  return (
    <div className="reveal flex h-full flex-col items-center justify-center rounded-card border border-dashed border-champagne/70 bg-gradient-to-b from-ivory/40 to-sage/30 p-8 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-paper text-forest shadow-soft ring-4 ring-champagne/20"><Icon name="building" className="h-6 w-6" /></span>
      <div className="mt-5 font-display text-2xl text-charcoal">{t('uni.moreSoon')}</div>
      <p className="mt-2 max-w-xs text-sm leading-relaxed text-charcoal/60">{t('uni.moreSoonBody')}</p>
    </div>
  )
}

export function UniversitiesPage() {
  const { t } = useT()
  const groups = useListedUniversities()
  const tracks = useListedUniversities('tracks')
  const courses = useStore((s) => s.courses)
  return (
    <div className="container-x py-12 lg:py-16">
      <PageTitle title={t('uni.page.title')} subtitle={t('uni.page.subtitle')} />
      {/* auto-rows-fr: every card the same height, whatever the length of the university's name. */}
      <div className="reveal-stagger grid gap-6 sm:auto-rows-fr sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => <UniversityCard key={g.university.id} group={g} courses={courses} />)}
        <MoreSoonCard />
      </div>
      {tracks.length > 0 && (
        <section className="mt-16" aria-labelledby="tracks-title">
          <Eyebrow>{t('uni.tracks.eyebrow')}</Eyebrow>
          <h2 id="tracks-title" className="mt-2 font-display text-3xl leading-tight text-charcoal md:text-4xl">{t('uni.tracks.title')}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-charcoal/65">{t('uni.tracks.subtitle')}</p>
          <DirectionGrid tracks={tracks} courses={courses} />
          <p className="mt-6 max-w-3xl text-xs leading-relaxed text-charcoal/55">{t('uni.tracks.note')}</p>
        </section>
      )}
      <p className="mt-10 max-w-3xl text-[11px] leading-relaxed text-charcoal/50">{t('uni.disclaimer')}</p>
    </div>
  )
}

/** A figure of the admission hero, with its label above it. */
function HeroStat({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ivory/55">{label}</dt>
      <dd className="mt-2 whitespace-nowrap font-display text-4xl leading-none text-champagne lining-nums">{children}</dd>
    </div>
  )
}

/** A small note floating over the admission photo. */
function HeroNote({ icon, className, children }: { icon: string; className?: string; children: ReactNode }) {
  return (
    <div className={cx('absolute flex max-w-[13.5rem] items-center gap-2.5 rounded-2xl border border-champagne/45 bg-paper/95 px-3.5 py-2.5 text-charcoal shadow-lift', className)}>
      <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-forest text-champagne"><Icon name={icon} className="h-4 w-4" /></span>
      <span className="text-xs font-medium leading-snug">{children}</span>
    </div>
  )
}

/**
 * Homepage section `universities` (University Admission): a large dark-green hero with the one button to the catalog,
 * the universities' logos (each opens its university) and the ready-made directions (each opens its direction). Hidden
 * while no university is shown.
 */
export function UniversitiesSection({ s }: { s: Section }) {
  const { t, tr, lang } = useT()
  const groups = useListedUniversities()
  const tracks = useListedUniversities('tracks')
  const courses = useStore((st) => st.courses)
  if (groups.length === 0) return null
  const from = lowestPrice([...groups, ...tracks].flatMap((g) => g.presets), courses)
  return (
    <section aria-labelledby="admission-title">
      <div className="relative isolate overflow-hidden bg-forest pb-28 text-ivory lg:pb-32">
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(color-mix(in_srgb,var(--c-champagne)_16%,transparent)_1px,transparent_1px)] [background-size:26px_26px] [mask-image:linear-gradient(115deg,#000,transparent_55%)]" />
        <span aria-hidden="true" className="pointer-events-none absolute -right-40 -top-40 -z-10 h-[38rem] w-[38rem] rounded-full bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--c-champagne)_30%,transparent),transparent)]" />
        <span aria-hidden="true" className="float-a pointer-events-none absolute -left-24 bottom-10 -z-10 h-72 w-72 rounded-full border border-champagne/20" />
        <span aria-hidden="true" className="float-b pointer-events-none absolute left-[42%] top-12 -z-10 h-32 w-32 rounded-full border border-champagne/15" />
        <div className="container-x grid items-center gap-14 pt-20 lg:grid-cols-[1.12fr_0.88fr] lg:gap-20 lg:pt-28">
          <div className="min-w-0">
            <Eyebrow className="reveal">{t('uni.home.eyebrow')}</Eyebrow>
            <h2 id="admission-title" className="reveal mt-5 break-words font-display text-[3.25rem] leading-[1.02] tracking-[-0.01em] text-ivory sm:text-7xl lg:text-[5.25rem]">{tr(s.title) || t('uni.page.title')}</h2>
            {tr(s.subtitle) && <p className="reveal mt-6 max-w-xl text-lg leading-relaxed text-ivory/75 lg:text-xl">{tr(s.subtitle)}</p>}
            <dl className="reveal mt-10 flex flex-wrap gap-x-10 gap-y-6 border-t border-ivory/15 pt-7">
              <HeroStat label={t('uni.universities')}><CountUp value={groups.length} /></HeroStat>
              {tracks.length > 0 && <HeroStat label={t('uni.stat.tracks')}><CountUp value={tracks.length} /></HeroStat>}
              {from > 0 && <HeroStat label={t('uni.perMonth')}><span className="text-[1.75rem]">{t('uni.fromPrice', { price: formatSom(from, lang) })}</span></HeroStat>}
            </dl>
            <LinkButton to="/universities" size="lg" variant="champagne" className="reveal mt-10">{t('uni.homeCta')} <Icon name="arrowRight" className="h-4 w-4" /></LinkButton>
          </div>
          <div className="reveal relative mx-auto w-full max-w-[24rem] lg:max-w-[27rem]">
            <span aria-hidden="true" className="absolute -inset-3 rounded-t-[999px] rounded-b-[2.25rem] border border-champagne/45" />
            <div className="relative aspect-[4/4.9] overflow-hidden rounded-t-[999px] rounded-b-[2rem] bg-charcoal shadow-lift">
              <Image src="/images/courses/university-prep.jpg" alt={t('uni.home.imageAlt')} fill sizes="(min-width: 1024px) 432px, 384px" className="ken-burns object-cover" style={{ objectPosition: '66% 50%' }} />
              <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-forest/55 via-transparent to-transparent" />
            </div>
            <HeroNote icon="check" className="float-soft -left-2 bottom-20 sm:-left-12">{t('uni.home.badge.sources')}</HeroNote>
            <HeroNote icon="layers" className="float-soft-late -right-2 bottom-5 sm:-right-8">{t('uni.home.badge.subscription')}</HeroNote>
          </div>
        </div>
      </div>

      <div className="container-x relative z-10 -mt-14">
        <ul className="reveal flex flex-wrap items-center justify-center gap-x-8 gap-y-5 rounded-[1.75rem] border border-champagne/50 bg-paper px-6 py-6 shadow-lift lg:justify-between lg:px-10" aria-label={t('uni.universities')}>
          {groups.map((g) => (
            <li key={g.university.id}>
              <Link to={`/universities/${g.university.id}`} aria-label={universityName(g.university, lang)} className="block rounded-lg opacity-85 transition duration-300 hover:-translate-y-0.5 hover:opacity-100">
                <UniversityLogo key={g.university.logoUrl} university={g.university} height={48} maxWidth={132} />
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {tracks.length > 0 && (
        <div className="container-x py-16 lg:py-24">
          <div className="reveal max-w-2xl">
            <Eyebrow>{t('uni.tracks.eyebrow')}</Eyebrow>
            <h3 className="mt-3 font-display text-4xl leading-[1.08] text-charcoal md:text-5xl">{t('uni.tracks.title')}</h3>
            <p className="mt-4 text-[17px] leading-relaxed text-charcoal/70">{t('uni.tracks.subtitle')}</p>
          </div>
          <DirectionGrid tracks={tracks} courses={courses} />
          <p className="mt-6 max-w-3xl text-xs leading-relaxed text-charcoal/55">{t('uni.tracks.note')}</p>
        </div>
      )}
    </section>
  )
}

/** A band in the course catalog that leads to the university pages; the logos stand on the band itself. Hidden while none is shown. */
export function UniversitiesBand({ className }: { className?: string }) {
  const { t } = useT()
  const groups = useListedUniversities()
  if (groups.length === 0) return null
  return (
    <Link to="/universities" className={cx('group flex flex-col gap-4 rounded-card border border-champagne/60 bg-gradient-to-r from-ivory via-paper to-champagne/25 p-5 transition duration-300 hover:border-champagne hover:shadow-lift lg:flex-row lg:items-center', className)}>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        {groups.slice(0, 4).map((g) => <UniversityLogo key={g.university.id} university={g.university} height={40} maxWidth={120} className="opacity-90 transition duration-300 group-hover:opacity-100" />)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-display text-xl text-charcoal">{t('uni.page.title')}</div>
        <p className="text-sm text-charcoal/65">{t('uni.catalogBand')}</p>
      </div>
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-forest">{t('uni.homeCta')} <Icon name="arrowRight" className="h-4 w-4 transition group-hover:translate-x-0.5" /></span>
    </Link>
  )
}

/** Official source of a package's subjects: verification state, year, check date and the page itself. */
function SourceNote({ admission }: { admission?: AdmissionSource }) {
  const { t } = useT()
  if (!admission) return null
  const verified = admission.status === 'verified'
  return (
    <div className="mt-6 rounded-control border border-charcoal/10 bg-ivory/50 px-4 py-3 text-[11px] leading-relaxed text-charcoal/60">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-charcoal/80">{t('uni.source')}</span>
        <Badge tone={verified ? 'sage' : 'warn'}>{verified ? t('uni.verified') : t('uni.needsReview')}</Badge>
      </div>
      {admission.academicYear && admission.checkedOn && <div className="mt-1">{t('uni.sourceMeta', { year: admission.academicYear, date: admission.checkedOn })}</div>}
      {/^https:\/\//.test(admission.url) && (
        <a href={admission.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 font-medium text-forest hover:underline">
          {t('uni.officialPage')} <Icon name="external" className="h-3 w-3" />
        </a>
      )}
    </div>
  )
}

/**
 * One subject of the package: the university's subject, the ILMORA course that prepares for it, its learning center,
 * schedule, length and monthly price. A subject ILMORA has no course for is still listed, marked as not covered (it
 * never enters the cart).
 */
function CourseRow({ slot, course, optional, checked, onToggle }: { slot: PresetSlot; course?: Course; optional?: boolean; checked?: boolean; onToggle?: () => void }) {
  const { t, tr } = useT()
  const center = useStore((s) => (course ? s.centers.find((c) => c.id === course.centerId) : undefined))
  if (!course) {
    return (
      <li className="flex gap-4 py-4">
        <span aria-hidden="true" className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-dashed border-champagne/70 text-champagne"><Icon name="info" className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <div className="break-words text-[11px] font-semibold uppercase tracking-wider text-charcoal/45">{tr(slot.label)}</div>
          <div className="mt-1 text-xs leading-relaxed text-charcoal/60">{t('uni.notCovered')}</div>
        </div>
      </li>
    )
  }
  const body = (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2 break-words text-[11px] font-semibold uppercase tracking-wider text-charcoal/45">
        <span className="min-w-0">{tr(slot.label)}</span>
        {optional && <span className="rounded-full bg-champagne/30 px-2 py-0.5 normal-case tracking-normal text-forest">{t('uni.optional')}</span>}
      </div>
      <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Link to={`/courses/${course.id}`} className="min-w-0 break-words font-display text-xl leading-snug text-charcoal transition hover:text-forest">{tr(course.title)}</Link>
        <CoursePrice course={course} className="shrink-0 [&_.font-display]:text-lg" />
      </div>
      {center && (
        <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-xs text-charcoal/60">
          <Icon name="building" className="h-3.5 w-3.5 shrink-0 text-forest" />
          <span className="truncate"><span className="font-medium text-charcoal/75">{center.name}</span>{tr(center.district) && <span className="text-charcoal/50"> · {tr(center.district)}</span>}</span>
        </div>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-charcoal/60">
        {course.groups[0] && <span className="inline-flex flex-wrap items-center gap-1.5"><ScheduleChips group={course.groups[0]} compact />{course.groups.length > 1 && <span className="text-[11px] text-charcoal/45">+{course.groups.length - 1}</span>}</span>}
        {course.durationMonths > 0 && <span className="inline-flex items-center gap-1"><Icon name="clock" className="h-3.5 w-3.5" />{t('uni.courseMonths', { n: course.durationMonths })}</span>}
      </div>
    </div>
  )
  const mark = <span aria-hidden="true" className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sage text-forest"><Icon name="check" className="h-4 w-4" /></span>
  if (!optional) return <li className="flex gap-4 py-4">{mark}{body}</li>
  return (
    <li className="py-4">
      <label className={cx('-m-2 flex cursor-pointer gap-4 rounded-control p-2 transition', checked ? 'bg-sage/40' : 'hover:bg-ivory')}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center"><input type="checkbox" checked={!!checked} onChange={onToggle} className="h-4 w-4 accent-forest" /></span>
        {body}
      </label>
    </li>
  )
}

/**
 * A package: its courses (center, schedule, length, price), optional extras, the official source and a price summary
 * with "Add to cart", which puts the whole package in the cart at once; afterwards it links to the cart.
 */
function PackageOffer({ preset, courses, directionId }: { preset: Preset; courses: Course[]; directionId?: string }) {
  const { t, tr } = useT()
  const [extras, setExtras] = useState<string[]>([])
  const student = useCurrentStudent()
  const addToCart = usePresetCart()
  const byId = (id: string | null) => (id ? courses.find((c) => c.id === id) : undefined)
  const required = preset.slots.filter((s) => !s.optional)
  const optional = preset.slots.filter((s) => s.optional)
  const list = presetCourses(preset, courses, extras)
  const totals = priceTotals(list)
  const months = presetDurationMonths(preset, courses, extras)
  const toggle = (slotId: string) => setExtras((xs) => (xs.includes(slotId) ? xs.filter((x) => x !== slotId) : [...xs, slotId]))
  const cartIds = student?.builder.groupIds ?? []
  const inCart = list.length > 0 && list.every((c) => c.groups.some((g) => cartIds.includes(g.id)))
  const toConfirm = presetNeedsConfirmation(preset)
  return (
    <article className="reveal overflow-hidden rounded-[1.5rem] border border-charcoal/10 bg-paper shadow-soft">
      <header className="relative border-b border-charcoal/10 bg-gradient-to-r from-ivory via-paper to-sage/40 px-6 py-6 sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0 flex-1">
            {preset.program && tr(preset.program) && <div className="eyebrow break-words">{tr(preset.program)}</div>}
            <h3 className="mt-1.5 break-words font-display text-3xl leading-tight text-charcoal sm:text-[2.1rem]">{tr(preset.name)}</h3>
          </div>
          <Badge tone={toConfirm ? 'warn' : 'sage'}>{toConfirm ? t('uni.needsReview') : t('uni.verified')}</Badge>
        </div>
        {tr(preset.description) && <p className="mt-2 max-w-3xl text-sm leading-relaxed text-charcoal/65">{tr(preset.description)}</p>}
        {toConfirm && <p className="mt-3 flex max-w-3xl items-start gap-1.5 rounded-control bg-amber-50/80 px-3 py-2 text-xs leading-relaxed text-amber-900"><Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0" />{t('uni.confirmNote')}</p>}
      </header>
      <div className="grid lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 px-6 py-5 sm:px-8">
          <Eyebrow>{t('uni.includedCourses')}</Eyebrow>
          <ul className="mt-1 divide-y divide-charcoal/10">
            {required.map((slot) => <CourseRow key={slot.id} slot={slot} course={byId(slot.courseId)} />)}
            {optional.map((slot) => <CourseRow key={slot.id} slot={slot} course={byId(slot.courseId)} optional checked={extras.includes(slot.id)} onToggle={() => toggle(slot.id)} />)}
          </ul>
          {optional.length > 0 && <p className="mt-2 text-xs text-charcoal/55">{t('uni.optionalHint')}</p>}
          <SourceNote admission={preset.admission} />
        </div>
        <aside className="border-t border-charcoal/10 bg-gradient-to-b from-ivory/80 to-sage/30 px-6 py-6 sm:px-8 lg:border-l lg:border-t-0">
          <div className="lg:sticky lg:top-24">
            <div className="eyebrow">{t('uni.yourPackage')}</div>
            <ul className="mt-3 space-y-2 text-sm">
              {list.map((c) => (
                <li key={c.id} className="flex items-start justify-between gap-3">
                  <span className="min-w-0 break-words text-charcoal/75">{tr(c.title)}</span>
                  <span className="shrink-0 whitespace-nowrap tabular-nums text-charcoal"><PriceNow course={c} /></span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex items-end justify-between gap-3 border-t border-charcoal/10 pt-4">
              <div className="pb-1 text-[11px] font-semibold uppercase tracking-wider text-charcoal/50">{t('builder.monthlyTotal')}</div>
              <TotalPrice list={totals.list} final={totals.final} />
            </div>
            {months && (
              <div className="mt-4 flex items-center gap-2 text-sm text-charcoal/70">
                <Icon name="calendar" className="h-4 w-4 text-forest" />
                <span>{t('uni.packageDuration')}: <span className="font-semibold text-charcoal">{t('uni.courseMonths', { n: months })}</span></span>
              </div>
            )}
            {inCart ? (
              <>
                <div className="mt-5 flex items-center justify-center gap-2 rounded-control border border-forest/25 bg-sage/60 px-4 py-2.5 text-sm font-semibold text-forest"><Icon name="check" className="h-4 w-4" />{t('uni.inCart')}</div>
                <LinkButton to="/builder#cart" className="mt-2 w-full">{t('uni.goToCart')} <Icon name="arrowRight" className="h-4 w-4" /></LinkButton>
                <p className="mt-2 text-[11px] leading-relaxed text-charcoal/55">{t('uni.inCartHint')}</p>
              </>
            ) : (
              <>
                <Button size="lg" className="mt-5 w-full shadow-soft" disabled={!student || list.length === 0} onClick={() => addToCart(preset, { chosenOptional: extras, directionId })}>
                  <Icon name="cart" className="h-4 w-4" />{t('uni.addToCart')}
                </Button>
                <p className="mt-2 text-[11px] leading-relaxed text-charcoal/55">{t('uni.addHint')}</p>
              </>
            )}
          </div>
        </aside>
      </div>
    </article>
  )
}

/** The university's entrance subjects for a direction, as chips. */
function SubjectChips({ direction }: { direction: UniversityDirection }) {
  const { t, tr } = useT()
  if (direction.subjects.length === 0) return <span className="text-xs text-charcoal/50">{t('uni.noSubjects')}</span>
  return (
    <span className="flex flex-wrap gap-1.5">
      {direction.subjects.map((s, i) => <span key={i} className="rounded-full border border-forest/15 bg-paper px-2.5 py-0.5 text-[11px] font-medium text-forest">{tr(s)}</span>)}
    </span>
  )
}

function StepLabel({ n, label, active }: { n: number; label: string; active?: boolean }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold leading-none tabular-nums', active ? 'bg-forest text-champagne shadow-soft' : 'border border-charcoal/15 text-charcoal/45')}>{n}</span>
      <h2 className="font-display text-2xl leading-tight text-charcoal sm:text-[1.7rem]">{label}</h2>
      <span aria-hidden="true" className="hidden h-px flex-1 bg-gradient-to-r from-champagne/60 to-transparent sm:block" />
    </div>
  )
}

export function UniversityPage() {
  const { id } = useParams()
  const { t, tr, lang } = useT()
  const groups = useListedUniversities('all')
  const courses = useStore((s) => s.courses)
  const [facultyId, setFacultyId] = useState<string | null>(null)
  const [directionId, setDirectionId] = useState<string | null>(null)
  const group = groups.find((g) => g.university.id === id)
  const place = usePlace(group?.university)
  if (!group) return <NotFound />
  const { university, presets } = group

  const faculties = university.faculties ?? []
  const hasPackage = (d: UniversityDirection) => presetsForDirection(presets, d.id).length > 0
  // Start on the first faculty and direction that has a published package.
  const faculty = faculties.find((f) => f.id === facultyId) ?? faculties.find((f) => f.directions.some(hasPackage)) ?? faculties[0]
  const direction = faculty?.directions.find((d) => d.id === directionId) ?? faculty?.directions.find(hasPackage) ?? faculty?.directions[0]
  const directionPresets = direction ? presetsForDirection(presets, direction.id) : []
  // Packages not tied to a direction (or every package, when the university has no faculties yet).
  const unassigned = faculties.length ? presets.filter((p) => !p.directionIds?.length) : presets
  const track = isPreparationTrack(university)
  const directions = universityDirections(university).length
  const from = lowestPrice(presets, courses)

  return (
    <div className="container-x py-10 lg:py-14">
      <Link to="/universities" className="inline-flex items-center gap-1.5 text-sm text-charcoal/60 transition hover:text-forest"><Icon name="arrowLeft" className="h-4 w-4" />{t('uni.allUniversities')}</Link>

      <header className="reveal relative mt-5 overflow-hidden rounded-[1.75rem] border border-champagne/45 bg-gradient-to-br from-paper via-ivory to-sage/60 px-6 py-8 shadow-soft sm:px-10 sm:py-10">
        <span aria-hidden="true" className="pointer-events-none absolute -right-20 -top-24 h-80 w-80 rounded-full bg-[radial-gradient(closest-side,color-mix(in_srgb,var(--c-champagne)_26%,transparent),transparent)]" />
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-champagne to-transparent" />
        <div className="relative flex flex-col gap-6 md:flex-row md:items-center md:gap-10">
          <UniversityLogo key={university.logoUrl} university={university} height={128} maxWidth={320} align="start" />
          <div className="min-w-0 flex-1">
            {university.shortName && !track && <div className="eyebrow">{university.shortName}</div>}
            <h1 className="mt-2 break-words font-display text-4xl leading-[1.05] text-charcoal md:text-5xl lg:text-[3.25rem]">{universityName(university, lang)}</h1>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-charcoal/10 bg-paper/80 px-3 py-1.5 text-charcoal/70"><Icon name={track ? 'layers' : 'pin'} className="h-4 w-4 text-champagne" />{track ? t('uni.trackLabel') : place}</span>
              {university.website && /^https:\/\//.test(university.website) && (
                <a href={university.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-full border border-forest/20 bg-paper/80 px-3 py-1.5 font-medium text-forest transition hover:border-forest hover:bg-forest hover:text-ivory">{t('uni.officialSite')} <Icon name="external" className="h-3.5 w-3.5" /></a>
              )}
            </div>
          </div>
        </div>
        {university.description && tr(university.description) && <p className="relative mt-6 max-w-3xl text-[15px] leading-relaxed text-charcoal/70">{tr(university.description)}</p>}
        <dl className="relative mt-7 grid max-w-xl grid-cols-2 gap-x-6 gap-y-4 border-t border-charcoal/10 pt-5 sm:grid-cols-3">
          {directions > 0 && <Stat label={t('uni.stat.directions')}>{directions}</Stat>}
          <Stat label={t('uni.stat.packages')}>{presets.length || '—'}</Stat>
          {from > 0 && <Stat label={t('uni.perMonth')} className="col-span-2 sm:col-span-1"><span className="whitespace-nowrap text-forest">{t('uni.fromPrice', { price: formatSom(from, lang) })}</span></Stat>}
        </dl>
      </header>
      {track && <p className="reveal mt-5 flex max-w-3xl items-start gap-2 rounded-card border border-champagne/60 bg-ivory/70 px-4 py-3 text-sm leading-relaxed text-charcoal/75"><Icon name="info" className="mt-0.5 h-4 w-4 shrink-0 text-forest" />{t('uni.trackNote')}</p>}

      {faculties.length > 0 && (
        <div className="mt-12 grid gap-10">
          {/* With a single faculty (or a track's routes) there is nothing to choose: the directions come first. */}
          {faculties.length > 1 && <section aria-label={t('uni.chooseFaculty')}>
            <StepLabel n={1} label={t('uni.chooseFaculty')} active />
            <div className="-mx-1 flex flex-wrap gap-2 px-1">
              {faculties.map((f) => {
                const on = f.id === faculty?.id
                return (
                  <button key={f.id} type="button" aria-pressed={on} onClick={() => { setFacultyId(f.id); setDirectionId(null) }}
                    className={cx('inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition duration-300', on ? 'border-forest bg-forest text-ivory shadow-soft' : 'border-charcoal/15 bg-paper text-charcoal hover:-translate-y-0.5 hover:border-forest/50 hover:text-forest')}>
                    {on && <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-champagne" />}
                    {tr(f.name)}
                  </button>
                )
              })}
            </div>
          </section>}

          {faculty && faculty.directions.length > 0 && (
            <section aria-label={t('uni.chooseDirection')}>
              <StepLabel n={faculties.length > 1 ? 2 : 1} label={t('uni.chooseDirection')} active />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {faculty.directions.map((d) => {
                  const on = d.id === direction?.id
                  return (
                    <button key={d.id} type="button" aria-pressed={on} onClick={() => setDirectionId(d.id)}
                      className={cx('relative flex flex-col items-start gap-2 rounded-card border p-4 pr-11 text-left transition duration-300', on ? 'border-forest bg-sage/45 shadow-soft ring-1 ring-forest/15' : 'border-charcoal/12 bg-paper hover:-translate-y-0.5 hover:border-forest/40 hover:shadow-soft', !hasPackage(d) && !on && 'opacity-70')}>
                      <span aria-hidden="true" className={cx('absolute right-3.5 top-3.5 flex h-6 w-6 items-center justify-center rounded-full border transition', on ? 'border-forest bg-forest text-ivory' : 'border-charcoal/15 text-transparent')}><Icon name="check" className="h-3.5 w-3.5" /></span>
                      <span className="font-display text-lg leading-snug text-charcoal">{tr(d.name)}</span>
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-charcoal/45">{t('uni.entranceSubjects')}</span>
                      <SubjectChips direction={d} />
                    </button>
                  )
                })}
              </div>
            </section>
          )}

          <section aria-label={t('uni.step.package')}>
            <StepLabel n={faculties.length > 1 ? 3 : 2} label={t('uni.step.package')} active={directionPresets.length > 0} />
            {directionPresets.length > 0 ? (
              <div className="grid gap-6">{directionPresets.map((p) => <PackageOffer key={p.id} preset={p} courses={courses} directionId={direction?.id} />)}</div>
            ) : (
              <p className="rounded-card border border-dashed border-charcoal/15 bg-ivory/50 p-6 text-sm text-charcoal/60">{t('uni.noPackage')}</p>
            )}
          </section>
        </div>
      )}

      {faculties.length === 0 && presets.length === 0 && (
        <p className="mt-10 rounded-card border border-dashed border-charcoal/15 bg-ivory/50 p-6 text-sm text-charcoal/60">{t('uni.noPackagesYet')}</p>
      )}

      {unassigned.length > 0 && (
        <section className="mt-12">
          {faculties.length > 0 && <Eyebrow className="mb-4">{t('uni.otherPrograms')}</Eyebrow>}
          <div className="grid gap-6">{unassigned.map((p) => <PackageOffer key={p.id} preset={p} courses={courses} />)}</div>
        </section>
      )}

      <p className="mt-10 max-w-3xl text-[11px] leading-relaxed text-charcoal/50">{t('uni.disclaimer')}</p>
    </div>
  )
}
