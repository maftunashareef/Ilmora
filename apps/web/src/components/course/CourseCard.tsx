import { activePercent, countLabel, finalPriceSom, isOnlineCourse, NOUNS } from '@ilmora/shared'
import { Link } from '@/lib/router'
import { useT } from '../../i18n/useT'
import { formatSom } from '../../lib/format'
import { useCanSaveCourses, useHydrated } from '../../store/selectors'
import { useStore } from '../../store/useStore'
import type { Course, Group } from '../../types'
import { Avatar, Icon } from '../ui'
import { cx } from '../ui/helpers'
import { getTeacherAvatarUrl } from '../teacher/teacherImage'
import { StatusBadge, VisibilityBadge } from './badges'
import { SaleRibbon } from './DiscountShowcase'
import { getCoursePhotoUrl } from './courseImage'

export function PriceTag({ price, original, percent, emphasis, className }: { price: number; original?: number; percent?: number; emphasis?: boolean; className?: string }) {
  const { t, lang } = useT()
  return (
    <span className={cx('inline-flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5', className)}>
      {original !== undefined && (
        <span className="text-xs text-charcoal/45 line-through" title={t('discount.was')}>
          <span className="sr-only">{t('discount.was')}: </span>
          {formatSom(original, lang, false)}
        </span>
      )}
      {/* The amount, its unit and the discount stay on one line ("900 000" never breaks between its digits). */}
      <span className="inline-flex items-baseline gap-x-1.5 whitespace-nowrap">
        <span className={cx('font-display tracking-tight font-semibold', original !== undefined || percent ? 'text-forest' : 'text-charcoal', emphasis || original !== undefined ? 'text-2xl' : 'text-xl')}>
          {formatSom(price, lang, false)}
        </span>
        <span className="text-[11px] text-charcoal/55 font-medium">
          {t('common.som')} {t('common.perMonth')}
        </span>
        {percent ? <span className="rounded-full bg-champagne px-2 py-0.5 text-[10px] font-bold text-forest">−{percent}%</span> : null}
      </span>
    </span>
  )
}

/** A course's monthly price with its active discount: original struck through, price to pay, percentage. */
export function CoursePrice({ course, emphasis, className }: { course: Course; emphasis?: boolean; className?: string }) {
  const percent = activePercent(course)
  return <PriceTag price={finalPriceSom(course)} original={percent ? course.price : undefined} percent={percent || undefined} emphasis={emphasis} className={className} />
}

/** A monthly total (see priceTotals): the total before discounts struck through when one applies, the total to pay, and the amount saved. */
export function TotalPrice({ list, final, className }: { list: number; final: number; className?: string }) {
  const { t, lang } = useT()
  const saved = list - final
  return (
    <div className={cx('text-right', className)}>
      {saved > 0 && (
        <div className="text-sm text-charcoal/45 line-through">
          <span className="sr-only">{t('discount.was')}: </span>
          {formatSom(list, lang)}
        </div>
      )}
      <div className="font-display text-3xl text-charcoal">{formatSom(final, lang)}</div>
      {saved > 0 && <div className="mt-0.5 text-xs font-semibold text-forest">{t('builder.saving', { price: formatSom(saved, lang) })}</div>}
    </div>
  )
}

/** Compact price for list rows (no unit text): the price to pay, with the original struck through while a discount is active. */
export function PriceNow({ course, withCurrency }: { course: Course; withCurrency?: boolean }) {
  const { lang } = useT()
  const percent = activePercent(course)
  return (
    <span>
      {percent ? <span className="mr-1.5 text-xs text-charcoal/45 line-through">{formatSom(course.price, lang, false)}</span> : null}
      {formatSom(finalPriceSom(course), lang, withCurrency ?? false)}
    </span>
  )
}

/** A group's days and time; nothing for a course that has no group yet (a published course may have none). */
export function ScheduleChips({ group, compact }: { group: Group | undefined; compact?: boolean }) {
  const { t } = useT()
  if (!group) return null
  return (
    <span className={cx('inline-flex flex-wrap items-center gap-1.5', compact ? 'text-[11px]' : 'text-xs')}>
      <span className="inline-flex gap-0.5">
        {group.days.map((d) => (
          <span key={d} className="rounded-sm bg-sage/80 px-1.5 py-0.5 font-medium text-forest text-[11px]">
            {t(`dayShort.${d}` as 'dayShort.0')}
          </span>
        ))}
      </span>
      <span className="text-charcoal/70 font-medium">{group.start}–{group.end}</span>
    </span>
  )
}

/** Bookmark toggle for guests and students. Saving a course is never a purchase; the saved list lives at /favorites. */
export function SaveButton({ courseId }: { courseId: string }) {
  const { t } = useT()
  const canSave = useCanSaveCourses()
  const hydrated = useHydrated()
  const studentId = useStore((s) => s.currentStudentId)
  const saved = useStore((s) => s.students.find((x) => x.id === s.currentStudentId)?.savedCourseIds.includes(courseId) ?? false)
  const toggle = useStore((s) => s.toggleSavedCourse)
  if (!canSave) return null
  const on = hydrated && saved
  const label = on ? t('favorites.remove') : t('favorites.add')
  return (
    <button
      type="button"
      aria-pressed={on}
      aria-label={label}
      title={label}
      onClick={() => toggle(studentId, courseId)}
      className={cx(
        'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control border transition-colors duration-200',
        on ? 'border-forest/40 bg-sage text-forest' : 'border-charcoal/15 text-charcoal/55 hover:border-forest/40 hover:text-forest',
      )}
    >
      <Icon name={on ? 'bookmarkFill' : 'bookmark'} className="h-4 w-4" />
    </button>
  )
}

/** "Online" or "Offline", in the same place on every course card and course list. */
export function FormatBadge({ course, className }: { course: Pick<Course, 'learningFormat'>; className?: string }) {
  const { t } = useT()
  const online = isOnlineCourse(course)
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold', online ? 'border-forest bg-forest text-ivory' : 'border-forest/20 bg-sage/70 text-forest', className)}>
      <Icon name={online ? 'globe' : 'building'} className="h-3 w-3" />
      {t(online ? 'format.badge.ONLINE' : 'format.badge.OFFLINE')}
    </span>
  )
}

export function CourseCard({ course, showInternal, compact }: { course: Course; showInternal?: boolean; compact?: boolean }) {
  const { t, tr, lang } = useT()
  const tpl = useStore((s) => s.site.courseCard)
  const teacher = useStore((s) => s.teachers.find((x) => x.id === course.teacherId))
  const center = useStore((s) => s.centers.find((x) => x.id === course.centerId))
  const category = useStore((s) => s.categories.find((x) => x.id === course.categoryId))
  const g = course.groups[0]
  const online = isOnlineCourse(course)
  // A discount only ever applies to a paid offline course; the card then gets a gold frame and a SALE ribbon.
  const salePercent = online ? 0 : activePercent(course)
  // Offline courses run for a number of months; an online course's length is the provider's own wording.
  const durationLabel = online ? (course.durationText ? tr(course.durationText) : '') : course.durationMonths > 0 ? `${course.durationMonths} ${tr({ uz: 'oy', ru: 'мес', en: 'mo' })}` : ''

  return (
    <article
      className={cx(
        'card group relative flex h-full flex-col overflow-hidden rounded-card transition-all duration-400 hover:-translate-y-1.5 hover:shadow-lift border',
        salePercent > 0
          ? 'border-champagne/80 hover:border-champagne bg-gradient-to-b from-paper via-paper to-champagne/[0.08] ring-1 ring-champagne/40'
          : course.featured
            ? 'border-champagne/60 hover:border-champagne bg-gradient-to-b from-paper via-paper to-champagne/[0.04] ring-1 ring-champagne/25'
            : 'border-charcoal/10 hover:border-forest/35 bg-paper'
      )}
      style={{ padding: 0 }}
    >
      {salePercent > 0 && <span className="pointer-events-none absolute inset-x-0 top-0 z-20 h-1 bg-gradient-to-r from-[#b8923d] via-champagne to-[#b8923d]" aria-hidden="true" />}
      {/* Top Cover Media: Editorial photographic representation */}
      <Link to={`/courses/${course.id}`} className="block relative overflow-hidden focus-visible:outline-offset-[-3px] bg-sage/20">
        <div className={cx('relative overflow-hidden', compact ? 'aspect-[16/8]' : 'aspect-[16/10]')}>
          <img
            src={getCoursePhotoUrl(course)}
            alt={tr(course.title)}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.04]"
          />
          {/* Subtle warm brand gradient overlays for badge contrast & editorial cohesion */}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-charcoal/75 via-charcoal/20 to-charcoal/30" aria-hidden="true" />
          <div className="pointer-events-none absolute inset-0 bg-forest/5 mix-blend-multiply" aria-hidden="true" />
        </div>

        {/* Top Badges Overlay */}
        <div className="absolute inset-x-3 top-3 flex items-start justify-between gap-2 pointer-events-none z-10">
          {tpl.showCategory && category ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-paper/95 px-2.5 py-0.5 text-[11px] font-semibold text-charcoal shadow-sm backdrop-blur-md border border-charcoal/10">
              {category.glyph && <span className="text-xs">{category.glyph}</span>}
              <span className="truncate max-w-[140px]">{tr(category.name)}</span>
            </span>
          ) : <span />}

          <div className="flex flex-wrap items-center justify-end gap-1.5">
            {salePercent > 0 && <SaleRibbon percent={salePercent} />}
            {course.featured && (
              <span className="shimmer-pill rounded-full bg-champagne text-charcoal px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider shadow-sm border border-champagne/70 flex items-center gap-1">
                <Icon name="star" className="h-3 w-3 fill-current text-charcoal/80" />
                {t('common.featured')}
              </span>
            )}
            {course.meyosGrant && (
              <span className="rounded-full bg-emerald-700 text-ivory px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider shadow-sm">
                Meyos
              </span>
            )}
          </div>
        </div>

        {/* Bottom Cover Info Pill (Level & Duration) */}
        <div className="absolute bottom-2.5 left-3 right-3 flex items-center justify-between text-[11px] text-ivory font-medium drop-shadow-sm pointer-events-none z-10">
          {tpl.showLevel ? (
            <span className="bg-charcoal/75 backdrop-blur-sm px-2.5 py-0.5 rounded-full text-[10px] font-semibold border border-ivory/20 shadow-xs">
              {t(`level.${course.level}`)}
            </span>
          ) : <span />}
          {durationLabel && (
            <span className="bg-charcoal/75 backdrop-blur-sm px-2.5 py-0.5 rounded-full text-[10px] font-semibold border border-ivory/20 shadow-xs flex items-center gap-1 max-w-[60%]">
              <Icon name="clock" className="h-3 w-3 shrink-0 text-champagne" />
              <span className="truncate">{durationLabel}</span>
            </span>
          )}
        </div>
      </Link>

      {/* Card Content Body */}
      <div className={cx('flex flex-1 flex-col', compact ? 'p-4' : 'p-5')}>
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <FormatBadge course={course} />
          {showInternal && (
            <>
              <StatusBadge status={course.status} />
              <VisibilityBadge visibility={course.visibility} />
            </>
          )}
        </div>

        {/* Title */}
        <h3 className={cx('font-display leading-snug text-charcoal group-hover:text-forest transition-colors duration-200', compact ? 'text-xl' : 'text-2xl')}>
          <Link to={`/courses/${course.id}`} className="focus-visible:outline-none focus-visible:underline">
            {tr(course.title)}
          </Link>
        </h3>

        {/* Summary Description */}
        {!compact && (
          <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-charcoal/70">
            {tr(course.summary)}
          </p>
        )}

        {/* Metadata section (Teacher, Center, Schedule) */}
        <div className="mt-4 space-y-2.5 border-t border-charcoal/8 pt-3 text-xs">
          {online && course.providerName && (
            <div className="flex items-center gap-2 text-charcoal/65">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-sage/60 text-forest">
                <Icon name="globe" className="h-3 w-3" />
              </span>
              <span className="truncate font-medium text-charcoal/80">{course.providerName}</span>
            </div>
          )}
          {online && course.instructorName && (
            <div className="flex items-center gap-2 text-charcoal/85">
              <Avatar name={course.instructorName} seed={course.coverSeed} size={22} className="shadow-2xs text-[10px] shrink-0" />
              <span className="font-medium truncate">{course.instructorName}</span>
            </div>
          )}
          {online && course.certificate && course.certificate !== 'NONE' && (
            <div className="flex items-center gap-1.5 text-charcoal/65">
              <Icon name="check" className="h-3.5 w-3.5 shrink-0 text-forest" />
              <span className="truncate">{t(`online.cert.${course.certificate}` as 'online.cert.FREE')}</span>
            </div>
          )}

          {!online && tpl.showTeacher && teacher && (
            <div className="flex items-center gap-2 text-charcoal/85">
              <Avatar name={teacher.name} seed={teacher.avatarSeed} url={getTeacherAvatarUrl(teacher)} size={22} className="shadow-2xs text-[10px] shrink-0" />
              <span className="font-medium truncate">{teacher.name}</span>
            </div>
          )}

          {!online && tpl.showCenter && center && (
            <div className="flex items-center gap-2 text-charcoal/65">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-sage/60 text-forest">
                <Icon name="building" className="h-3 w-3" />
              </span>
              <span className="truncate">
                <span className="font-medium text-charcoal/80">{center.name}</span>
                <span className="text-charcoal/50"> · {tr(center.district)}</span>
              </span>
            </div>
          )}

          {!online && tpl.showSchedule && g && (
            <div className="flex items-center gap-1.5 pt-0.5">
              <ScheduleChips group={g} compact />
              {course.groups.length > 1 && (
                <span className="text-[11px] text-charcoal/45 font-medium whitespace-nowrap">
                  +{countLabel(lang, course.groups.length - 1, NOUNS.group)}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Footer: the same three rows on every card (label with the old price, price on one line, saving and buttons),
            so prices and buttons line up across a row of cards. */}
        <div className="mt-auto border-t border-charcoal/8 pt-4">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-charcoal/40 leading-tight">
              {online ? t('format.onlineHint') : t('courses.monthlyPrice')}
            </span>
            {salePercent > 0 && (
              <span className="whitespace-nowrap text-xs text-charcoal/45 line-through" title={t('discount.was')}>
                <span className="sr-only">{t('discount.was')}: </span>
                {formatSom(course.price, lang, false)}
              </span>
            )}
          </div>
          <div className="mt-1 [&_.font-display]:text-[26px] [&_.font-display]:leading-tight">
            {online ? <span className="font-display font-semibold tracking-tight text-forest">{t('online.free')}</span> : <PriceTag price={finalPriceSom(course)} percent={salePercent || undefined} emphasis={tpl.priceStyle === 'emphasis'} />}
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            {salePercent > 0 ? <span className="min-w-0 text-[11px] font-semibold leading-snug text-forest">{t('discounts.save', { price: formatSom(course.price - finalPriceSom(course), lang) })}</span> : <span />}
          <div className="flex shrink-0 items-center gap-2">
          <SaveButton courseId={course.id} />
          {online && course.externalUrl && (
            <a
              href={course.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${t('online.openOnProvider')}: ${course.providerName ?? ''}`}
              title={t('online.openOnProvider')}
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-charcoal/15 text-charcoal/55 transition-colors duration-200 hover:border-forest/40 hover:text-forest"
            >
              <Icon name="external" className="h-4 w-4" />
            </a>
          )}
          <Link
            to={`/courses/${course.id}`}
            className="inline-flex items-center justify-center gap-1.5 rounded-control bg-sage/70 px-3.5 py-2 text-xs font-semibold text-forest shadow-2xs transition-all duration-300 group-hover:bg-forest group-hover:text-ivory group-hover:shadow-sm shrink-0"
          >
            {t('common.view')}
            <Icon name="arrowRight" className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
          </div>
          </div>
        </div>
      </div>
    </article>
  )
}

export function CourseCardSkeleton({ compact }: { compact?: boolean }) {
  return (
    <div className="card overflow-hidden border border-charcoal/10 bg-paper animate-pulse" aria-hidden="true" style={{ padding: 0 }}>
      <div className={cx('w-full bg-charcoal/10', compact ? 'aspect-[16/8]' : 'aspect-[16/10]')} />
      <div className={cx('flex flex-col', compact ? 'p-4' : 'p-5')}>
        <div className="flex gap-2 mb-2">
          <div className="h-4 w-16 rounded-full bg-charcoal/10" />
          <div className="h-4 w-14 rounded-full bg-charcoal/10" />
        </div>
        <div className="h-6 w-3/4 rounded bg-charcoal/15 mb-2" />
        {!compact && (
          <div className="space-y-1.5 mb-3">
            <div className="h-3.5 w-full rounded bg-charcoal/10" />
            <div className="h-3.5 w-4/5 rounded bg-charcoal/10" />
          </div>
        )}
        <div className="mt-2 space-y-2 border-t border-charcoal/8 pt-3">
          <div className="h-4 w-1/2 rounded bg-charcoal/10" />
          <div className="h-4 w-2/3 rounded bg-charcoal/10" />
        </div>
        <div className="mt-4 pt-3 border-t border-charcoal/8 flex items-center justify-between">
          <div className="h-5 w-24 rounded bg-charcoal/15" />
          <div className="h-7 w-20 rounded bg-charcoal/15" />
        </div>
      </div>
    </div>
  )
}
