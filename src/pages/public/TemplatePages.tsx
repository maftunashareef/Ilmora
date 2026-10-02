import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useT } from '../../i18n/useT'
import { isPublicListed } from '../../lib/access'
import { formatSom } from '../../lib/format'
import { withBase } from '../../lib/url'
import { useStore, type PageKey } from '../../store/useStore'
import type { Section } from '../../types'
import { CourseCard, PriceTag, ScheduleChips } from '../../components/course/CourseCard'
import { BackgroundVideo, CountUp, Marquee, SnapTrack, SplitWords } from '../../components/motion'
import { Scene3D } from '../../components/three/Scene3D'
import { ScrollVideo } from '../../components/three/ScrollVideo'
import { Avatar, Badge, Button, Card, cx, Eyebrow, Field, Icon, Input, LinkButton, Notice, SectionHeading, Textarea } from '../../components/ui'

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
    default: return null
  }
}

// ─── Hero: full-bleed muted film under a transparent header ──────────────────
function Hero() {
  const { t, tr } = useT()
  const brand = useStore((s) => s.site.brand)
  const media = useStore((s) => s.site.media)
  const nCenters = useStore((s) => s.centers.length)
  const nCourses = useStore((s) => s.courses.filter(isPublicListed).length)
  const nCats = useStore((s) => s.categories.length)
  return (
    <section className="relative isolate flex min-h-[100svh] flex-col overflow-hidden bg-charcoal text-ivory">
      <BackgroundVideo src={withBase(media.heroVideoUrl)} poster={withBase(media.heroPosterUrl)} pauseLabel={t('home.pauseVideo')} playLabel={t('home.playVideo')} note={t('home.heroVideoNote')} />
      {/* Shades for legibility + soft hand-off into the ivory page */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-charcoal/85 via-charcoal/45 to-charcoal/10" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-charcoal/60 to-transparent" aria-hidden="true" />
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
      <div className="pointer-events-none absolute bottom-6 left-5 flex items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-ivory/55 sm:left-8 lg:left-12">
        <span className="scroll-cue"><Icon name="down" className="h-3.5 w-3.5" /></span>{t('home.scrollDown')}
      </div>
    </section>
  )
}

// ─── Marquee ticker of sample centers & categories ───────────────────────────
function MarqueeSection({ s }: { s: Section }) {
  const { tr } = useT()
  const centers = useStore((st) => st.centers)
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

// ─── Packages ────────────────────────────────────────────────────────────────
function Packages({ s }: { s: Section }) {
  const { t, tr, lang } = useT()
  const packages = useStore((st) => st.site.packages)
  const courses = useStore((st) => st.courses.filter(isPublicListed))
  const cheapest = [...courses].sort((a, b) => a.price - b.price)
  return (
    <section className="relative overflow-hidden bg-sage/40 py-20 lg:py-28">
      <div className="float-a pointer-events-none absolute -left-24 top-10 h-72 w-72 rounded-full border border-champagne/30" aria-hidden="true" />
      <div className="float-b pointer-events-none absolute -right-16 bottom-6 h-56 w-56 rounded-full border border-forest/15" aria-hidden="true" />
      <div className="container-x relative">
        <SectionHeading eyebrow={t('common.demo')} title={tr(s.title)} subtitle={tr(s.subtitle)} />
        <div className="reveal-stagger grid gap-6 md:grid-cols-2 lg:mx-auto lg:max-w-4xl">
          {packages.filter((p) => p.enabled).map((p) => {
            const from = cheapest.slice(0, p.maxCourses).reduce((n, c) => n + c.price, 0)
            return (
              <div key={p.id} className="reveal reveal-scale">
                <Card className={cx('relative flex h-full flex-col p-8 md:p-10 transition duration-500 hover:-translate-y-1 hover:shadow-lift', p.highlight && 'border-champagne/70 shadow-lift')}>
                  {p.highlight && <span className="absolute right-6 top-6 eyebrow">{t('common.featured')}</span>}
                  <div className="font-display text-5xl text-charcoal">{tr(p.name)}</div>
                  <div className="mt-1 text-sm text-charcoal/60">{t('builder.simultaneous', { n: p.maxCourses })}</div>
                  <p className="mt-5 text-[15px] leading-relaxed text-charcoal/70">{tr(p.description)}</p>
                  <ul className="mt-6 space-y-2.5 text-sm text-charcoal/75">
                    {p.perks.map((perk, i) => <li key={i} className="flex gap-2.5"><Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-forest" />{tr(perk)}</li>)}
                  </ul>
                  <div className="mt-8 flex items-end justify-between gap-4 border-t border-charcoal/10 pt-6">
                    <div>
                      <div className="text-[11px] uppercase tracking-[0.16em] text-charcoal/45">{t('home.subscribeFrom')}</div>
                      <div className="font-display text-2xl text-charcoal">{formatSom(from, lang)}<span className="ml-1 text-xs text-charcoal/50">{t('common.perMonth')}</span></div>
                    </div>
                    <LinkButton to={`/builder?package=${p.id}`} variant={p.highlight ? 'primary' : 'secondary'}>{t('common.select')} <Icon name="arrowRight" className="h-4 w-4" /></LinkButton>
                  </div>
                </Card>
              </div>
            )
          })}
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
              <Link key={c.id} to={`/courses?cat=${c.id}`} className="reveal card group flex flex-col justify-between p-5 transition duration-500 hover:-translate-y-1 hover:shadow-lift md:min-h-[150px]">
                <span className="font-display text-3xl text-champagne transition duration-500 group-hover:-translate-y-0.5 group-hover:text-forest">{c.glyph}</span>
                <span>
                  <span className="block font-medium text-charcoal group-hover:text-forest">{tr(c.name)}</span>
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
    <section className="py-20 lg:py-28">
      <div className="container-x">
        <SectionHeading title={tr(s.title)} subtitle={tr(s.subtitle)} align="center" />
        <ol className="reveal-stagger grid gap-6 md:grid-cols-3">
          {(s.items ?? []).map((it, i) => (
            <li key={it.id} className="reveal card relative p-7 transition duration-500 hover:-translate-y-1 hover:shadow-lift">
              <span className="font-display text-5xl text-champagne/70">{String(i + 1).padStart(2, '0')}</span>
              <h3 className="mt-4 font-display text-2xl text-charcoal">{tr(it.title)}</h3>
              <p className="mt-2 text-sm leading-relaxed text-charcoal/65">{tr(it.body)}</p>
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
            <div><div className="eyebrow">{t('courses.monthlyPrice')}</div><PriceTag price={course.price} /></div>
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
              <Avatar name={teacher.name} seed={teacher.avatarSeed} size={40} url={teacher.avatarUpload?.previewUrl} />
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
  const teachers = useStore((st) => st.teachers.filter((x) => x.channelActive)).slice(0, Math.max(s.count ?? 4, 4) + 4)
  const centers = useStore((st) => st.centers)
  if (!enabled) return null
  return (
    <section className="bg-sage/40 py-20 lg:py-28">
      <div className="container-x">
        <SectionHeading eyebrow={t('common.teachers')} title={tr(s.title)} subtitle={tr(s.subtitle)} action={<LinkButton to="/teachers" variant="secondary">{t('home.viewAllTeachers')} <Icon name="arrowRight" className="h-4 w-4" /></LinkButton>} />
        <SnapTrack prevLabel={t('home.prev')} nextLabel={t('home.next')} className="reveal-stagger">
          {teachers.map((te) => (
            <Link key={te.id} to={`/teachers/${te.id}`} className="reveal card group w-[260px] overflow-hidden p-0 transition duration-500 hover:-translate-y-1 hover:shadow-lift sm:w-[280px]">
              <div className="h-24 transition duration-700 group-hover:brightness-110" style={{ background: te.bannerUpload?.previewUrl ? `url(${te.bannerUpload.previewUrl}) center/cover` : `linear-gradient(120deg, ${te.bannerTone}, ${te.bannerTone}cc 60%, #C8AD7F55)` }} />
              <div className="-mt-8 px-5 pb-5">
                <Avatar name={te.name} seed={te.avatarSeed} size={60} url={te.avatarUpload?.previewUrl} className="ring-4 ring-paper" />
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
  const { t, tr } = useT()
  const centers = useStore((st) => st.centers)
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
                  <div className="text-xs text-charcoal/55">{tr(c.district)} · {courses.filter((x) => x.centerId === c.id).length} {t('common.courses').toLowerCase()}</div>
                  <p className="mt-2 text-sm text-charcoal/65">{tr(c.description)}</p>
                </div>
              </Card>
            </div>
          ))}
        </div>
        <p className="reveal mt-6 text-xs text-charcoal/45">{t('centers.partnersNote')}</p>
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
          <Eyebrow className="mb-3">FAQ</Eyebrow>
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

// ─── Inquiry form — deliberately not persisted (no PII in demo storage) ──────
function InquiryForm({ s }: { s: Section }) {
  const { t, tr } = useT()
  const enabled = useStore((st) => st.site.features.centerInquiry)
  const [sent, setSent] = useState(false)
  const [form, setForm] = useState({ center: '', district: '', contact: '', courses: '', message: '' })
  if (!enabled) return <section className="container-x pb-24"><Notice tone="warn">{t('centers.formDisabled')}</Notice></section>
  const valid = form.center.trim() && form.contact.trim()
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
                <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-sage text-forest"><Icon name="check" className="h-6 w-6" /></div>
                <p className="text-charcoal/75">{t('centers.form.success')}</p>
                <Button variant="secondary" className="mt-6" onClick={() => { setSent(false); setForm({ center: '', district: '', contact: '', courses: '', message: '' }) }}>{t('centers.form.another')}</Button>
              </div>
            ) : (
              <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); if (valid) setSent(true) }}>
                <Field label={t('centers.form.center')} required><Input required value={form.center} onChange={(e) => setForm({ ...form, center: e.target.value })} /></Field>
                <Field label={t('centers.form.district')}><Input value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} /></Field>
                <Field label={t('centers.form.contact')} required><Input required value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} /></Field>
                <Field label={t('centers.form.courses')}><Input value={form.courses} onChange={(e) => setForm({ ...form, courses: e.target.value })} /></Field>
                <Field label={t('centers.form.message')} className="sm:col-span-2"><Textarea value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} /></Field>
                <div className="sm:col-span-2 flex items-center justify-between gap-4">
                  <span className="text-xs text-charcoal/45">{t('centers.form.privacy')}</span>
                  <Button type="submit" disabled={!valid}>{t('centers.form.submit')}</Button>
                </div>
              </form>
            )}
          </Card>
        </div>
      </div>
    </section>
  )
}
