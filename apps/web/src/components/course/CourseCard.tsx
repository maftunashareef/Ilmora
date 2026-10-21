import { Link } from '@/lib/router'
import { useT } from '../../i18n/useT'
import { formatSom } from '../../lib/format'
import { useStore } from '../../store/useStore'
import type { Course, Group } from '../../types'
import { ArtCover, Badge, cx, Icon } from '../ui'
import { LevelBadge, StatusBadge, VisibilityBadge } from './badges'

export function PriceTag({ price, emphasis, className }: { price: number; emphasis?: boolean; className?: string }) {
  const { t, lang } = useT()
  return (
    <span className={cx('inline-flex items-baseline gap-1', className)}>
      <span className={cx('font-display tracking-tight text-charcoal', emphasis ? 'text-2xl' : 'text-lg')}>{formatSom(price, lang, false)}</span>
      <span className="text-xs text-charcoal/55">{t('common.som')} {t('common.perMonth')}</span>
    </span>
  )
}

export function ScheduleChips({ group, compact }: { group: Group; compact?: boolean }) {
  const { t } = useT()
  return (
    <span className={cx('inline-flex flex-wrap items-center gap-1.5', compact ? 'text-[11px]' : 'text-xs')}>
      <span className="inline-flex gap-0.5">
        {group.days.map((d) => (
          <span key={d} className="rounded-sm bg-sage px-1.5 py-0.5 font-medium text-forest">{t(`dayShort.${d}` as 'dayShort.0')}</span>
        ))}
      </span>
      <span className="text-charcoal/65">{group.start}–{group.end}</span>
    </span>
  )
}

export function CourseCard({ course, showInternal, compact }: { course: Course; showInternal?: boolean; compact?: boolean }) {
  const { t, tr } = useT()
  const tpl = useStore((s) => s.site.courseCard)
  const teacher = useStore((s) => s.teachers.find((x) => x.id === course.teacherId))
  const center = useStore((s) => s.centers.find((x) => x.id === course.centerId))
  const category = useStore((s) => s.categories.find((x) => x.id === course.categoryId))
  const g = course.groups[0]
  return (
    <article className="card group flex h-full flex-col overflow-hidden transition duration-300 hover:-translate-y-0.5 hover:shadow-lift" style={{ padding: 0 }}>
      <Link to={`/courses/${course.id}`} className="block focus-visible:outline-offset-[-3px]">
        <ArtCover seed={course.coverSeed} imageUrl={course.imageUpload?.previewUrl || course.imageUrl} tone={center?.tone} className={cx('zoom-media w-full', compact ? 'aspect-[16/8]' : 'aspect-[16/9]')} />
      </Link>
      <div className={cx('flex flex-1 flex-col', compact ? 'p-4' : 'p-5')}>
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          {tpl.showCategory && category && <Badge tone="sage">{tr(category.name)}</Badge>}
          {course.featured && <Badge tone="champagne"><Icon name="star" className="h-3 w-3" />{t('common.featured')}</Badge>}
          {tpl.showLevel && <LevelBadge level={course.level} />}
          {showInternal && (<><StatusBadge status={course.status} /><VisibilityBadge visibility={course.visibility} /></>)}
        </div>
        <h3 className={cx('font-display leading-snug text-charcoal', compact ? 'text-xl' : 'text-2xl')}>
          <Link to={`/courses/${course.id}`} className="hover:text-forest">{tr(course.title)}</Link>
        </h3>
        {!compact && <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-charcoal/60">{tr(course.summary)}</p>}
        <div className="mt-3 space-y-1 text-xs text-charcoal/60">
          {tpl.showTeacher && teacher && <div>{teacher.name}</div>}
          {tpl.showCenter && center && <div className="flex items-center gap-1.5"><Icon name="building" className="h-3 w-3" />{center.name} · {tr(center.district)}</div>}
          {tpl.showSchedule && g && <div><ScheduleChips group={g} compact />{course.groups.length > 1 && <span className="ml-1 text-charcoal/40">+{course.groups.length - 1}</span>}</div>}
        </div>
        <div className="mt-auto flex items-end justify-between gap-3 pt-4">
          <PriceTag price={course.price} emphasis={tpl.priceStyle === 'emphasis'} />
          <Link to={`/courses/${course.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-forest opacity-80 transition group-hover:opacity-100">
            {t('common.view')} <Icon name="arrowRight" className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>
    </article>
  )
}
