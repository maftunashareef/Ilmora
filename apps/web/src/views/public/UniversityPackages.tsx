import { groupByUniversity, presetCartPlan, presetCourses, presetMissingSubjects, presetReadiness, presetTotal, universityOf } from '@ilmora/shared'
import { useSearchParams } from '@/lib/router'
import { FormatBadge, PriceNow, ScheduleChips } from '../../components/course/CourseCard'
import { Badge, Button, Card, cx, Eyebrow, Icon } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { formatSom } from '../../lib/format'
import { useStore } from '../../store/useStore'
import type { Course, Preset, University } from '../../types'

/** One package: its program, required subjects, included courses, total price, official source and the add-to-cart button. */
function PackageCard({ preset, university, courses, cartGroupIds, onAdd }: { preset: Preset; university?: University; courses: Course[]; cartGroupIds: string[]; onAdd: (p: Preset) => void }) {
  const { t, tr, lang } = useT()
  const centers = useStore((s) => s.centers)
  const categories = useStore((s) => s.categories)
  const ready = presetReadiness(preset, courses).ready && presetMissingSubjects(preset).length === 0
  const list = ready ? presetCourses(preset, courses) : []
  const allInCart = ready && presetCartPlan(preset, list, cartGroupIds).toAdd.length === 0
  const a = preset.admission
  const verified = a?.status === 'verified'

  return (
    <Card className={cx('flex flex-col p-5 sm:p-6', !ready && 'opacity-75')}>
      {university && <div className="eyebrow mb-1">{university.shortName || university.name}</div>}
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-display text-2xl leading-tight text-charcoal sm:text-3xl">{tr(preset.name)}</h3>
        {!ready && <Badge tone="warn">{t('preset.unavailable')}</Badge>}
      </div>
      {tr(preset.program) && <div className="mt-1 text-sm font-medium text-forest">{tr(preset.program)}</div>}
      {tr(preset.description) && <p className="mt-2 text-sm leading-relaxed text-charcoal/65">{tr(preset.description)}</p>}

      <Eyebrow className="mt-5">{t('uni.requiredSubjects')}</Eyebrow>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {preset.slots.map((slot) => (
          <li key={slot.id} className="inline-flex items-center gap-1 rounded-full border border-forest/15 bg-sage/50 px-2.5 py-1 text-xs font-medium text-forest">
            <Icon name="check" className="h-3 w-3" />
            {tr(slot.label)}
          </li>
        ))}
      </ul>

      {ready ? (
        <>
          <Eyebrow className="mt-5">{t('preset.courses')}</Eyebrow>
          <ul className="mt-2 divide-y divide-charcoal/10">
            {list.map((c) => (
              <li key={c.id} className="flex items-start justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-charcoal">{tr(c.title)}</span>
                    <FormatBadge course={c} />
                  </div>
                  <div className="mt-0.5 text-[11px] text-charcoal/50">{[tr(categories.find((x) => x.id === c.categoryId)?.name), centers.find((x) => x.id === c.centerId)?.name].filter(Boolean).join(' · ')}</div>
                  {c.groups[0] && <div className="mt-1"><ScheduleChips group={c.groups[0]} compact />{c.groups.length > 1 && <span className="ml-1.5 text-[11px] text-charcoal/45">+{c.groups.length - 1}</span>}</div>}
                  {tr(c.summary) && <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-charcoal/55">{tr(c.summary)}</p>}
                </div>
                <div className="shrink-0 text-charcoal"><PriceNow course={c} /></div>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex items-end justify-between border-t border-charcoal/10 pt-3">
            <span className="text-sm text-charcoal/60">{t('builder.monthlyTotal')}</span>
            <span className="font-display text-2xl text-charcoal">{formatSom(presetTotal(list), lang)}</span>
          </div>
          <p className="mt-1 text-[11px] text-amber-800">{t('preset.provisional')}</p>
        </>
      ) : (
        <p className="mt-4 text-sm text-charcoal/60">{t('preset.unavailableHint')}</p>
      )}

      {a && (a.url || a.academicYear) && (
        <div className="mt-4 rounded-control border border-forest/10 bg-sage/30 p-3 text-[11px] leading-relaxed text-charcoal/65">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-charcoal/80">{t('uni.source')}</span>
            <Badge tone={verified ? 'sage' : 'warn'}>{verified ? t('uni.verified') : t('uni.needsReview')}</Badge>
          </div>
          {a.academicYear && a.checkedOn && <div className="mt-1">{t('uni.sourceMeta', { year: a.academicYear, date: a.checkedOn })}</div>}
          {/^https:\/\//.test(a.url) && <a href={a.url} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 font-medium text-forest hover:underline">{t('uni.officialPage')}<Icon name="external" className="h-3 w-3" /></a>}
        </div>
      )}

      <Button className="mt-5 w-full" disabled={!ready || allInCart} onClick={() => onAdd(preset)}>
        {allInCart ? <><Icon name="check" className="h-4 w-4" />{t('favorites.inCart')}</> : <><Icon name="cart" className="h-4 w-4" />{t('preset.add')}</>}
      </Button>
    </Card>
  )
}

/**
 * Ready-made packages next to Duo and Trio: pick a university, then one of its programs, and add the package's courses to
 * the same cart the builder uses. Only published packages reach this component (the public site hides drafts), and
 * every university package shown here has verified admission requirements.
 */
export function UniversityPackagesSection({ presets, universities, courses, cartGroupIds, onAdd }: { presets: Preset[]; universities: University[]; courses: Course[]; cartGroupIds: string[]; onAdd: (p: Preset) => void }) {
  const { t } = useT()
  const [params, setParams] = useSearchParams()
  const published = presets.filter((p) => p.enabled)
  if (published.length === 0) return null

  const groups = groupByUniversity(published, universities)
  const generic = published.filter((p) => !universityOf(p, universities))
  const selected = groups.find((g) => g.university.id === params.get('uni')) ?? (groups.length === 1 ? groups[0] : undefined)
  const select = (id: string | null) => {
    const next = new URLSearchParams(params)
    if (id) next.set('uni', id)
    else next.delete('uni')
    setParams(next, { replace: true })
  }

  return (
    <section className="mb-12" aria-labelledby="uni-title">
      <Eyebrow className="mb-1">{t('uni.title')}</Eyebrow>
      <p id="uni-title" className="mb-5 max-w-2xl text-sm text-charcoal/60">{t('uni.subtitle')}</p>

      {groups.length > 0 && (
        <>
          <div className="mb-3 flex items-center justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-charcoal/50">{t('uni.universities')} · {groups.length}</span>
            {selected && groups.length > 1 && <button type="button" onClick={() => select(null)} className="text-xs font-medium text-forest hover:underline">← {t('uni.all')}</button>}
          </div>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" role="list">
            {groups.map((g) => {
              const active = selected?.university.id === g.university.id
              return (
                <li key={g.university.id}>
                  <button
                    type="button"
                    aria-pressed={active}
                    onClick={() => select(active && groups.length > 1 ? null : g.university.id)}
                    className={cx(
                      'flex h-full w-full flex-col rounded-card border p-4 text-left transition',
                      active ? 'border-forest bg-sage/50 shadow-soft ring-1 ring-forest/20' : 'border-charcoal/10 bg-paper hover:-translate-y-0.5 hover:border-forest/40 hover:shadow-lift',
                    )}
                  >
                    <span className="font-display text-2xl leading-tight text-charcoal">{g.university.shortName || g.university.name}</span>
                    {g.university.shortName && <span className="mt-0.5 line-clamp-2 text-xs text-charcoal/55">{g.university.name}</span>}
                    <span className="mt-auto flex items-center justify-between pt-3 text-[11px] font-medium text-forest">
                      <span>{t('uni.packagesCount', { n: g.presets.length })}</span>
                      {g.university.city && <span className="text-charcoal/45">{g.university.city}</span>}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}

      {selected ? (
        <div className="mt-8">
          <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="font-display text-3xl text-charcoal">{selected.university.name}</h2>
            <span className="text-xs font-semibold uppercase tracking-wider text-charcoal/50">{t('uni.programs')} · {selected.presets.length}</span>
            {/^https:\/\//.test(selected.university.website ?? '') && <a href={selected.university.website} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-forest hover:underline">{selected.university.website?.replace(/^https:\/\//, '')}<Icon name="external" className="h-3 w-3" /></a>}
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            {selected.presets.map((p) => <PackageCard key={p.id} preset={p} university={selected.university} courses={courses} cartGroupIds={cartGroupIds} onAdd={onAdd} />)}
          </div>
        </div>
      ) : groups.length > 0 ? (
        <p className="mt-6 text-sm text-charcoal/55">{t('uni.choose')}</p>
      ) : null}

      {generic.length > 0 && (
        <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {generic.map((p) => <PackageCard key={p.id} preset={p} courses={courses} cartGroupIds={cartGroupIds} onAdd={onAdd} />)}
        </div>
      )}

      {groups.length > 0 && <p className="mt-6 max-w-3xl text-[11px] leading-relaxed text-charcoal/50">{t('uni.disclaimer')}</p>}
    </section>
  )
}
