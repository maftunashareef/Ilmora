import { groupByUniversity, isPreparationTrack, isUniversityPreset, universityName, presetCartPlan, presetCourses, presetNeedsConfirmation, presetPublishability, presetReadiness, presetTotal, universityOf } from '@ilmora/shared'
import { useEffect, useRef } from 'react'
import { Link } from '@/lib/router'
import { useSearchParams } from '@/lib/routerHooks'
import { FormatBadge, PriceNow, ScheduleChips } from '../../components/course/CourseCard'
import { Badge, Button, Card, Eyebrow, Icon } from '../../components/ui'
import { cx } from '../../components/ui/helpers'
import { useT } from '../../i18n/useT'
import { formatSom } from '../../lib/format'
import { useStore } from '../../store/useStore'
import type { Course, Preset, University } from '../../types'
import { TRACK_VISUALS, trackRank } from '../../lib/trackVisuals'
import { UniversityLogo } from './Universities'
import { placeName } from './placeName'

/**
 * One package: its program, required subjects, included courses, total price, official source and the add-to-cart
 * button. The same publishing rule as everywhere (presetPublishability): a university package may list a subject ILMORA
 * has no course for (shown as not covered, never added to the cart). Totals, source and button sit at the bottom of the
 * card, so they line up across a row of cards.
 */
function PackageCard({ preset, university, courses, cartGroupIds, onAdd }: { preset: Preset; university?: University; courses: Course[]; cartGroupIds: string[]; onAdd: (p: Preset) => void }) {
  const { t, tr, lang } = useT()
  const centers = useStore((s) => s.centers)
  const categories = useStore((s) => s.categories)
  const usable = isUniversityPreset(preset) ? presetPublishability(preset, courses).ok : presetReadiness(preset, courses).ready
  const list = usable ? presetCourses(preset, courses) : []
  const allInCart = usable && presetCartPlan(preset, list, cartGroupIds).toAdd.length === 0
  const a = preset.admission
  const toConfirm = presetNeedsConfirmation(preset)
  const covered = (slotCourseId: string | null) => !!slotCourseId && list.some((c) => c.id === slotCourseId)

  return (
    <Card className={cx('flex h-full min-w-0 flex-col p-5 sm:p-6', !usable && 'opacity-75')}>
      {university && <div className="eyebrow mb-1">{isPreparationTrack(university) ? universityName(university, lang) : university.shortName || universityName(university, lang)}</div>}
      <div className="flex items-start justify-between gap-3">
        <h3 className="min-w-0 break-words font-display text-2xl leading-tight text-charcoal sm:text-3xl">{tr(preset.name)}</h3>
        {!usable ? <Badge tone="warn">{t('preset.unavailable')}</Badge> : university ? <Badge tone={toConfirm ? 'warn' : 'sage'}>{toConfirm ? t('uni.needsReview') : t('uni.verified')}</Badge> : null}
      </div>
      {tr(preset.program) && <div className="mt-1 break-words text-sm font-medium text-forest">{tr(preset.program)}</div>}
      {tr(preset.description) && <p className="mt-2 break-words text-sm leading-relaxed text-charcoal/65">{tr(preset.description)}</p>}

      <Eyebrow className="mt-5">{t('uni.requiredSubjects')}</Eyebrow>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {preset.slots.map((slot) => (
          <li
            key={slot.id}
            title={usable && !covered(slot.courseId) ? t('uni.notCovered') : undefined}
            className={cx('inline-flex max-w-full items-start gap-1 rounded-2xl border px-2.5 py-1 text-left text-xs font-medium leading-snug', usable && !covered(slot.courseId) ? 'border-charcoal/15 bg-paper text-charcoal/55' : 'border-forest/15 bg-sage/50 text-forest')}
          >
            <Icon name={usable && !covered(slot.courseId) ? 'info' : 'check'} className="mt-0.5 h-3 w-3 shrink-0" />
            <span className="min-w-0 break-words">{tr(slot.label)}{slot.optional && <span className="ml-1 font-normal text-charcoal/50">· {t('uni.optional')}</span>}</span>
          </li>
        ))}
      </ul>
      {usable && preset.slots.some((s) => !covered(s.courseId)) && <p className="mt-2 text-[11px] leading-relaxed text-charcoal/55">{t('uni.notCovered')}</p>}

      {usable ? (
        <>
          <Eyebrow className="mt-5">{t('preset.courses')}</Eyebrow>
          <ul className="mt-2 divide-y divide-charcoal/10">
            {list.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="min-w-0 break-words font-medium text-charcoal">{tr(c.title)}</span>
                    <FormatBadge course={c} />
                  </div>
                  <div className="mt-0.5 break-words text-[11px] text-charcoal/50">{[tr(categories.find((x) => x.id === c.categoryId)?.name), centers.find((x) => x.id === c.centerId)?.name].filter(Boolean).join(' · ')}</div>
                  {c.groups[0] && <div className="mt-1"><ScheduleChips group={c.groups[0]} compact />{c.groups.length > 1 && <span className="ml-1.5 text-[11px] text-charcoal/45">+{c.groups.length - 1}</span>}</div>}
                  {tr(c.summary) && <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-charcoal/55">{tr(c.summary)}</p>}
                </div>
                <div className="shrink-0 whitespace-nowrap text-right tabular-nums text-charcoal"><PriceNow course={c} /></div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-4 text-sm text-charcoal/60">{t('preset.unavailableHint')}</p>
      )}

      <div className="mt-auto pt-4">
        {usable && (
          <>
            <div className="flex items-end justify-between gap-3 border-t border-charcoal/10 pt-3">
              <span className="text-sm text-charcoal/60">{t('builder.monthlyTotal')}</span>
              <span className="whitespace-nowrap font-display text-2xl tabular-nums text-charcoal">{formatSom(presetTotal(list), lang)}</span>
            </div>
            <p className="mt-1 text-[11px] text-amber-800">{t('preset.provisional')}</p>
          </>
        )}

        {a && (a.url || a.academicYear) && (
          <div className="mt-4 rounded-control border border-forest/10 bg-sage/30 p-3 text-[11px] leading-relaxed text-charcoal/65">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold text-charcoal/80">{t('uni.source')}</span>
              <Badge tone={toConfirm ? 'warn' : 'sage'}>{toConfirm ? t('uni.needsReview') : t('uni.verified')}</Badge>
            </div>
            {a.academicYear && a.checkedOn && <div className="mt-1">{t('uni.sourceMeta', { year: a.academicYear, date: a.checkedOn })}</div>}
            {/^https:\/\//.test(a.url) && <a href={a.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 font-medium text-forest hover:underline">{t('uni.officialPage')}<Icon name="external" className="h-3 w-3" /></a>}
          </div>
        )}

        <Button className="mt-5 w-full" disabled={!usable || allInCart} onClick={() => onAdd(preset)}>
          {allInCart ? <><Icon name="check" className="h-4 w-4" />{t('favorites.inCart')}</> : <><Icon name="cart" className="h-4 w-4" />{t('preset.add')}</>}
        </Button>
      </div>
    </Card>
  )
}

/**
 * A card in the chooser. A university shows its logo large on a light stage, then its short name and full name; a
 * preparation direction shows its emblem over its own photograph, then its full name and what it prepares for.
 */
function ChooserCard({ university, packages, onSelect }: { university: University; packages: number; onSelect: () => void }) {
  const { t, tr, lang } = useT()
  const track = isPreparationTrack(university)
  const name = universityName(university, lang)
  const visual = TRACK_VISUALS[university.id]
  return (
    <button type="button" onClick={onSelect} className="group flex h-full w-full min-w-0 flex-col overflow-hidden rounded-card border border-charcoal/10 bg-paper text-left transition hover:-translate-y-0.5 hover:border-forest/40 hover:shadow-lift">
      {track ? (
        <span className="relative flex h-32 w-full items-center justify-center overflow-hidden bg-forest sm:h-36">
          {visual && <img src={visual.image} alt="" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover opacity-75 transition duration-500 group-hover:scale-105" style={{ objectPosition: visual.position }} />}
          <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-forest/85 via-forest/35 to-forest/15" />
          <UniversityLogo university={university} height={84} className="relative" />
        </span>
      ) : (
        <span className="flex h-32 w-full items-center justify-center border-b border-charcoal/5 bg-gradient-to-br from-sage/70 via-ivory to-paper px-5 sm:h-36">
          <UniversityLogo university={university} height={96} maxWidth={210} className="transition duration-500 group-hover:scale-105" />
        </span>
      )}
      <span className="flex flex-1 flex-col p-4 sm:p-5">
        {track ? (
          <>
            <span className="break-words font-display text-2xl leading-tight text-charcoal">{name}</span>
            {tr(university.description) && <span className="mt-1.5 line-clamp-3 text-xs leading-relaxed text-charcoal/60">{tr(university.description)}</span>}
          </>
        ) : (
          <>
            <span className="break-words font-display text-2xl leading-tight text-charcoal">{university.shortName || name}</span>
            {university.shortName && <span className="mt-0.5 line-clamp-2 text-xs text-charcoal/55">{name}</span>}
          </>
        )}
        <span className="mt-auto flex items-center justify-between gap-2 pt-3 text-[11px] font-medium text-forest">
          <span>{t('uni.packagesCount', { n: packages })}</span>
          {!track && university.city && <span className="text-charcoal/45">{placeName(t, university.city)}</span>}
        </span>
      </span>
    </button>
  )
}

/**
 * Ready-made packages next to Flex and Winx: pick a university or a preparation direction and add one of its packages to
 * the same cart the builder uses. Only published packages reach this component (the public site hides drafts); those
 * whose admission requirements are not verified yet are marked "requires confirmation".
 *
 * Choosing one (a click here, or arriving by /builder?uni=…) replaces the chooser with that university's packages and
 * brings them into view, so the packages are what the visitor sees next; "All universities" goes back to the chooser.
 */
export function UniversityPackagesSection({ presets, universities, courses, cartGroupIds, onAdd }: { presets: Preset[]; universities: University[]; courses: Course[]; cartGroupIds: string[]; onAdd: (p: Preset) => void }) {
  const { t, tr, lang } = useT()
  const [params, setParams] = useSearchParams()
  const published = presets.filter((p) => p.enabled)
  const groups = groupByUniversity(published, universities)
  const generic = published.filter((p) => !universityOf(p, universities))
  const chosen = params.get('uni')
  const selected = groups.find((g) => g.university.id === chosen) ?? (groups.length === 1 ? groups[0] : undefined)
  const selectedId = selected?.university.id
  const packagesRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!chosen || chosen !== selectedId) return
    const timer = setTimeout(() => packagesRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80)
    return () => clearTimeout(timer)
  }, [chosen, selectedId])

  if (published.length === 0) return null

  const select = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('uni', id)
    else next.delete('uni')
    setParams(next, { replace: true })
  }
  // Universities and the general preparation directions (medical, law, …) are different things and are listed apart.
  const unis = groups.filter((g) => !isPreparationTrack(g.university))
  const tracks = groups.filter((g) => isPreparationTrack(g.university)).sort((a, b) => trackRank(a.university) - trackRank(b.university))
  // Eight universities sit four to a row; the five directions fit one row on a wide screen.
  const chooser = (list: typeof groups, columns: string) => (
    <ul className={cx('grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3', columns)} role="list">
      {list.map((g) => <li key={g.university.id}><ChooserCard university={g.university} packages={g.presets.length} onSelect={() => select(g.university.id)} /></li>)}
    </ul>
  )
  const selectedTrack = !!selected && isPreparationTrack(selected.university)

  return (
    <section className="mb-12" aria-labelledby="uni-title">
      <Eyebrow className="mb-1">{t('uni.title')}</Eyebrow>
      <p id="uni-title" className="mb-5 max-w-2xl text-sm text-charcoal/60">{t('uni.subtitle')}</p>

      {selected ? (
        <div ref={packagesRef} className="scroll-mt-40">
          <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-3 rounded-card border border-forest/15 bg-sage/40 p-4 sm:p-5">
            <UniversityLogo university={selected.university} height={104} maxWidth={240} align="start" />
            <div className="min-w-0 flex-1 basis-56">
              {selectedTrack && <div className="eyebrow mb-1">{t('uni.trackLabel')}</div>}
              <h2 className="break-words font-display text-3xl leading-tight text-charcoal">{universityName(selected.university, lang)}</h2>
              {tr(selected.university.description) && <p className="mt-1 line-clamp-3 text-sm leading-relaxed text-charcoal/65">{tr(selected.university.description)}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-medium">
                <span className="text-forest">{t('uni.packagesCount', { n: selected.presets.length })}</span>
                <Link to={`/universities/${selected.university.id}`} className="text-forest hover:underline">{t('uni.viewDetails')}</Link>
                {/^https:\/\//.test(selected.university.website ?? '') && <a href={selected.university.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-forest hover:underline">{selected.university.website?.replace(/^https:\/\//, '')}<Icon name="external" className="h-3 w-3" /></a>}
              </div>
            </div>
            {groups.length > 1 && <Button variant="secondary" size="sm" onClick={() => select(null)}>← {t('uni.all')}</Button>}
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            {selected.presets.map((p) => <PackageCard key={p.id} preset={p} university={selected.university} courses={courses} cartGroupIds={cartGroupIds} onAdd={onAdd} />)}
          </div>
        </div>
      ) : (
        <>
          {unis.length > 0 && (
            <>
              <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-charcoal/50">{t('uni.universities')} · {unis.length}</div>
              {chooser(unis, 'lg:grid-cols-4')}
            </>
          )}
          {tracks.length > 0 && (
            <>
              <div className={cx('text-xs font-semibold uppercase tracking-wider text-charcoal/50', unis.length > 0 && 'mt-8')}>{t('uni.tracks.eyebrow')} · {tracks.length}</div>
              <p className="mb-3 mt-1 max-w-2xl text-xs leading-relaxed text-charcoal/55">{t('uni.tracks.subtitle')}</p>
              {chooser(tracks, 'xl:grid-cols-5')}
            </>
          )}
        </>
      )}

      {generic.length > 0 && (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {generic.map((p) => <PackageCard key={p.id} preset={p} courses={courses} cartGroupIds={cartGroupIds} onAdd={onAdd} />)}
        </div>
      )}

      {groups.length > 0 && <p className="mt-6 max-w-3xl text-[11px] leading-relaxed text-charcoal/50">{t('uni.disclaimer')}</p>}
    </section>
  )
}
