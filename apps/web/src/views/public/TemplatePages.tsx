import { useState } from 'react'
import { Link } from '@/lib/router'
import { carouselCourses, countLabel, finalPriceSom, isOnlineCourse, MAX_CAROUSEL_COURSES, MAX_CART_COURSES, normalizeUzPhone, NOUNS, ONLINE_PROVIDER_SLUG } from '@ilmora/shared'
import { api, isApiError } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import { useT } from '../../i18n/useT'
import { isPublicListed } from '../../lib/access'
import { formatSom } from '../../lib/format'
import { withBase } from '../../lib/url'
import { useStore, type PageKey } from '../../store/useStore'
import type { Section } from '../../types'
import { CourseCard, CoursePrice, ScheduleChips } from '../../components/course/CourseCard'
import { BackgroundVideo, CountUp, Marquee, SnapTrack, SplitWords } from '../../components/motion'
import dynamic from 'next/dynamic'
import { Avatar, Badge, Button, Card, cx, Eyebrow, Field, Icon, Input, LinkButton, Notice, SectionHeading, Textarea } from '../../components/ui'
import { getTeacherAvatarUrl } from '../../components/teacher/teacherImage'
import { CourseFinderTeaser } from './CourseFinder'
import { DiscountShowcase } from '../../components/course/DiscountShowcase'
import { JourneySection as Journey } from '../../components/JourneySteps'

const Scene3D = dynamic(() => import('../../components/three/Scene3D').then((m) => m.Scene3D), { ssr: false })
const ScrollVideo = dynamic(() => import('../../components/three/ScrollVideo').then((m) => m.ScrollVideo), { ssr: false })

// ─── Page = ordered, admin-configured sections ───────────────────────────────
export function TemplatePage({ page }: { page: PageKey }) {
  const sections = useStore((s) => s.site.pages[page])
  return (
    <div>
      {sections.filter((s) => s.enabled).map((s) => <SectionRenderer key={s.id} section={s} />)}
    </div>
  )
}

export function SectionRenderer({ section }: { section: Section }) {
  switch (section.type) {
    case 'hero': return <Hero />
    case 'marquee': return <MarqueeSection s={section} />
    case 'discounts': return <DiscountsSection s={section} />
    case 'packages': return <Packages s={section} />
    case 'featuredCourses': return <FeaturedCourses s={section} />
    case 'categories': return <Categories s={section} />
    case 'howItWorks':
    case 'steps': return <Steps s={section} />
    case 'studio3d': return <Studio3D s={section} />
    case 'furnitureStory': return <FurnitureStory s={section} />
    case 'teachers': return <TeachersSection s={section} />
    case 'centers': return <CentersSection s={section} />
    case 'faq': return <FaqSection s={section} />
    case 'centerCta': return <CenterCta s={section} />
    case 'announcement': return <AnnouncementSection s={section} />
    case 'richText': return <RichText s={section} />
    case 'inquiryForm': return <InquiryForm s={section} />
    case 'courseFinder': return <CourseFinderTeaser s={section} />
    case 'journey': return <JourneySection s={section} />
    default: return null
  }
}

// ─── Hero: full-bleed muted background film (autoplay/muted/loop/playsinline) under a transparent header ───
// The section is the positioning context (relative + overflow hidden); the film covers it (absolute, object-cover)
// and the brand-green gradient stays as the fallback while it loads or when playback is restricted.
function Hero() {
  const { t, tr } = useT()
  const brand = useStore((s) => s.site.brand)
  const media = useStore((s) => s.site.media)
  const nCenters = useStore((s) => s.centers.filter((c) => c.slug !== ONLINE_PROVIDER_SLUG).length)
  const nCourses = useStore((s) => s.courses.filter(isPublicListed).length)
  const nCats = useStore((s) => s.categories.length)
  return (
    <section className="relative isolate flex min-h-[100svh] flex-col overflow-hidden bg-charcoal text-ivory">
      <BackgroundVideo src={withBase(media.heroVideoUrl)} poster={withBase(media.heroPosterUrl)} pauseLabel={t('home.pauseVideo')} playLabel={t('home.playVideo')} note={t('home.heroVideoNote')} />
      {/* Semi-transparent dark-green overlay over the film so the text and buttons stay readable, then a soft hand-off into the ivory page */}
      <div className="pointer-events-none absolute inset-0" style={{ background: 'rgba(0, 30, 20, 0.6)' }} aria-hidden="true" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-ivory via-ivory/40 to-transparent" aria-hidden="true" />

      <div className="container-x relative flex flex-1 flex-col justify-center pb-28 pt-[calc(68px+4rem)] lg:pt-[calc(68px+5rem)]">
        <div className="rise-seq max-w-3xl">
          <Eyebrow className="mb-6 text-champagne">{tr(brand.heroTagline)}</Eyebrow>
          <h1 className="font-display text-[46px] leading-[1.02] tracking-[-0.01em] text-ivory sm:text-6xl lg:text-[84px]">
            <SplitWords text={tr(brand.heroHeadline)} baseDelay={0.35} step={0.08} />
          </h1>
          <p className="mt-7 max-w-lg text-[15px] leading-relaxed text-ivory/75 md:text-[17px]">{t('home.heroNote')}</p>
          <div className="mt-9 flex flex-wrap gap-3">
            <LinkButton to="/builder" size="lg" variant="champagne">{tr(brand.primaryCta)} <Icon name="arrowRight" className="h-4 w-4" /></LinkButton>
            <LinkButton to="/teachers" size="lg" variant="ghost" className="border-ivory/30 text-ivory hover:bg-ivory/10 hover:text-ivory">{t('home.exploreTeachers')}</LinkButton>
          </div>
          <dl className="mt-14 grid max-w-md grid-cols-3 gap-6 border-t border-ivory/20 pt-6">
            {[[nCenters, t('home.stat.centers')], [nCourses, t('home.stat.courses')], [nCats, t('home.stat.categories')]].map(([n, label]) => (
              <div key={String(label)}>
                <dt className="font-display text-3xl text-ivory"><CountUp value={Number(n)} /></dt>
                <dd className="mt-0.5 text-[11px] uppercase tracking-[0.16em] text-ivory/55">{label}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-6 left-5 flex items-center text-ivory/55 sm:left-8 lg:left-12" aria-hidden="true">
        <span className="scroll-cue"><Icon name="down" className="h-3.5 w-3.5" /></span>
      </div>
    </section>
  )
}

// ─── Discount carousel: published public courses whose discount is active now (they also stay in the catalog) ───
function DiscountsSection({ s }: { s: Section }) {
  const { t, tr } = useT()
  const courses = useStore((st) => st.courses)
  const list = carouselCourses(courses, new Date(), s.count ?? MAX_CAROUSEL_COURSES)
  if (list.length === 0) return null
  return <DiscountShowcase courses={list} title={tr(s.title) || t('discounts.title')} subtitle={tr(s.subtitle) || t('discounts.subtitle')} />
}

// ─── How ILMORA works: five-step journey (admin title/subtitle when set, else the dictionary texts) ───
function JourneySection({ s }: { s: Section }) {
  const { tr } = useT()
  return <Journey title={tr(s.title)} subtitle={tr(s.subtitle)} />
}

// ─── Marquee ticker of sample centers & categories ───────────────────────────
function MarqueeSection({ s }: { s: Section }) {
  const { tr } = useT()
  const centers = useStore((st) => st.centers.filter((c) => c.slug !== ONLINE_PROVIDER_SLUG))
  const categories = useStore((st) => st.categories)
  const items = [
    ...centers.map((c) => <span key={c.id} className="font-display text-2xl text-charcoal/80">{c.name}</span>),
    ...categories.map((c) => <span key={c.id} className="text-[12px] font-medium uppercase tracking-[0.2em] text-forest/70">{tr(c.name)}</span>),
  ]
  return (
    <section className="border-y border-charcoal/10 bg-paper/70 py-5">
      {tr(s.title) && <div className="container-x mb-3 text-center text-[10px] uppercase tracking-[0.24em] text-charcoal/40">{tr(s.title)}</div>}
      <Marquee items={items} label={tr(s.title)} />
    </section>
  )
}

// ─── Packages: Flex, Winx (database packages) and Build Your Own (no package) ─
function Packages({ s }: { s: Section }) {
  const { t, tr, lang } = useT()
  const packages = useStore((st) => st.site.packages)
  const courses = useStore((st) => st.courses.filter(isPublicListed))
  // Only offline courses go into a subscription; free online courses would make every "from" price 0.
  const cheapest = courses.filter((c) => !isOnlineCourse(c)).sort((a, b) => finalPriceSom(a) - finalPriceSom(b))

  return (
    <section className="relative overflow-hidden bg-sage/40 py-20 lg:py-28">
      <div className="float-a pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full border border-champagne/30" aria-hidden="true" />
      <div className="float-b pointer-events-none absolute -right-16 bottom-6 h-56 w-56 rounded-full border border-forest/15" aria-hidden="true" />
      <div className="container-x relative">
        <SectionHeading title={tr(s.title)} subtitle={tr(s.subtitle)} />
        <div className="reveal-stagger grid gap-8 md:grid-cols-2 lg:mx-auto lg:max-w-6xl lg:grid-cols-3 pt-3.5">
          {packages.filter((p) => p.enabled).map((p) => {
            const from = cheapest.slice(0, p.maxCourses).reduce((n, c) => n + finalPriceSom(c), 0)
            const isTrio = p.maxCourses >= 3
            return (
              <div key={p.id} className="reveal reveal-scale">
                <Card className={cx(
                  'relative flex h-full flex-col p-8 md:p-10 transition duration-500 hover:-translate-y-1.5 hover:shadow-lift',
                  p.highlight
                    ? 'border-champagne/80 shadow-lift ring-2 ring-champagne/50 bg-gradient-to-b from-paper via-paper to-champagne/5 glow-champagne'
                    : 'border-charcoal/10 bg-paper hover:border-forest/30'
                )}>
                  {p.highlight && (
                    <span className="shimmer-pill absolute -top-3.5 right-6 sm:right-8 z-10 inline-flex items-center gap-1 rounded-full bg-champagne text-charcoal px-3.5 py-1 text-[11px] font-bold uppercase tracking-wider shadow-sm border border-champagne/60">
                      <Icon name="star" className="h-3 w-3 fill-current text-charcoal/80" />
                      {t('common.featured')}
                    </span>
                  )}
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-display text-5xl text-charcoal">{tr(p.name)}</span>
                    <span className={cx(
                      'rounded-full px-2.5 py-0.5 text-xs font-semibold shrink-0',
                      isTrio ? 'bg-champagne/30 text-charcoal' : 'bg-forest/10 text-forest'
                    )}>
                      {p.maxCourses} {tr({ uz: 'kurs', ru: 'курса', en: 'courses' })}
                    </span>
                  </div>
                  <div className="mt-1 text-sm text-charcoal/60">{t('builder.simultaneous', { n: p.maxCourses })}</div>

                  {/* Course Slot Architecture Preview */}
                  <div className="mt-5 rounded-control border border-charcoal/10 bg-ivory/60 p-3.5 shadow-inner">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-charcoal/50 mb-2.5 flex items-center justify-between">
                      <span>{tr({ uz: 'Abonement tarkibi', ru: 'Состав абонемента', en: 'Subscription composition' })}</span>
                      <span className="text-[10px] text-forest font-medium">{tr({ uz: '✓ 0% to‘qnashuv', ru: '✓ 0% конфликтов', en: '✓ 0% conflicts' })}</span>
                    </div>
                    <div className="grid gap-2">
                      {Array.from({ length: p.maxCourses }).map((_, slotIdx) => (
                        <div key={slotIdx} className="flex items-center gap-2.5 rounded-control bg-paper px-3 py-2 text-xs text-charcoal/80 border border-charcoal/8 shadow-xs">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-forest text-[11px] font-bold text-ivory">{slotIdx + 1}</span>
                          <span className="font-medium truncate">
                            {slotIdx === 0 && tr({ uz: '1-kurs: Tillar / IELTS (istalgan markaz)', ru: 'Курс 1: Языки / IELTS (любой центр)', en: 'Course 1: Languages / IELTS (any center)' })}
                            {slotIdx === 1 && tr({ uz: '2-kurs: Kasb / Dizayn / Bazis', ru: 'Курс 2: Профессия / Дизайн / Bazis', en: 'Course 2: Career / Design / Bazis' })}
                            {slotIdx === 2 && tr({ uz: '3-kurs: IT / Aniq fanlar / Dasturlash', ru: 'Курс 3: IT / Точные науки / Код', en: 'Course 3: IT / Exact sciences / Code' })}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <p className="mt-5 text-[15px] leading-relaxed text-charcoal/70">{tr(p.description)}</p>
                  <ul className="mt-6 space-y-2.5 text-sm text-charcoal/75">
                    {p.perks.map((perk, i) => (
                      <li key={i} className="flex gap-2.5">
                        <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-forest" />
                        {tr(perk)}
                      </li>
                    ))}
                  </ul>
                  <div className="mt-8 flex items-end justify-between gap-4 border-t border-charcoal/10 pt-6">
                    <div>
                      <div className="font-display text-2xl text-charcoal">
                        {t('home.priceFrom', { price: formatSom(from, lang) })}
                        <span className="ml-1 text-xs text-charcoal/50">{t('common.perMonth')}</span>
                      </div>
                    </div>
                    <LinkButton to={`/builder?package=${p.id}`} variant={p.highlight ? 'primary' : 'secondary'}>
                      {t('common.select')} <Icon name="arrowRight" className="h-4 w-4" />
                    </LinkButton>
                  </div>
                </Card>
              </div>
            )
          })}
          {/* Build Your Own: the existing custom selection (no package), 1 to MAX_CART_COURSES courses. */}
          <div className="reveal reveal-scale">
            <Card className="relative flex h-full flex-col border-dashed border-forest/30 bg-paper p-8 transition duration-500 hover:-translate-y-1.5 hover:border-forest/50 hover:shadow-lift md:p-10">
              <div className="flex flex-wrap items-center gap-3">
                <span className="font-display text-4xl leading-tight text-charcoal">{t('builder.custom')}</span>
                <span className="shrink-0 rounded-full bg-sage px-2.5 py-0.5 text-xs font-semibold text-forest">{t('packages.byoRange', { n: MAX_CART_COURSES })}</span>
              </div>
              <div className="mt-5 rounded-control border border-dashed border-charcoal/15 bg-ivory/60 p-3.5">
                <div className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-charcoal/50">{t('packages.byoComposition')}</div>
                <div className="grid gap-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-2.5 rounded-control border border-dashed border-forest/25 bg-paper px-3 py-2 text-xs text-charcoal/60">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full border border-forest/40 text-forest"><Icon name="plus" className="h-3 w-3" /></span>
                      <span className="truncate font-medium">{t('packages.byoSlot')}</span>
                    </div>
                  ))}
                </div>
              </div>
              <p className="mt-5 text-[15px] leading-relaxed text-charcoal/70">{t('builder.customHint', { n: MAX_CART_COURSES })}</p>
              <ul className="mt-6 space-y-2.5 text-sm text-charcoal/75">
                {(['packages.byoPerk1', 'packages.byoPerk2', 'packages.byoPerk3'] as const).map((k) => (
                  <li key={k} className="flex gap-2.5"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-forest" />{t(k, { n: MAX_CART_COURSES })}</li>
                ))}
              </ul>
              <div className="mt-8 flex items-end justify-between gap-4 border-t border-charcoal/10 pt-6">
                {cheapest[0] && (
                  <div className="font-display text-2xl text-charcoal">
                    {t('home.priceFrom', { price: formatSom(finalPriceSom(cheapest[0]), lang) })}
                    <span className="ml-1 text-xs text-charcoal/50">{t('common.perMonth')}</span>
                  </div>
                )}
                <LinkButton to="/builder?package=custom" variant="secondary">
                  {t('common.select')} <Icon name="arrowRight" className="h-4 w-4" />
                </LinkButton>
              </div>
            </Card>
          </div>
        </div>
        <p className="reveal mt-8 text-center text-xs text-charcoal/50">{t('builder.transparent')}</p>
      </div>
    </section>
  )
}

// ─── Featured courses ────────────────────────────────────────────────────────
function FeaturedCourses({ s }: { s: Section }) {
  const { t, tr } = useT()
  const courses = useStore((st) => st.courses.filter(isPublicListed))
  const list = [...courses].sort((a, b) => Number(b.featured) - Number(a.featured)).slice(0, s.count ?? 4)
  return (
    <section className="py-20 lg:py-28">
      <div className="container-x">
        <SectionHeading eyebrow={t('common.courses')} title={tr(s.title)} subtitle={tr(s.subtitle)} action={<LinkButton to="/courses" variant="secondary">{t('home.viewAllCourses')} <Icon name="arrowRight" className="h-4 w-4" /></LinkButton>} />
        <div className="reveal-stagger grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {list.map((c) => <div key={c.id} className="reveal"><CourseCard course={c} /></div>)}
        </div>
      </div>
    </section>
  )
}

// ─── Categories ──────────────────────────────────────────────────────────────
function Categories({ s }: { s: Section }) {
  const { tr } = useT()
  const categories = useStore((st) => st.categories)
  const courses = useStore((st) => st.courses.filter(isPublicListed))
  return (
    <section className="py-20 lg:py-28">
      <div className="container-x">
        <SectionHeading title={tr(s.title)} subtitle={tr(s.subtitle)} />
        <div className="reveal-stagger grid grid-cols-2 gap-3 md:grid-cols-4">
          {categories.map((c) => {
            const n = courses.filter((x) => x.categoryId === c.id).length
            return (
              <Link key={c.id} to={`/courses?cat=${c.id}`} className="reveal card group flex flex-col justify-between p-5 transition duration-500 hover:-translate-y-1.5 hover:shadow-lift md:min-h-[150px] border border-charcoal/10">
                <span className="font-display text-3xl text-champagne transition duration-500 group-hover:-translate-y-1 group-hover:scale-110 group-hover:text-forest inline-block">{c.glyph}</span>
                <span>
                  <span className="block font-medium text-charcoal group-hover:text-forest transition-colors">{tr(c.name)}</span>
                  <span className="block text-xs text-charcoal/50">{n} · {tr({ uz: 'kurs', ru: 'курсов', en: 'courses' })}</span>
                </span>
              </Link>
            )
          })}
        </div>
      </div>
    </section>
  )
}

// ─── Steps / how it works ────────────────────────────────────────────────────
function Steps({ s }: { s: Section }) {
  const { tr } = useT()
  return (
    <section className="py-20 lg:py-28 bg-paper">
      <div className="container-x">
        <SectionHeading title={tr(s.title)} subtitle={tr(s.subtitle)} align="center" />
        <ol className="reveal-stagger mt-12 grid gap-6 md:grid-cols-3 relative">
          {(s.items ?? []).map((it, i) => (
            <li
              key={it.id}
              className="reveal card group relative p-8 transition duration-500 hover:-translate-y-1.5 hover:shadow-lift border border-charcoal/10 hover:border-forest/30"
            >
              <div className="flex items-center justify-between">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-sage/70 font-display text-2xl text-forest shadow-xs transition duration-300 group-hover:bg-forest group-hover:text-ivory">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <span className="text-[11px] font-semibold uppercase tracking-widest text-champagne">
                  {i === 0 && tr({ uz: '1-qadam', ru: 'Шаг 1', en: 'Step 1' })}
                  {i === 1 && tr({ uz: '2-qadam', ru: 'Шаг 2', en: 'Step 2' })}
                  {i === 2 && tr({ uz: '3-qadam', ru: 'Шаг 3', en: 'Step 3' })}
                </span>
              </div>
              <h3 className="mt-6 font-display text-2xl text-charcoal group-hover:text-forest transition-colors duration-300">{tr(it.title)}</h3>
              <p className="mt-3 text-sm leading-relaxed text-charcoal/65">{tr(it.body)}</p>
              {i < 2 && (
                <div className="hidden md:block absolute -right-3 top-1/2 -translate-y-1/2 z-10 text-champagne/70 group-hover:text-forest group-hover:translate-x-1 transition-all">
                  <Icon name="arrowRight" className="h-5 w-5" />
                </div>
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

// ─── Bazis course spotlight: 3D loop + course facts + direct CTA ─────────────
function Studio3D({ s }: { s: Section }) {
  const { t, tr } = useT()
  const courses = useStore((st) => st.courses)
  const teachers = useStore((st) => st.teachers)
  const centers = useStore((st) => st.centers)
  const categories = useStore((st) => st.categories)
  const course = courses.find((c) => c.id === 'c-bazis' && isPublicListed(c)) ?? courses.find((c) => c.categoryId === 'cat-furniture' && isPublicListed(c))
  if (!course) return null
  const teacher = teachers.find((x) => x.id === course.teacherId)
  const center = centers.find((x) => x.id === course.centerId)
  const category = categories.find((x) => x.id === course.categoryId)
  const group = course.groups[0]
  return (
    <section className="py-20 lg:py-28">
      <div className="container-x grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
        <div className="reveal reveal-left relative">
          <Scene3D kind="assembly" className="aspect-[5/4] w-full" caption={t('home.assemblyCaption')} />
          <div className="pointer-events-none absolute left-5 top-5 flex flex-wrap gap-2">
            <Badge tone="forest">{tr(course.title)}</Badge>
            {category && <Badge tone="champagne">{tr(category.name)}</Badge>}
          </div>
          <Link to={`/courses/${course.id}`} className="absolute bottom-12 right-5 flex items-center gap-4 rounded-control border border-charcoal/10 bg-paper/90 px-4 py-3 shadow-soft backdrop-blur transition hover:shadow-lift sm:bottom-5">
            <div><div className="eyebrow">{t('courses.monthlyPrice')}</div><CoursePrice course={course} /></div>
            {group && <div className="hidden border-l border-charcoal/10 pl-4 sm:block"><div className="eyebrow">{t('common.schedule')}</div><div className="mt-1"><ScheduleChips group={group} compact /></div></div>}
          </Link>
        </div>
        <div className="reveal reveal-right">
          <Eyebrow className="mb-4">{tr(s.title) || tr(course.title)}</Eyebrow>
          <h2 className="font-display text-4xl leading-tight text-charcoal md:text-5xl">{tr(course.title)} <span className="text-charcoal/35">·</span> {tr(category?.name)}</h2>
          <p className="mt-5 text-[15px] leading-relaxed text-charcoal/65 md:text-base">{tr(s.subtitle) || tr(course.summary)}</p>
          <ol className="mt-6 grid gap-2 sm:grid-cols-2">
            {course.curriculum.slice(0, 6).map((item, i) => (
              <li key={i} className="flex gap-3 rounded-control border border-charcoal/10 bg-paper px-3.5 py-2.5 text-sm text-charcoal/80"><span className="font-display text-lg leading-none text-champagne">{String(i + 1).padStart(2, '0')}</span>{tr(item)}</li>
            ))}
          </ol>
          {teacher && (
            <div className="mt-6 flex items-center gap-3">
              <Avatar name={teacher.name} seed={teacher.avatarSeed} size={40} url={getTeacherAvatarUrl(teacher)} />
              <div className="text-sm"><div className="font-medium text-charcoal">{teacher.name}</div><div className="text-xs text-charcoal/55">{tr(teacher.title)}{center && <> · {center.name}, {tr(center.district)}</>}</div></div>
            </div>
          )}
          <div className="mt-8 flex flex-wrap gap-3">
            <LinkButton to={`/courses/${course.id}`} size="lg">{t('home.goToBazis')} <Icon name="arrowRight" className="h-4 w-4" /></LinkButton>
            <LinkButton to="/courses?cat=cat-furniture" size="lg" variant="secondary">{t('home.allFurniture')}</LinkButton>
          </div>
        </div>
      </div>
    </section>
  )
}

// ─── Furniture story: scroll video + Bazis ───────────────────────────────────
function FurnitureStory({ s }: { s: Section }) {
  const { t, tr } = useT()
  const media = useStore((st) => st.site.media)
  const scrollOn = useStore((st) => st.site.features.scrollVideo)
  const bazis = useStore((st) => st.courses.find((c) => c.id === 'c-bazis' && isPublicListed(c)))
  const copy = (
    <>
      <Eyebrow className="mb-4 text-champagne">{tr({ uz: 'Mebelsozlik va dizayn', ru: 'Мебельное дело и дизайн', en: 'Furniture making & design' })}</Eyebrow>
      <h2 className="font-display text-4xl leading-[1.05] text-ivory md:text-6xl">{tr(s.title)}</h2>
      <p className="mt-5 max-w-md text-[15px] leading-relaxed text-ivory/75 md:text-base">{tr(s.subtitle)}</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <LinkButton to={bazis ? `/courses/${bazis.id}` : '/courses?cat=cat-furniture'} variant="champagne" size="lg">{t('home.chooseBazis')} <Icon name="arrowRight" className="h-4 w-4" /></LinkButton>
        <LinkButton to="/courses?cat=cat-design" variant="ghost" size="lg" className="text-ivory hover:bg-ivory/10 hover:text-ivory">{tr({ uz: 'Dizayn kurslari', ru: 'Курсы дизайна', en: 'Design courses' })}</LinkButton>
      </div>
    </>
  )
  if (!scrollOn) {
    return (
      <section className="bg-charcoal py-20 lg:py-28">
        <div className="container-x grid items-center gap-12 lg:grid-cols-2">
          <div className="reveal reveal-left">{copy}</div>
          <div className="reveal reveal-right"><Scene3D kind="assembly" className="aspect-[5/4] w-full" caption={t('home.assemblyCaption')} /></div>
        </div>
      </section>
    )
  }
  const stages = (bazis?.curriculum ?? []).slice(0, 6).map(tr)
  return <ScrollVideo src={withBase(media.furnitureVideoUrl)} poster={withBase(media.furniturePosterUrl)} stages={stages}><div className="reveal reveal-left">{copy}</div></ScrollVideo>
}

// ─── Teachers: horizontal snap track ─────────────────────────────────────────
function TeachersSection({ s }: { s: Section }) {
  const { t, tr } = useT()
  const enabled = useStore((st) => st.site.features.teacherChannels)
  const teachers = useStore((st) => st.teachers.filter((x) => x.channelActive))
  const centers = useStore((st) => st.centers)
  if (!enabled) return null
  return (
    <section className="bg-sage/40 py-20 lg:py-28">
      <div className="container-x">
        <SectionHeading eyebrow={t('common.teachers')} title={tr(s.title)} subtitle={tr(s.subtitle)} action={<LinkButton to="/teachers" variant="secondary">{t('home.viewAllTeachers')} <Icon name="arrowRight" className="h-4 w-4" /></LinkButton>} />
        <SnapTrack prevLabel={t('home.prev')} nextLabel={t('home.next')} className="reveal-stagger">
          {teachers.map((te) => (
            <Link key={te.id} to={`/teachers/${te.id}`} className="reveal card group w-[260px] overflow-hidden p-0 transition duration-500 hover:-translate-y-1 hover:shadow-lift sm:w-[280px]">
              <div className="h-24 transition duration-700 group-hover:brightness-110" style={{ background: te.bannerUpload?.previewUrl ? `url(${te.bannerUpload.previewUrl}) center/cover` : te.bannerUrl ? `url(${te.bannerUrl}) center/cover` : `linear-gradient(120deg, ${te.bannerTone}, ${te.bannerTone}cc 60%, #C8AD7F55)` }} />
              <div className="-mt-8 px-5 pb-5">
                <Avatar name={te.name} seed={te.avatarSeed} size={60} url={getTeacherAvatarUrl(te)} alt={te.name} className="ring-4 ring-paper" />
                <div className="mt-3 font-display text-2xl text-charcoal group-hover:text-forest">{te.name}</div>
                <div className="text-xs text-charcoal/55">{tr(te.title)}</div>
                <div className="mt-3 text-[11px] text-charcoal/45">{centers.find((c) => c.id === te.centerId)?.name}</div>
              </div>
            </Link>
          ))}
        </SnapTrack>
      </div>
    </section>
  )
}

// ─── Centers list ────────────────────────────────────────────────────────────
function CentersSection({ s }: { s: Section }) {
  const { tr, lang } = useT()
  const centers = useStore((st) => st.centers.filter((c) => c.slug !== ONLINE_PROVIDER_SLUG))
  const courses = useStore((st) => st.courses.filter(isPublicListed))
  return (
    <section className="py-16 lg:py-24">
      <div className="container-x">
        <SectionHeading title={tr(s.title)} subtitle={tr(s.subtitle)} />
        <div className="reveal-stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {centers.map((c) => (
            <div key={c.id} className="reveal">
              <Card className="flex h-full gap-4">
                <span className="mt-1 h-10 w-1 shrink-0 rounded-full" style={{ background: c.tone }} />
                <div>
                  <div className="font-display text-xl text-charcoal">{c.name}</div>
                  <div className="text-xs text-charcoal/55">{tr(c.district)} · {countLabel(lang, courses.filter((x) => x.centerId === c.id).length, NOUNS.course)}</div>
                  <p className="mt-2 text-sm text-charcoal/65">{tr(c.description)}</p>
                </div>
              </Card>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── FAQ ─────────────────────────────────────────────────────────────────────
export function FaqList({ count }: { count?: number }) {
  const { tr } = useT()
  const faq = useStore((st) => st.site.faq)
  const [open, setOpen] = useState<string | null>(faq[0]?.id ?? null)
  return (
    <div className="reveal-stagger divide-y divide-charcoal/10 border-y border-charcoal/10">
      {faq.slice(0, count ?? faq.length).map((f) => (
        <div key={f.id} className="reveal">
          <button type="button" aria-expanded={open === f.id} onClick={() => setOpen(open === f.id ? null : f.id)} className="flex w-full items-center justify-between gap-4 py-5 text-left">
            <span className="font-display text-xl text-charcoal md:text-2xl">{tr(f.q)}</span>
            <Icon name="down" className={cx('h-4 w-4 shrink-0 text-charcoal/50 transition-transform duration-300', open === f.id && 'rotate-180')} />
          </button>
          {open === f.id && <p className="animate-rise pb-6 text-[15px] leading-relaxed text-charcoal/65">{tr(f.a)}</p>}
        </div>
      ))}
    </div>
  )
}

function FaqSection({ s }: { s: Section }) {
  const { t, tr } = useT()
  const enabled = useStore((st) => st.site.features.faq)
  if (!enabled) return null
  return (
    <section className="py-20 lg:py-28">
      <div className="container-x grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="reveal reveal-left">
          <Eyebrow className="mb-3">{t('feature.faq')}</Eyebrow>
          <h2 className="font-display text-4xl text-charcoal md:text-5xl">{tr(s.title) || t('faq.title')}</h2>
          {tr(s.subtitle) && <p className="mt-4 text-charcoal/65">{tr(s.subtitle)}</p>}
          <Link to="/faq" className="arrow-nudge mt-6 inline-flex items-center gap-1 text-sm font-medium text-forest">{t('common.all')} <Icon name="arrowRight" className="h-4 w-4" /></Link>
        </div>
        <FaqList count={s.count} />
      </div>
    </section>
  )
}

// ─── Center CTA ──────────────────────────────────────────────────────────────
function CenterCta({ s }: { s: Section }) {
  const { tr } = useT()
  const enabled = useStore((st) => st.site.features.centerInquiry)
  if (!enabled) return null
  return (
    <section className="container-x pb-24">
      <div className="reveal reveal-scale relative overflow-hidden rounded-card bg-forest px-8 py-14 text-ivory md:px-16 md:py-20">
        <div className="float-a pointer-events-none absolute -right-20 -top-20 h-72 w-72 rounded-full border border-champagne/30" aria-hidden="true" />
        <div className="float-b pointer-events-none absolute -right-8 top-10 h-72 w-72 rounded-full border border-champagne/20" aria-hidden="true" />
        <div className="relative max-w-xl">
          <h2 className="font-display text-4xl leading-tight md:text-5xl">{tr(s.title)}</h2>
          <p className="mt-4 text-ivory/70">{tr(s.subtitle)}</p>
          <LinkButton to="/centers" variant="champagne" size="lg" className="mt-8">{tr({ uz: 'So‘rov qoldirish', ru: 'Оставить запрос', en: 'Leave an inquiry' })} <Icon name="arrowRight" className="h-4 w-4" /></LinkButton>
        </div>
      </div>
    </section>
  )
}

// ─── Announcements ───────────────────────────────────────────────────────────
function AnnouncementSection({ s }: { s: Section }) {
  const { tr } = useT()
  const enabled = useStore((st) => st.site.features.announcements)
  const items = useStore((st) => st.site.announcements.filter((a) => a.enabled && a.audience === 'all'))
  if (!enabled || !items.length) return null
  return (
    <section className="container-x py-10">
      {tr(s.title) && <Eyebrow className="mb-3">{tr(s.title)}</Eyebrow>}
      <div className="reveal-stagger grid gap-3 md:grid-cols-2">
        {items.map((a) => (
          <div key={a.id} className="reveal"><Notice tone="info"><span className="font-medium">{tr(a.title)}</span> — {tr(a.body)}</Notice></div>
        ))}
      </div>
    </section>
  )
}

// ─── Rich text ───────────────────────────────────────────────────────────────
function RichText({ s }: { s: Section }) {
  const { tr } = useT()
  return (
    <section className="container-x pb-8 pt-16 lg:pt-24">
      <div className="reveal max-w-3xl">
        <h1 className="font-display text-5xl leading-[1.05] text-charcoal md:text-6xl">{tr(s.title)}</h1>
        {tr(s.subtitle) && <p className="mt-5 text-lg text-charcoal/70">{tr(s.subtitle)}</p>}
        {tr(s.body) && <p className="mt-5 text-[15px] leading-relaxed text-charcoal/65">{tr(s.body)}</p>}
      </div>
    </section>
  )
}

// ─── Inquiry form — sent to POST /public/inquiries (stored with the consent timestamp) ──────
function InquiryForm({ s }: { s: Section }) {
  const { t, tr, lang } = useT()
  const enabled = useStore((st) => st.site.features.centerInquiry)
  const [sent, setSent] = useState(false)
  const [form, setForm] = useState({
    centerName: '',
    district: '',
    contactName: '',
    phone: '',
    telegram: '',
    courses: '',
    message: '',
  })
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!enabled) {
    return (
      <section className="container-x pb-24">
        <Notice tone="warn">{t('centers.formDisabled')}</Notice>
      </section>
    )
  }

  const phoneParsed = normalizeUzPhone(form.phone)
  const isCenterValid = form.centerName.trim().length >= 2
  const isContactValid = form.contactName.trim().length >= 2
  const isPhoneValid = phoneParsed.ok
  const isValid = isCenterValid && isContactValid && isPhoneValid

  const submit = async () => {
    if (busy) return
    setTouched({ centerName: true, contactName: true, phone: true })
    if (!isValid) return

    setBusy(true)
    setError(null)

    try {
      const res = await api<{ id: string; receivedAt: string }>('/public/inquiries', {
        method: 'POST',
        body: {
          centerName: form.centerName.trim(),
          district: form.district.trim() || undefined,
          contactName: form.contactName.trim(),
          phone: phoneParsed.e164,
          telegram: form.telegram.trim() || undefined,
          courses: form.courses.trim() || undefined,
          message: form.message.trim() || undefined,
          consent: true,
        },
        auth: false,
      })

      if (res && res.id) {
        setSent(true)
      } else {
        throw new Error('Server did not return a valid confirmation')
      }
    } catch (err) {
      if (isApiError(err)) {
        if (err.code === 'invalid_phone') {
          setError(t('centers.form.invalidPhone'))
        } else if (err.code === 'rate_limited' || err.status === 429) {
          setError(t('centers.form.rateLimited'))
        } else if (err.code === 'consent_required') {
          setError(t('auth.consent.required'))
        } else if (err.status >= 500) {
          setError(t('centers.form.serverError'))
        } else if (err.code === 'validation_failed' && Array.isArray(err.details) && err.details.length) {
          setError(lang === 'en' ? String(err.details[0]) : t('apiError.validation'))
        } else if (err.message && err.message !== 'Internal Server Error' && err.message !== 'Validation failed') {
          setError(apiErrorText(err, lang))
        } else {
          setError(t('centers.form.error'))
        }
      } else {
        setError(t('centers.form.error'))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="container-x pb-24">
      <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="reveal reveal-left">
          <h2 className="font-display text-4xl text-charcoal">{tr(s.title)}</h2>
          <p className="mt-3 text-charcoal/65">{tr(s.subtitle)}</p>
          <p className="mt-4 text-xs text-charcoal/45">{t('centers.form.privacy')}</p>
        </div>
        <div className="reveal reveal-right">
          <Card className="p-7 md:p-8">
            {sent ? (
              <div className="py-6 text-center">
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-sage text-forest">
                  <Icon name="check" className="h-6 w-6" />
                </div>
                <p className="text-charcoal/75">{t('centers.form.success')}</p>
                <Button
                  variant="secondary"
                  className="mt-6"
                  onClick={() => {
                    setSent(false)
                    setTouched({})
                    setError(null)
                    setForm({
                      centerName: '',
                      district: '',
                      contactName: '',
                      phone: '',
                      telegram: '',
                      courses: '',
                      message: '',
                    })
                  }}
                >
                  {t('centers.form.another')}
                </Button>
              </div>
            ) : (
              <form
                className="grid gap-4 sm:grid-cols-2"
                noValidate
                onSubmit={(e) => {
                  e.preventDefault()
                  void submit()
                }}
              >
                <Field
                  label={t('centers.form.center')}
                  required
                  hint={touched.centerName && !isCenterValid ? <span className="text-garnet">{t('centers.form.required')}</span> : undefined}
                >
                  <Input
                    required
                    disabled={busy}
                    value={form.centerName}
                    onBlur={() => setTouched((p) => ({ ...p, centerName: true }))}
                    onChange={(e) => setForm({ ...form, centerName: e.target.value })}
                  />
                </Field>
                <Field label={t('centers.form.district')}>
                  <Input
                    disabled={busy}
                    value={form.district}
                    onChange={(e) => setForm({ ...form, district: e.target.value })}
                  />
                </Field>
                <Field
                  label={t('centers.form.contact')}
                  required
                  hint={touched.contactName && !isContactValid ? <span className="text-garnet">{t('centers.form.required')}</span> : undefined}
                >
                  <Input
                    required
                    disabled={busy}
                    autoComplete="name"
                    value={form.contactName}
                    onBlur={() => setTouched((p) => ({ ...p, contactName: true }))}
                    onChange={(e) => setForm({ ...form, contactName: e.target.value })}
                  />
                </Field>
                <Field
                  label={t('centers.form.phone')}
                  required
                  hint={touched.phone && !isPhoneValid ? <span className="text-garnet">{t('centers.form.invalidPhone')}</span> : undefined}
                >
                  <Input
                    required
                    disabled={busy}
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="+998 90 123 45 67"
                    value={form.phone}
                    onBlur={() => setTouched((p) => ({ ...p, phone: true }))}
                    onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  />
                </Field>
                <Field label={t('centers.form.telegram')}>
                  <Input
                    disabled={busy}
                    placeholder="@username"
                    value={form.telegram}
                    onChange={(e) => setForm({ ...form, telegram: e.target.value })}
                  />
                </Field>
                <Field label={t('centers.form.courses')}>
                  <Input
                    disabled={busy}
                    value={form.courses}
                    onChange={(e) => setForm({ ...form, courses: e.target.value })}
                  />
                </Field>
                <Field label={t('centers.form.message')} className="sm:col-span-2">
                  <Textarea
                    disabled={busy}
                    value={form.message}
                    onChange={(e) => setForm({ ...form, message: e.target.value })}
                  />
                </Field>
                {error && (
                  <div className="sm:col-span-2" role="alert">
                    <Notice tone="warn">{error}</Notice>
                  </div>
                )}
                <div className="sm:col-span-2 flex items-center justify-between gap-4">
                  <span className="text-xs text-charcoal/45">{t('centers.form.privacy')}</span>
                  <Button type="submit" disabled={busy}>
                    {busy ? <Icon name="refresh" className="h-4 w-4 animate-spin" /> : null}
                    {t('centers.form.submit')}
                  </Button>
                </div>
              </form>
            )}
          </Card>
        </div>
      </div>
    </section>
  )
}
