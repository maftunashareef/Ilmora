import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { activePercent, finalPriceSom, isoToTashkentLocal } from '@ilmora/shared'
import { Link } from '@/lib/router'
import { useT } from '../../i18n/useT'
import { formatDate, formatSom } from '../../lib/format'
import { useStore } from '../../store/useStore'
import type { Course } from '../../types'
import { Icon, LinkButton } from '../ui'
import { getCoursePhotoUrl } from './courseImage'

/** Fewer courses than this are shown as a still row: a loop of two or three cards looks repetitive. */
const MIN_ROTATING = 4

/** One discounted course: photo, percentage, original and discounted price, saving, end date, add to cart and details. */
function DiscountCard({ course, copy }: { course: Course; copy?: boolean }) {
  const { t, tr, lang } = useT()
  const center = useStore((s) => s.centers.find((x) => x.id === course.centerId))
  const category = useStore((s) => s.categories.find((x) => x.id === course.categoryId))
  const percent = activePercent(course)
  const price = finalPriceSom(course)
  // The end date as a Tashkent calendar day, so the server and the browser print the same date.
  const ends = course.discount ? formatDate(isoToTashkentLocal(course.discount.endsAt).slice(0, 10), lang) : ''
  return (
    <article className="discount-card group flex w-[272px] shrink-0 flex-col overflow-hidden rounded-card border border-champagne/50 bg-paper shadow-soft transition duration-300 hover:-translate-y-1 hover:shadow-lift sm:w-[300px]">
      <Link to={`/courses/${course.id}`} className="relative block aspect-[16/9] overflow-hidden bg-sage/20" tabIndex={-1} aria-hidden="true">
        <img src={getCoursePhotoUrl(course)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.05]" />
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-charcoal/55 via-transparent to-transparent" />
        <span className="discount-glow absolute left-3 top-3 rounded-full bg-champagne px-3 py-1 font-display text-lg font-semibold leading-none text-forest">−{percent}%</span>
      </Link>
      <div className="flex flex-1 flex-col p-4">
        <div className="truncate text-[11px] font-medium uppercase tracking-wider text-charcoal/50">{[tr(category?.name), center?.name].filter(Boolean).join(' · ')}</div>
        <Link to={`/courses/${course.id}`} className="mt-1 line-clamp-2 font-display text-xl leading-snug text-charcoal hover:text-forest">
          {copy ? tr(course.title) : <>{tr(course.title)}<span className="sr-only">, −{percent}%</span></>}
        </Link>
        <div className="mt-3 flex flex-wrap items-baseline gap-x-2">
          <span className="text-sm text-charcoal/45 line-through"><span className="sr-only">{t('discount.was')}: </span>{formatSom(course.price, lang, false)}</span>
          <span className="font-display text-2xl font-semibold text-forest">{formatSom(price, lang, false)}</span>
          <span className="text-[11px] text-charcoal/55">{t('common.som')} {t('common.perMonth')}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-x-2 text-[11px]">
          <span className="font-semibold text-forest">{t('discounts.save', { price: formatSom(course.price - price, lang) })}</span>
          {ends && <span className="text-charcoal/50">{t('discounts.ends', { date: ends })}</span>}
        </div>
        <div className="mt-auto flex gap-2 pt-4">
          <LinkButton to={`/builder?add=${course.id}`} size="sm" className="flex-1 justify-center"><Icon name="cart" className="h-3.5 w-3.5" />{t('favorites.addToCart')}</LinkButton>
          <LinkButton to={`/courses/${course.id}`} size="sm" variant="secondary">{t('discounts.details')}</LinkButton>
        </div>
      </div>
    </article>
  )
}

/**
 * Homepage showcase of the courses whose discount is active now (carouselCourses). The row scrolls on its own with a CSS
 * transform, a second, inert copy of the cards making the loop seamless. It pauses while hovered or focused, while off
 * screen and with the pause button; with reduced motion it is a still row the visitor scrolls.
 */
export function DiscountShowcase({ courses, title, subtitle }: { courses: Course[]; title: string; subtitle: string }) {
  const { t } = useT()
  const [paused, setPaused] = useState(false)
  const [offscreen, setOffscreen] = useState(false)
  const marquee = useRef<HTMLDivElement>(null)
  const rotating = courses.length >= MIN_ROTATING
  const maxPercent = Math.max(0, ...courses.map((c) => activePercent(c)))

  useEffect(() => {
    const el = marquee.current
    if (!el || !rotating || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([entry]) => setOffscreen(!entry.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [rotating])

  return (
    <section className="relative overflow-hidden py-16 lg:py-24">
      <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-[42rem] -translate-x-1/2 rounded-full bg-champagne/20 blur-3xl" aria-hidden="true" />
      <div className="container-x relative">
        <div className="mb-8 flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <span className="discount-glow relative inline-flex items-center gap-2 rounded-full bg-champagne px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-[0.18em] text-forest">
              <Icon name="star" className="h-3.5 w-3.5" />
              {t('discounts.upTo', { n: maxPercent })}
            </span>
            <h2 className="mt-4 font-display text-4xl leading-tight text-charcoal md:text-5xl">{title}</h2>
            {subtitle && <p className="mt-3 text-[15px] leading-relaxed text-charcoal/65">{subtitle}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {rotating && (
              <button type="button" onClick={() => setPaused((p) => !p)} aria-pressed={paused} className="discount-toggle inline-flex items-center gap-1.5 rounded-full border border-charcoal/15 bg-paper px-3.5 py-2 text-xs font-medium text-charcoal/75 transition hover:border-forest/40 hover:text-forest">
                {paused ? <Icon name="play" className="h-3 w-3" /> : <svg viewBox="0 0 16 16" className="h-3 w-3" aria-hidden="true"><rect x="3" y="2" width="3.5" height="12" rx="1" fill="currentColor" /><rect x="9.5" y="2" width="3.5" height="12" rx="1" fill="currentColor" /></svg>}
                {paused ? t('discounts.play') : t('discounts.pause')}
              </button>
            )}
            <LinkButton to="/courses" variant="secondary">{t('home.viewAllCourses')} <Icon name="arrowRight" className="h-4 w-4" /></LinkButton>
          </div>
        </div>
      </div>
      <div
        ref={marquee}
        role="region"
        aria-label={title}
        className="discount-marquee"
        data-static={rotating ? undefined : 'true'}
        data-paused={paused || offscreen ? 'true' : undefined}
        style={{ '--discount-duration': `${courses.length * 7}s` } as CSSProperties}
      >
        <div className="discount-track">
          {courses.map((c) => <DiscountCard key={c.id} course={c} />)}
          {rotating && (
            <div className="discount-copy" aria-hidden="true" inert>
              {courses.map((c) => <DiscountCard key={`copy-${c.id}`} course={c} copy />)}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
