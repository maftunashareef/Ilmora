import { isUniversityListed, presetCourses, presetDurationMonths, presetsForDirection, presetTotal, priceTotals, universityDirections } from '@ilmora/shared'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from '@/lib/router'
import { NotFound } from '../../components/AccessGate'
import { CoursePrice, TotalPrice } from '../../components/course/CourseCard'
import { Badge, Button, cx, Eyebrow, Icon, LinkButton, PageTitle, SectionHeading } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { formatSom } from '../../lib/format'
import { useStore } from '../../store/useStore'
import type { AdmissionSource, Course, Preset, PresetSlot, Section, University, UniversityDirection } from '../../types'

/**
 * University preparation: university → faculty → direction → package → cart. Only published packages are shown (the
 * public site configuration carries no drafts). A university appears when the admin marked it published or once it has
 * a published package; one whose packages are still being verified shows its faculties and directions without a package.
 * Prices are the included courses' own monthly prices with their active discounts; "Enroll" hands the package to the
 * regular cart (/builder?preset=…), so groups, schedule checks and payment stay the existing ones.
 */

interface UniversityGroup {
  university: University
  presets: Preset[]
}

/** The universities visitors see, each with its published packages: those with a package first, then alphabetical. */
function useListedUniversities(): UniversityGroup[] {
  const presets = useStore((s) => s.site.presets)
  const universities = useStore((s) => s.site.universities)
  return useMemo(() => {
    const live = (presets ?? []).filter((p) => p.enabled && p.universityId)
    return (universities ?? [])
      .filter((university) => isUniversityListed(university, live))
      .map((university) => ({ university, presets: live.filter((p) => p.universityId === university.id) }))
      .sort((a, b) => Number(b.presets.length > 0) - Number(a.presets.length > 0) || a.university.name.localeCompare(b.university.name))
  }, [presets, universities])
}

/** Lowest monthly price among the packages, counting only their required courses (0 when none can be priced). */
const lowestPrice = (presets: Preset[], courses: Course[]): number => {
  const prices = presets.map((p) => presetTotal(presetCourses(p, courses, []))).filter((n) => n > 0)
  return prices.length ? Math.min(...prices) : 0
}

/**
 * The official logo, or the short name on a cream tile until there is one. Logos keep their proportions (most are wide
 * word marks) up to `size × 3`; `square` keeps the tile square, for small overlapping rows.
 */
export function UniversityLogo({ university, size = 56, square, className }: { university: University; size?: number; square?: boolean; className?: string }) {
  const { t } = useT()
  const [failed, setFailed] = useState(false)
  const label = university.shortName || university.name
  if (university.logoUrl && !failed) {
    return (
      <span className={cx('flex shrink-0 items-center justify-center overflow-hidden rounded-2xl border', university.logoOnDark ? 'border-forest bg-forest' : 'border-charcoal/10 bg-white', className)} style={square ? { width: size, height: size } : { height: size, minWidth: size, maxWidth: size * 3 }}>
        <img src={university.logoUrl} alt={t('uni.logoAlt', { name: university.name })} loading="lazy" onError={() => setFailed(true)} className={cx('object-contain', square ? 'h-full w-full p-1.5' : 'h-full w-auto max-w-full px-3 py-2')} />
      </span>
    )
  }
  return (
    <span aria-hidden="true" className={cx('flex shrink-0 items-center justify-center rounded-2xl border border-champagne/70 bg-gradient-to-br from-ivory to-champagne/40 font-display font-semibold text-forest', className)} style={{ width: size, height: size, fontSize: Math.max(12, size * (label.length > 5 ? 0.2 : 0.3)) }}>
      {label}
    </span>
  )
}

function UniversityCard({ group, courses }: { group: UniversityGroup; courses: Course[] }) {
  const { t, lang } = useT()
  const { university, presets } = group
  const directions = universityDirections(university).length
  const from = lowestPrice(presets, courses)
  return (
    <Link to={`/universities/${university.id}`} className="reveal card group flex h-full flex-col p-6 transition duration-300 hover:-translate-y-1 hover:shadow-lift focus:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2">
      {/* The logo on its own row: most official logos are wide word marks. */}
      <UniversityLogo key={university.logoUrl} university={university} size={60} className="self-start" />
      <div className="mt-4 min-w-0">
        <div className="font-display text-2xl leading-tight text-charcoal transition group-hover:text-forest">{university.name}</div>
        <div className="mt-1 text-xs text-charcoal/55">{[university.city, university.country].filter(Boolean).join(', ')}</div>
      </div>
      <div className="mt-5 flex flex-wrap gap-2 text-[11px] font-medium text-charcoal/70">
        {directions > 0 && <span className="rounded-full bg-sage/60 px-2.5 py-1">{t('uni.directionsCount', { n: directions })}</span>}
        {presets.length > 0
          ? <span className="rounded-full bg-sage/60 px-2.5 py-1">{t('uni.packagesCount', { n: presets.length })}</span>
          : <span className="rounded-full bg-champagne/40 px-2.5 py-1 text-forest">{t('uni.packagesSoon')}</span>}
      </div>
      <div className="mt-auto flex items-end justify-between gap-3 pt-6">
        {from > 0 ? (
          <div>
            <div className="text-[11px] uppercase tracking-wider text-charcoal/45">{t('uni.perMonth')}</div>
            <div className="font-display text-xl text-charcoal">{t('uni.fromPrice', { price: formatSom(from, lang) })}</div>
          </div>
        ) : <span />}
        <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-charcoal/15 text-charcoal transition group-hover:border-forest group-hover:bg-forest group-hover:text-ivory" aria-hidden="true">
          <Icon name="arrowRight" className="h-4 w-4" />
        </span>
      </div>
    </Link>
  )
}

/** "Other universities": room for the ones whose requirements are still being checked. */
function MoreSoonCard() {
  const { t } = useT()
  return (
    <div className="reveal flex h-full flex-col justify-center rounded-card border border-dashed border-charcoal/20 bg-ivory/50 p-6">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sage/70 text-forest"><Icon name="building" className="h-5 w-5" /></span>
      <div className="mt-4 font-display text-xl text-charcoal">{t('uni.moreSoon')}</div>
      <p className="mt-1 text-sm leading-relaxed text-charcoal/60">{t('uni.moreSoonBody')}</p>
    </div>
  )
}

export function UniversitiesPage() {
  const { t } = useT()
  const groups = useListedUniversities()
  const courses = useStore((s) => s.courses)
  return (
    <div className="container-x py-12 lg:py-16">
      <PageTitle title={t('uni.page.title')} subtitle={t('uni.page.subtitle')} />
      <div className="reveal-stagger grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => <UniversityCard key={g.university.id} group={g} courses={courses} />)}
        <MoreSoonCard />
      </div>
      <p className="mt-8 max-w-3xl text-[11px] leading-relaxed text-charcoal/50">{t('uni.disclaimer')}</p>
    </div>
  )
}

/** Homepage section `universities`: up to three university cards and a link to all of them. Hidden while none is shown. */
export function UniversitiesSection({ s }: { s: Section }) {
  const { t, tr } = useT()
  const groups = useListedUniversities()
  const courses = useStore((st) => st.courses)
  if (groups.length === 0) return null
  return (
    <section className="py-16 lg:py-24">
      <div className="container-x">
        <SectionHeading
          eyebrow={t('uni.page.title')}
          title={tr(s.title) || t('uni.page.title')}
          subtitle={tr(s.subtitle) || undefined}
          action={<LinkButton to="/universities" variant="secondary">{t('uni.allUniversities')} <Icon name="arrowRight" className="h-4 w-4" /></LinkButton>}
        />
        <div className="reveal-stagger grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {groups.slice(0, 3).map((g) => <UniversityCard key={g.university.id} group={g} courses={courses} />)}
        </div>
      </div>
    </section>
  )
}

/** Course catalog: a band that leads to the university packages. Hidden while none is shown. */
export function UniversitiesBand({ className }: { className?: string }) {
  const { t } = useT()
  const groups = useListedUniversities()
  if (groups.length === 0) return null
  return (
    <Link to="/universities" className={cx('group flex flex-col gap-4 rounded-card border border-champagne/60 bg-gradient-to-r from-ivory via-paper to-champagne/25 p-5 transition hover:shadow-lift sm:flex-row sm:items-center', className)}>
      <div className="flex -space-x-3">
        {groups.slice(0, 4).map((g) => <UniversityLogo key={g.university.id} university={g.university} size={44} square className="ring-2 ring-paper" />)}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-display text-xl text-charcoal">{t('uni.page.title')}</div>
        <p className="text-sm text-charcoal/65">{t('uni.catalogBand')}</p>
      </div>
      <span className="inline-flex items-center gap-1.5 text-sm font-medium text-forest">{t('uni.allUniversities')} <Icon name="arrowRight" className="h-4 w-4 transition group-hover:translate-x-0.5" /></span>
    </Link>
  )
}

/** Official source of a package's subjects: verification state, year, check date and the page itself. */
function SourceNote({ admission }: { admission?: AdmissionSource }) {
  const { t } = useT()
  if (!admission) return null
  const verified = admission.status === 'verified'
  return (
    <div className="mt-5 rounded-control border border-charcoal/10 bg-paper px-4 py-3 text-[11px] leading-relaxed text-charcoal/60">
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

/** One included course: the university's subject, the ILMORA course that prepares for it, its length and monthly price. */
function CourseRow({ slot, course, optional, checked, onToggle }: { slot: PresetSlot; course?: Course; optional?: boolean; checked?: boolean; onToggle?: () => void }) {
  const { t, tr } = useT()
  if (!course) return null
  const body = (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-charcoal/45">
        {tr(slot.label)}
        {optional && <span className="rounded-full bg-champagne/50 px-2 py-0.5 normal-case tracking-normal text-forest">{t('uni.optional')}</span>}
      </div>
      <Link to={`/courses/${course.id}`} className="mt-0.5 block font-display text-lg leading-snug text-charcoal hover:text-forest">{tr(course.title)}</Link>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-charcoal/60">
        {course.durationMonths > 0 && <span className="inline-flex items-center gap-1"><Icon name="clock" className="h-3.5 w-3.5" />{t('uni.courseMonths', { n: course.durationMonths })}</span>}
        <CoursePrice course={course} className="[&_.font-display]:text-base" />
      </div>
    </div>
  )
  if (!optional) return <li className="flex gap-3 py-3">{body}</li>
  return (
    <li className="py-3">
      <label className={cx('flex cursor-pointer gap-3 rounded-control p-2 -m-2 transition', checked ? 'bg-sage/40' : 'hover:bg-ivory')}>
        <input type="checkbox" checked={!!checked} onChange={onToggle} className="mt-1 h-4 w-4 shrink-0 accent-forest" />
        {body}
      </label>
    </li>
  )
}

/** A package with its courses, optional extras, monthly total, preparation length, source and the enroll button. */
function PackageOffer({ preset, courses }: { preset: Preset; courses: Course[] }) {
  const { t, tr } = useT()
  const nav = useNavigate()
  const [extras, setExtras] = useState<string[]>([])
  const byId = (id: string | null) => (id ? courses.find((c) => c.id === id) : undefined)
  const required = preset.slots.filter((s) => !s.optional)
  const optional = preset.slots.filter((s) => s.optional)
  const totals = priceTotals(presetCourses(preset, courses, extras))
  const months = presetDurationMonths(preset, courses, extras)
  const toggle = (slotId: string) => setExtras((xs) => (xs.includes(slotId) ? xs.filter((x) => x !== slotId) : [...xs, slotId]))
  const enroll = () => nav(`/builder?preset=${encodeURIComponent(preset.id)}${extras.length ? `&extra=${extras.map(encodeURIComponent).join(',')}` : ''}`)
  return (
    <article className="reveal card overflow-hidden p-0">
      <header className="border-b border-charcoal/10 bg-gradient-to-r from-ivory to-sage/40 px-6 py-5">
        {preset.program && tr(preset.program) && <div className="text-[11px] font-semibold uppercase tracking-wider text-charcoal/50">{tr(preset.program)}</div>}
        <h3 className="mt-1 font-display text-2xl leading-tight text-charcoal sm:text-3xl">{tr(preset.name)}</h3>
      </header>
      <div className="grid gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
        <div className="min-w-0">
          <Eyebrow>{t('uni.includedCourses')}</Eyebrow>
          <ul className="mt-2 divide-y divide-charcoal/10">
            {required.map((slot) => <CourseRow key={slot.id} slot={slot} course={byId(slot.courseId)} />)}
            {optional.map((slot) => <CourseRow key={slot.id} slot={slot} course={byId(slot.courseId)} optional checked={extras.includes(slot.id)} onToggle={() => toggle(slot.id)} />)}
          </ul>
          {optional.length > 0 && <p className="mt-3 text-xs text-charcoal/55">{t('uni.optionalHint')}</p>}
          <SourceNote admission={preset.admission} />
        </div>
        <aside className="flex flex-col rounded-card border border-champagne/50 bg-ivory/70 p-5 lg:self-start">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-charcoal/50">{t('builder.monthlyTotal')}</div>
          <TotalPrice list={totals.list} final={totals.final} className="mt-1 text-left" />
          <div className="text-[11px] text-charcoal/50">{t('uni.perMonth')}</div>
          {months && (
            <div className="mt-4 flex items-center gap-2 border-t border-charcoal/10 pt-4 text-sm text-charcoal/70">
              <Icon name="calendar" className="h-4 w-4 text-forest" />
              <span>{t('uni.packageDuration')}: <span className="font-semibold text-charcoal">{t('uni.courseMonths', { n: months })}</span></span>
            </div>
          )}
          <Button className="mt-5 w-full justify-center" onClick={enroll}><Icon name="cart" className="h-4 w-4" />{t('uni.enroll')}</Button>
          <p className="mt-2 text-[11px] leading-relaxed text-charcoal/55">{t('uni.enrollHint')}</p>
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
      {direction.subjects.map((s, i) => <span key={i} className="rounded-full border border-forest/20 bg-paper px-2.5 py-0.5 text-[11px] font-medium text-forest">{tr(s)}</span>)}
    </span>
  )
}

function StepLabel({ n, label, active }: { n: number; label: string; active?: boolean }) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span className={cx('flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold', active ? 'bg-forest text-ivory' : 'bg-sage text-forest')}>{n}</span>
      <span className="text-xs font-semibold uppercase tracking-[0.16em] text-charcoal/60">{label}</span>
    </div>
  )
}

export function UniversityPage() {
  const { id } = useParams()
  const { t, tr } = useT()
  const groups = useListedUniversities()
  const courses = useStore((s) => s.courses)
  const [facultyId, setFacultyId] = useState<string | null>(null)
  const [directionId, setDirectionId] = useState<string | null>(null)
  const group = groups.find((g) => g.university.id === id)
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
  const place = [university.city, university.country].filter(Boolean).join(', ')

  return (
    <div className="container-x py-10 lg:py-14">
      <Link to="/universities" className="inline-flex items-center gap-1.5 text-sm text-charcoal/60 hover:text-forest"><Icon name="arrowLeft" className="h-4 w-4" />{t('uni.allUniversities')}</Link>

      <header className="reveal mt-5 flex flex-col gap-5 sm:flex-row sm:items-center">
        <UniversityLogo key={university.logoUrl} university={university} size={84} />
        <div className="min-w-0">
          <h1 className="font-display text-4xl leading-tight text-charcoal md:text-5xl">{university.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-charcoal/60">
            {place && <span className="inline-flex items-center gap-1.5"><Icon name="globe" className="h-4 w-4" />{place}</span>}
            {university.website && /^https:\/\//.test(university.website) && (
              <a href={university.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-forest hover:underline">{t('uni.officialSite')} <Icon name="external" className="h-3.5 w-3.5" /></a>
            )}
          </div>
        </div>
      </header>

      {faculties.length > 0 && (
        <div className="mt-10 grid gap-8">
          <section aria-label={t('uni.chooseFaculty')}>
            <StepLabel n={1} label={t('uni.chooseFaculty')} active />
            <div className="flex flex-wrap gap-2">
              {faculties.map((f) => {
                const on = f.id === faculty?.id
                return (
                  <button key={f.id} type="button" aria-pressed={on} onClick={() => { setFacultyId(f.id); setDirectionId(null) }}
                    className={cx('rounded-full border px-4 py-2 text-sm font-medium transition', on ? 'border-forest bg-forest text-ivory shadow-soft' : 'border-charcoal/15 bg-paper text-charcoal hover:border-forest/50 hover:text-forest')}>
                    {tr(f.name)}
                  </button>
                )
              })}
            </div>
          </section>

          {faculty && faculty.directions.length > 0 && (
            <section aria-label={t('uni.chooseDirection')}>
              <StepLabel n={2} label={t('uni.chooseDirection')} active />
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {faculty.directions.map((d) => {
                  const on = d.id === direction?.id
                  return (
                    <button key={d.id} type="button" aria-pressed={on} onClick={() => setDirectionId(d.id)}
                      className={cx('flex flex-col items-start gap-2 rounded-card border p-4 text-left transition', on ? 'border-forest bg-sage/40 shadow-soft' : 'border-charcoal/12 bg-paper hover:-translate-y-0.5 hover:border-forest/40 hover:shadow-soft', !hasPackage(d) && !on && 'opacity-70')}>
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
            <StepLabel n={3} label={t('uni.step.package')} active={directionPresets.length > 0} />
            {directionPresets.length > 0 ? (
              <div className="grid gap-6">{directionPresets.map((p) => <PackageOffer key={p.id} preset={p} courses={courses} />)}</div>
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
