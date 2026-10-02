import { useT } from '../i18n/useT'
import { expandLessons, toMin, todayIndex, type Conflict } from '../lib/schedule'
import type { Course, Group } from '../types'
import { cx } from './ui'

const START = 8 * 60
const END = 22 * 60
const SPAN = END - START

const TONES = ['bg-forest text-ivory', 'bg-champagne text-charcoal', 'bg-[#4E6E68] text-ivory', 'bg-[#A67C52] text-ivory', 'bg-[#8A9A7B] text-ivory']

/** Weekly timetable: seven day columns, lessons positioned by time. Conflicting lessons are outlined. */
export function Timetable({ groups, courses, conflicts = [], compact, className }: { groups: Group[]; courses: Course[]; conflicts?: Conflict[]; compact?: boolean; className?: string }) {
  const { t, tr } = useT()
  const lessons = expandLessons(groups, courses)
  const courseIds = Array.from(new Set(groups.map((g) => g.courseId)))
  const conflictIds = new Set(conflicts.flatMap((c) => [c.a.id, c.b.id]))
  const today = todayIndex()
  const hours = compact ? [9, 12, 15, 18, 21] : [8, 10, 12, 14, 16, 18, 20, 22]
  const h = compact ? 300 : 440

  return (
    <div className={cx('card overflow-hidden p-0', className)}>
      <div className="grid grid-cols-[2.4rem_repeat(7,minmax(0,1fr))] border-b border-charcoal/10 text-center text-[11px] font-medium text-charcoal/60">
        <div />
        {Array.from({ length: 7 }).map((_, d) => (
          <div key={d} className={cx('py-2', d === today && 'text-forest')}>
            <span className="hidden sm:inline">{t(`day.${d}` as 'day.0')}</span>
            <span className="sm:hidden">{t(`dayShort.${d}` as 'dayShort.0')}</span>
            {d === today && <span className="mx-auto mt-0.5 block h-1 w-1 rounded-full bg-champagne" />}
          </div>
        ))}
      </div>
      <div className="relative grid grid-cols-[2.4rem_repeat(7,minmax(0,1fr))]" style={{ height: h }}>
        {/* Hour lines */}
        {hours.map((hr) => (
          <div key={hr} className="pointer-events-none absolute inset-x-0 flex items-start" style={{ top: `${((hr * 60 - START) / SPAN) * 100}%` }}>
            <span className="w-[2.4rem] -translate-y-1/2 pr-1 text-right text-[10px] text-charcoal/40">{hr}:00</span>
            <span className="h-px flex-1 bg-charcoal/6" />
          </div>
        ))}
        <div />
        {Array.from({ length: 7 }).map((_, d) => (
          <div key={d} className={cx('relative border-l border-charcoal/6', d === today && 'bg-sage/25')}>
            {lessons.filter((l) => l.day === d).map((l) => {
              const top = ((toMin(l.start) - START) / SPAN) * 100
              const height = ((toMin(l.end) - toMin(l.start)) / SPAN) * 100
              const tone = TONES[courseIds.indexOf(l.course.id) % TONES.length]
              const clash = conflictIds.has(l.group.id)
              return (
                <div
                  key={`${l.group.id}-${d}`}
                  className={cx('absolute inset-x-0.5 overflow-hidden rounded-[6px] px-1.5 py-1 text-[10px] leading-tight shadow-sm sm:inset-x-1', tone, clash && 'ring-2 ring-red-500 ring-offset-1 ring-offset-paper')}
                  style={{ top: `${top}%`, height: `calc(${height}% - 2px)` }}
                  title={`${tr(l.course.title)} · ${l.start}–${l.end} · ${l.group.room}`}
                >
                  <div className="truncate font-medium">{tr(l.course.title)}</div>
                  {!compact && <div className="truncate opacity-80">{l.start}–{l.end}</div>}
                </div>
              )
            })}
          </div>
        ))}
      </div>
      {courseIds.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-charcoal/10 px-4 py-3 text-[11px] text-charcoal/65">
          {courseIds.map((id, i) => {
            const c = courses.find((x) => x.id === id)
            return c ? <span key={id} className="inline-flex items-center gap-1.5"><span className={cx('h-2.5 w-2.5 rounded-sm', TONES[i % TONES.length].split(' ')[0])} />{tr(c.title)}</span> : null
          })}
        </div>
      )}
    </div>
  )
}
