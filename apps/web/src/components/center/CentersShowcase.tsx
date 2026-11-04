'use client'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { countLabel, NOUNS } from '@ilmora/shared'
import { Link } from '@/lib/router'
import { useT } from '../../i18n/useT'
import { isPublicListed } from '../../lib/access'
import { useStore } from '../../store/useStore'
import type { Center, Course } from '../../types'
import { getCoursePhotoUrl } from '../course/courseImage'
import { ArtCover, Eyebrow, Icon, LinkButton } from '../ui'

/** Fewer centers than this are shown as a still row: a loop of two or three cards looks repetitive. */
const MIN_ROTATING = 4

/** One center: a photo from its courses (or its own cover), district, name, directions, counts, and the way in. */
function CenterCard({ center, courses, seed }: { center: Center; courses: Course[]; seed: number }) {
  const { t, tr, lang } = useT()
  const teachers = useStore((s) => s.teachers.filter((x) => x.centerId === center.id).length)
  const categories = useStore((s) => s.categories)
  const cats = categories.filter((cat) => courses.some((c) => c.categoryId === cat.id)).slice(0, 3)
  const cover = courses.find((c) => c.imageUrl) ?? courses[0]
  const href = `/centers/${center.slug ?? center.id}`
  return (
    <article className="discount-card group flex w-[272px] shrink-0 flex-col overflow-hidden rounded-card border border-charcoal/10 bg-paper shadow-soft transition duration-300 hover:-translate-y-1 hover:shadow-lift sm:w-[300px]">
      <Link to={href} className="relative block aspect-[16/9] overflow-hidden bg-sage/20" tabIndex={-1} aria-hidden="true">
        {cover
          ? <img src={getCoursePhotoUrl(cover)} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-700 ease-out group-hover:scale-[1.05]" />
          : <ArtCover seed={seed} tone={center.tone} className="h-full w-full" />}
        <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-forest/70 via-forest/10 to-transparent" />
        {tr(center.district) && <span className="absolute left-3 top-3 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-ivory shadow-xs" style={{ background: center.tone }}>{tr(center.district)}</span>}
        <span className="absolute bottom-3 left-3 rounded-full bg-paper/90 px-2.5 py-1 text-[11px] font-semibold text-forest">{countLabel(lang, courses.length, NOUNS.course)}</span>
      </Link>
      <div className="flex flex-1 flex-col p-4">
        <div className="truncate text-[11px] font-medium uppercase tracking-wider text-charcoal/50">{t('common.centers')} · {countLabel(lang, teachers, NOUNS.teacher)}</div>
        <Link to={href} className="mt-1 line-clamp-2 font-display text-xl leading-snug text-charcoal hover:text-forest">{center.name}</Link>
        {cats.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {cats.map((cat) => <span key={cat.id} className="rounded-full border border-charcoal/10 px-2 py-0.5 text-[11px] text-charcoal/65">{cat.glyph} {tr(cat.name)}</span>)}
          </div>
        )}
        {tr(center.description) && <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-charcoal/60">{tr(center.description)}</p>}
        <div className="mt-auto flex gap-2 pt-4">
          <LinkButton to={href} size="sm" className="flex-1 justify-center"><Icon name="building" className="h-3.5 w-3.5" />{t('centers.viewCenter')}</LinkButton>
          <LinkButton to={`/courses?center=${center.id}`} size="sm" variant="secondary">{t('common.courses')}</LinkButton>
        </div>
      </div>
    </article>
  )
}

/**
 * The centers on the home page, as cards like the discounted courses: the row scrolls on its own (a second, inert copy
 * of the cards makes the loop seamless), pauses while hovered, focused or off screen, and is a still row with reduced
 * motion or with fewer than four centers. The shared `discount-*` styles drive the motion.
 */
export function CentersShowcase({ centers, title, subtitle }: { centers: Center[]; title: string; subtitle?: string }) {
  const { t } = useT()
  const courses = useStore((s) => s.courses.filter(isPublicListed))
  const [offscreen, setOffscreen] = useState(false)
  const marquee = useRef<HTMLDivElement>(null)
  const rotating = centers.length >= MIN_ROTATING

  useEffect(() => {
    const el = marquee.current
    if (!el || !rotating || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([entry]) => setOffscreen(!entry.isIntersecting))
    io.observe(el)
    return () => io.disconnect()
  }, [rotating])

  const byCenter = (c: Center) => courses.filter((x) => x.centerId === c.id)
  const cards = (prefix: string) => centers.map((c, i) => <CenterCard key={`${prefix}${c.id}`} center={c} courses={byCenter(c)} seed={i} />)

  return (
    <section className="relative overflow-hidden border-y border-charcoal/10 bg-paper/70 py-16 lg:py-24">
      <div className="pointer-events-none absolute -top-24 right-1/4 h-72 w-[36rem] rounded-full bg-sage/40 blur-3xl" aria-hidden="true" />
      <div className="container-x relative">
        <div className="mb-8 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <Eyebrow>{t('common.centers')} · {centers.length}</Eyebrow>
            <h2 className="mt-3 font-display text-4xl leading-tight text-charcoal md:text-5xl">{title}</h2>
            {subtitle && <p className="mt-3 text-[15px] leading-relaxed text-charcoal/65">{subtitle}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LinkButton to="/centers">{t('center.page.allCenters')} <Icon name="arrowRight" className="h-4 w-4" /></LinkButton>
          </div>
        </div>
      </div>
      <div
        ref={marquee}
        role="region"
        aria-label={title}
        className="discount-marquee"
        data-static={rotating ? undefined : 'true'}
        data-paused={offscreen ? 'true' : undefined}
        style={{ '--discount-duration': `${centers.length * 8}s` } as CSSProperties}
      >
        <div className="discount-track">
          {cards('')}
          {rotating && (
            <div className="discount-copy" aria-hidden="true" inert>
              {cards('copy-')}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
