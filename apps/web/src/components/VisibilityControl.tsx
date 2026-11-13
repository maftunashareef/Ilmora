import { useT } from '../i18n/useT'
import { useStore } from '../store/useStore'
import type { Audience, Visibility } from '../types'
import { Badge, Icon, Notice } from './ui'
import { cx } from './ui/helpers'

/**
 * Explicit Public/Private choice with an audience selector for private content.
 * `value` may be null when the teacher hasn't chosen yet — publishing is blocked until they do.
 */
export function VisibilityControl({
  value, audience, onChange, teacherId, showEnrollmentNote = true,
}: {
  value: Visibility | null
  audience: Audience
  onChange: (v: Visibility | null, a: Audience) => void
  teacherId: string
  showEnrollmentNote?: boolean
}) {
  const { t, tr } = useT()
  const courses = useStore((s) => s.courses.filter((c) => c.teacherId === teacherId))
  const students = useStore((s) => s.students)
  const groups = courses.flatMap((c) => c.groups.map((g) => ({ ...g, courseTitle: tr(c.title) })))

  const toggleGroup = (id: string) =>
    onChange('private', { ...audience, groupIds: audience.groupIds.includes(id) ? audience.groupIds.filter((x) => x !== id) : [...audience.groupIds, id] })
  const toggleStudent = (id: string) =>
    onChange('private', { ...audience, studentIds: audience.studentIds.includes(id) ? audience.studentIds.filter((x) => x !== id) : [...audience.studentIds, id] })

  const total = audience.groupIds.length + audience.studentIds.length

  return (
    <fieldset className="space-y-3">
      <legend className="mb-2 text-sm font-medium text-charcoal">{t('vis.chooseTitle')} <span className="text-champagne">*</span></legend>
      <div className="grid gap-3 sm:grid-cols-2">
        {(['public', 'private'] as Visibility[]).map((v) => {
          const active = value === v
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => onChange(v, audience)}
              className={cx('rounded-card border p-4 text-left transition', active ? 'border-forest bg-sage/50 ring-inset-forest' : 'border-charcoal/12 bg-paper hover:border-forest/40')}
            >
              <div className="flex items-center gap-2">
                <span className={cx('flex h-8 w-8 items-center justify-center rounded-full', v === 'public' ? 'bg-forest text-ivory' : 'bg-champagne text-charcoal')}>
                  <Icon name={v === 'public' ? 'globe' : 'lock'} className="h-4 w-4" />
                </span>
                <span className="font-medium text-charcoal">{t(v === 'public' ? 'vis.public' : 'vis.private')}</span>
                {active && <Icon name="check" className="ml-auto h-4 w-4 text-forest" />}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-charcoal/60">{t(v === 'public' ? 'vis.publicHint' : 'vis.privateHint')}</p>
            </button>
          )
        })}
      </div>
      {value === null && <Notice tone="warn">{t('vis.required')}</Notice>}

      {value === 'private' && (
        <div className="rounded-card border border-charcoal/10 bg-ivory/60 p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="text-sm font-medium text-charcoal">{t('vis.audience')}</div>
            {total === 0 ? <Badge tone="warn">{t('vis.noAudience')}</Badge> : <Badge tone="sage">{total} {t('common.selected').toLowerCase()}</Badge>}
          </div>
          <p className="mb-4 text-xs text-charcoal/60">{t('vis.audienceHint')}</p>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <div className="eyebrow mb-2">{t('vis.groups')}</div>
              <div className="space-y-1.5">
                {groups.length === 0 && <div className="text-xs text-charcoal/45">{t('common.empty')}</div>}
                {groups.map((g) => (
                  <label key={g.id} className="flex cursor-pointer items-start gap-2.5 rounded-control border border-charcoal/10 bg-paper px-3 py-2 text-sm hover:border-forest/40">
                    <input type="checkbox" className="mt-0.5 accent-forest" checked={audience.groupIds.includes(g.id)} onChange={() => toggleGroup(g.id)} />
                    <span>
                      <span className="block text-charcoal">{g.name}</span>
                      <span className="block text-[11px] text-charcoal/50">{g.courseTitle}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div className="eyebrow mb-2">{t('vis.students')}</div>
              <div className="space-y-1.5">
                {students.map((s) => (
                  <label key={s.id} className="flex cursor-pointer items-center gap-2.5 rounded-control border border-charcoal/10 bg-paper px-3 py-2 text-sm hover:border-forest/40">
                    <input type="checkbox" className="accent-forest" checked={audience.studentIds.includes(s.id)} onChange={() => toggleStudent(s.id)} />
                    <span className="text-charcoal">{s.profile.displayName}</span>
                    <span className="ml-auto text-[11px] text-charcoal/45">{s.profile.district}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
      {showEnrollmentNote && <p className="text-[12px] leading-relaxed text-charcoal/50">{t('vis.enrollmentNote')} {t('vis.changeLater')}</p>}
    </fieldset>
  )
}
