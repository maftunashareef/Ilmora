import { activePercent, filterCourses, finalPriceSom, formatCounts, formatFilterFromParam, formatFilterToParam, ONLINE_PROVIDER_SLUG, type FormatFilter } from '@ilmora/shared'
import { useMemo, useState } from 'react'
import { Link } from '@/lib/router'
import { useSearchParams } from '@/lib/routerHooks'
import { CourseCard } from '../../components/course/CourseCard'
import { SaleRibbon } from '../../components/course/DiscountShowcase'
import { Button, Icon, Input, Select } from '../../components/ui'
import { cx } from '../../components/ui/helpers'
import { useT } from '../../i18n/useT'
import { checkAccess } from '../../lib/access'
import { useViewer } from '../../store/selectors'
import { useStore } from '../../store/useStore'
import { CourseFinderPrompt } from './CourseFinder'
import { UniversitiesBand } from './Universities'

type Sort = 'featured' | 'priceAsc' | 'priceDesc' | 'title'

export function CoursesPage() {
  const { t, tr, lang } = useT()
  const [params, setParams] = useSearchParams()
  const viewer = useViewer()
  const courses = useStore((s) => s.courses)
  const categories = useStore((s) => s.categories)
  // The platform center that holds online courses is not a real center, so it is never listed or counted.
  const centers = useStore((s) => s.centers.filter((c) => c.slug !== ONLINE_PROVIDER_SLUG))
  const teachers = useStore((s) => s.teachers)
  const searchOn = useStore((s) => s.site.features.publicSearch)

  const [q, setQ] = useState(params.get('q') ?? '')
  const cat = params.get('cat') ?? ''
  const center = params.get('center') ?? ''
  const level = params.get('level') ?? ''
  const day = params.get('day') ?? ''
  const format = formatFilterFromParam(params.get('format'))
  // "Barça çegirmalar": only courses whose discount is active now (?sale=1).
  const sale = params.get('sale') === '1'
  const sort = (params.get('sort') as Sort) || 'featured'
  const setP = (k: string, v: string) => {
    const p = new URLSearchParams(params)
    if (v) p.set(k, v)
    else p.delete(k)
    setParams(p, { replace: true })
  }

  // The courses this viewer may see; every filter below narrows this list.
  const visible = useMemo(
    () =>
      courses.filter((c) => {
        const acc = checkAccess(c, viewer)
        if (!acc.allowed) return false
        if (acc.reason === 'public') return true
        return viewer.role === 'admin' || viewer.role === 'teacher'
      }),
    [courses, viewer],
  )

  const haystack = (c: (typeof courses)[number]) =>
    [
      tr(c.title),
      tr(c.summary),
      tr(c.description),
      teachers.find((x) => x.id === c.teacherId)?.name ?? '',
      centers.find((x) => x.id === c.centerId)?.name ?? '',
      tr(categories.find((x) => x.id === c.categoryId)?.name),
      c.providerName ?? '',
      c.instructorName ?? '',
      ...c.curriculum.map(tr),
    ].join(' ')
  const filters = { categoryId: cat, centerId: center, level, day: day ? Number(day) : null, q, sale }

  // The catalog is small, so the counts and the list are worked out on every render.
  // Counts on the category chips follow the format tab; counts on the format tabs follow every other filter.
  const categoryCounts: Record<string, number> = {}
  for (const c of filterCourses(visible, { format }, haystack)) categoryCounts[c.categoryId] = (categoryCounts[c.categoryId] || 0) + 1
  const totalAllowedCourses = filterCourses(visible, { format }, haystack).length
  const tabCounts = formatCounts(filterCourses(visible, { ...filters, format: 'ALL' }, haystack))
  const saleCount = filterCourses(visible, { ...filters, format, sale: true }, haystack).length

  const matching = filterCourses(visible, { ...filters, format }, haystack)
  const sorters: Record<Sort, (a: (typeof matching)[number], b: (typeof matching)[number]) => number> = {
    // An explicit locale, so the server and the browser sort Latin and Cyrillic titles the same way (no hydration mismatch).
    // In the discounts view the biggest discount comes first.
    featured: (a, b) => (sale ? activePercent(b) - activePercent(a) : 0) || Number(b.featured) - Number(a.featured) || tr(a.title).localeCompare(tr(b.title), lang),
    priceAsc: (a, b) => finalPriceSom(a) - finalPriceSom(b),
    priceDesc: (a, b) => finalPriceSom(b) - finalPriceSom(a),
    title: (a, b) => tr(a.title).localeCompare(tr(b.title), lang),
  }
  const list = [...matching].sort(sorters[sort])

  const hasFilters = Boolean(cat || center || level || day || q || sale || format !== 'ALL')
  const clear = () => {
    setQ('')
    setParams({}, { replace: true })
  }

  return (
    <div className="container-x py-10 lg:py-14">
      {/* Editorial Catalog Hero Header */}
      <div className="mb-8">
        <div className="inline-flex items-center gap-2 rounded-full border border-champagne/40 bg-paper/80 px-3.5 py-1 text-xs font-semibold uppercase tracking-wider text-forest shadow-2xs backdrop-blur-sm mb-3">
          <span className="h-2 w-2 rounded-full bg-forest animate-pulse" />
          <span>{t('common.courses')}</span>
        </div>
        <h1 className="flex flex-wrap items-center gap-3 font-display text-4xl sm:text-5xl lg:text-6xl text-charcoal tracking-tight">
          {sale ? t('offers.all') : t('courses.title')}
          {sale && <SaleRibbon className="text-xs" />}
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] sm:text-base text-charcoal/75 leading-relaxed">
          {sale ? t('offers.allSubtitle') : t('courses.subtitle')}
        </p>

        {/* Live Catalog Metadata Pill Strip */}
        <div className="mt-4 flex flex-wrap items-center gap-2.5 text-xs text-charcoal/70">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ivory px-3 py-1 border border-charcoal/10 font-medium">
            <span className="font-bold text-forest">{visible.length}</span> {tr({ uz: 'ta kurs', ru: 'курсов', en: 'courses' })}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ivory px-3 py-1 border border-charcoal/10 font-medium">
            <span className="font-bold text-forest">{centers.length}</span> {tr({ uz: 'ta markaz', ru: 'центров', en: 'centers' })}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ivory px-3 py-1 border border-charcoal/10 font-medium">
            <span className="font-bold text-forest">{categories.length}</span> {tr({ uz: 'ta yönaliş', ru: 'направлений', en: 'categories' })}
          </span>
        </div>
      </div>

      <CourseFinderPrompt className="mb-4" />
      {!sale && <UniversitiesBand className="mb-6" />}

      {/* Learning format: all / offline / online (kept in the URL as ?format=offline|online) */}
      <div className="mb-4 grid grid-cols-3 gap-1 rounded-2xl border border-charcoal/12 bg-paper p-1 sm:inline-grid sm:w-auto" role="group" aria-label={t('format.label')}>
        {(['ALL', 'OFFLINE', 'ONLINE'] as FormatFilter[]).map((f) => {
          const active = format === f
          return (
            <button
              key={f}
              type="button"
              aria-pressed={active}
              onClick={() => setP('format', formatFilterToParam(f))}
              className={cx(
                'flex flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-2 text-xs font-semibold transition-colors sm:flex-row sm:gap-2 sm:px-5',
                active ? 'bg-forest text-ivory shadow-xs' : 'text-charcoal/70 hover:bg-sage/60 hover:text-forest'
              )}
            >
              <span>{t(f === 'ALL' ? 'format.all' : f === 'OFFLINE' ? 'format.offline' : 'format.online')}</span>
              <span className={cx('rounded-full px-1.5 py-0.5 text-[10px]', active ? 'bg-ivory/25 text-ivory' : 'bg-charcoal/8 text-charcoal/60')}>{tabCounts[f]}</span>
            </button>
          )
        })}
      </div>

      {/* All active discounts (kept in the URL as ?sale=1) */}
      <button
        type="button"
        aria-pressed={sale}
        onClick={() => setP('sale', sale ? '' : '1')}
        className={cx(
          'mb-4 ml-0 inline-flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-xs font-semibold transition-colors sm:ml-2',
          sale ? 'border-forest bg-forest text-champagne shadow-xs' : 'border-champagne/70 bg-gradient-to-r from-champagne/25 to-paper text-forest hover:border-champagne'
        )}
      >
        <Icon name="star" className="h-3.5 w-3.5" />
        <span>{t('offers.all')}</span>
        <span className={cx('rounded-full px-1.5 py-0.5 text-[10px]', sale ? 'bg-champagne/25 text-champagne' : 'bg-champagne/40 text-forest')}>{saleCount}</span>
      </button>

      {/* Category Quick Filter Chips */}
      <div className="mb-6 flex items-center gap-2 overflow-x-auto no-scrollbar pb-1">
        <button
          type="button"
          onClick={() => setP('cat', '')}
          className={cx(
            'inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium transition-all duration-200 border whitespace-nowrap shadow-2xs',
            !cat
              ? 'bg-forest text-ivory border-forest shadow-xs font-semibold'
              : 'bg-paper text-charcoal/75 border-charcoal/15 hover:border-forest/40 hover:text-forest'
          )}
        >
          <span>{t('common.all')}</span>
          <span className={cx('text-[10px] rounded-full px-1.5 py-0.5', !cat ? 'bg-ivory/25 text-ivory' : 'bg-charcoal/8 text-charcoal/60')}>
            {totalAllowedCourses}
          </span>
        </button>

        {categories.map((c) => {
          const count = categoryCounts[c.id] ?? 0
          const active = cat === c.id
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => setP('cat', active ? '' : c.id)}
              className={cx(
                'inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-medium transition-all duration-200 border whitespace-nowrap shadow-2xs',
                active
                  ? 'bg-forest text-ivory border-forest shadow-xs font-semibold'
                  : 'bg-paper text-charcoal/75 border-charcoal/15 hover:border-forest/40 hover:text-forest'
              )}
            >
              {c.glyph && <span>{c.glyph}</span>}
              <span>{tr(c.name)}</span>
              <span className={cx('text-[10px] rounded-full px-1.5 py-0.5', active ? 'bg-ivory/25 text-ivory' : 'bg-charcoal/8 text-charcoal/60')}>
                {count}
              </span>
            </button>
          )
        })}
      </div>

      {/* Search & Filter Controls Card */}
      <div className="card mb-6 p-4 sm:p-5 border border-charcoal/10 bg-paper/95 shadow-soft rounded-card">
        {/* Row 1: Search and Sort */}
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          {searchOn && (
            <div className="relative">
              <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-charcoal/40" />
              <Input
                aria-label={t('common.search')}
                className="pl-10 pr-10 bg-ivory/50 focus:bg-paper transition-colors"
                placeholder={t('courses.searchPlaceholder')}
                value={q}
                onChange={(e) => {
                  const val = e.target.value
                  setQ(val)
                  setP('q', val)
                }}
              />
              {q && (
                <button
                  type="button"
                  aria-label={t('courses.clearSearch')}
                  onClick={() => {
                    setQ('')
                    setP('q', '')
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 text-charcoal/40 hover:bg-charcoal/10 hover:text-charcoal transition-colors"
                >
                  <Icon name="x" className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Sort Dropdown */}
          <div className="flex items-center gap-2">
            <Select
              aria-label={t('courses.sort')}
              value={sort}
              onChange={(e) => setP('sort', e.target.value)}
              className="w-full sm:w-auto min-w-[200px] bg-ivory/50"
            >
              {(['featured', 'priceAsc', 'priceDesc', 'title'] as Sort[]).map((s) => (
                <option key={s} value={s}>
                  {t(`courses.sort.${s}` as 'courses.sort.featured')}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {/* Row 2: Secondary Dropdowns (Center, Level, Day) */}
        <div className="mt-3.5 grid gap-3 grid-cols-1 sm:grid-cols-3 pt-3.5 border-t border-charcoal/8">
          <div>
            <Select
              aria-label={t('common.center')}
              value={center}
              onChange={(e) => setP('center', e.target.value)}
              className="w-full bg-ivory/50"
            >
              <option value="">{t('courses.anyCenter')}</option>
              {centers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Select
              aria-label={t('common.level')}
              value={level}
              onChange={(e) => setP('level', e.target.value)}
              className="w-full bg-ivory/50"
            >
              <option value="">{t('courses.anyLevel')}</option>
              {(['beginner', 'intermediate', 'advanced'] as const).map((l) => (
                <option key={l} value={l}>
                  {t(`level.${l}`)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Select
              aria-label={t('common.schedule')}
              value={day}
              onChange={(e) => setP('day', e.target.value)}
              className="w-full bg-ivory/50"
            >
              <option value="">{t('courses.anyDay')}</option>
              {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                <option key={d} value={d}>
                  {t(`day.${d}` as 'day.0')}
                </option>
              ))}
            </Select>
          </div>
        </div>

        {/* Row 3: Active Filters Tags Strip */}
        {hasFilters && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-charcoal/8 pt-3 text-xs">
            <span className="text-charcoal/50 font-medium mr-1">
              {tr({ uz: 'Faol filtrlar:', ru: 'Активные фильтры:', en: 'Active filters:' })}
            </span>

            {sale && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-champagne/40 px-3 py-1 font-medium text-forest border border-champagne/70 shadow-2xs">
                <span>{t('offers.all')}</span>
                <button
                  type="button"
                  aria-label={t('courses.removeFilter', { name: t('offers.all') })}
                  onClick={() => setP('sale', '')}
                  className="hover:text-red-700 transition-colors"
                >
                  <Icon name="x" className="h-3 w-3" />
                </button>
              </span>
            )}

            {format !== 'ALL' && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sage/70 px-3 py-1 font-medium text-forest border border-forest/15 shadow-2xs">
                <span>{t(format === 'OFFLINE' ? 'format.offline' : 'format.online')}</span>
                <button
                  type="button"
                  aria-label={t('courses.removeFilter', { name: t(format === 'OFFLINE' ? 'format.offline' : 'format.online') })}
                  onClick={() => setP('format', '')}
                  className="hover:text-red-700 transition-colors"
                >
                  <Icon name="x" className="h-3 w-3" />
                </button>
              </span>
            )}

            {q && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sage/70 px-3 py-1 font-medium text-forest border border-forest/15 shadow-2xs">
                <span>&ldquo;{q}&rdquo;</span>
                <button
                  type="button"
                  aria-label={t('courses.removeFilter', { name: q })}
                  onClick={() => {
                    setQ('')
                    setP('q', '')
                  }}
                  className="hover:text-red-700 transition-colors"
                >
                  <Icon name="x" className="h-3 w-3" />
                </button>
              </span>
            )}

            {cat && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sage/70 px-3 py-1 font-medium text-forest border border-forest/15 shadow-2xs">
                <span>{tr(categories.find((c) => c.id === cat)?.name)}</span>
                <button
                  type="button"
                  aria-label={t('courses.removeFilter', { name: tr(categories.find((c) => c.id === cat)?.name) })}
                  onClick={() => setP('cat', '')}
                  className="hover:text-red-700 transition-colors"
                >
                  <Icon name="x" className="h-3 w-3" />
                </button>
              </span>
            )}

            {center && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sage/70 px-3 py-1 font-medium text-forest border border-forest/15 shadow-2xs">
                <span>{centers.find((c) => c.id === center)?.name}</span>
                <button
                  type="button"
                  aria-label={t('courses.removeFilter', { name: centers.find((c) => c.id === center)?.name ?? '' })}
                  onClick={() => setP('center', '')}
                  className="hover:text-red-700 transition-colors"
                >
                  <Icon name="x" className="h-3 w-3" />
                </button>
              </span>
            )}

            {level && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sage/70 px-3 py-1 font-medium text-forest border border-forest/15 shadow-2xs">
                <span>{t(`level.${level}` as 'level.beginner')}</span>
                <button
                  type="button"
                  aria-label={t('courses.removeFilter', { name: t(`level.${level}` as 'level.beginner') })}
                  onClick={() => setP('level', '')}
                  className="hover:text-red-700 transition-colors"
                >
                  <Icon name="x" className="h-3 w-3" />
                </button>
              </span>
            )}

            {day && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sage/70 px-3 py-1 font-medium text-forest border border-forest/15 shadow-2xs">
                <span>{t(`day.${day}` as 'day.0')}</span>
                <button
                  type="button"
                  aria-label={t('courses.removeFilter', { name: t(`day.${day}` as 'day.0') })}
                  onClick={() => setP('day', '')}
                  className="hover:text-red-700 transition-colors"
                >
                  <Icon name="x" className="h-3 w-3" />
                </button>
              </span>
            )}

            <button
              type="button"
              onClick={clear}
              className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-charcoal/60 hover:text-forest underline transition-colors"
            >
              {t('common.clearFilters')}
            </button>
          </div>
        )}
      </div>

      {/* Discovery Results Meta Header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 text-xs text-charcoal/65">
        <span className="font-medium text-charcoal/80">
          <span className="font-bold text-forest text-sm">{list.length}</span> {t('common.results')}
          {hasFilters && (
            <span className="text-charcoal/50 ml-1.5">
              ({visible.length} {tr({ uz: 'kursdan', ru: 'из курсов', en: 'from courses' })})
            </span>
          )}
        </span>

        {format === 'ONLINE' ? (
          <div className="inline-flex items-center gap-2 text-forest text-[11px] font-medium bg-sage/40 px-3 py-1 rounded-full border border-forest/10">
            <Icon name="info" className="h-3 w-3 shrink-0 text-forest" />
            <span>{t('online.notSubscription')}</span>
          </div>
        ) : format === 'OFFLINE' ? (
          <div className="hidden sm:inline-flex items-center gap-2 text-forest text-[11px] font-medium bg-sage/40 px-3 py-1 rounded-full border border-forest/10">
            <Icon name="check" className="h-3 w-3 text-forest" />
            <span>{t('courses.subscriptionEligible')}</span>
          </div>
        ) : null}
      </div>

      {/* Empty State vs. Results Grid */}
      {list.length === 0 ? (
        <div className="card my-8 flex flex-col items-center justify-center p-12 text-center border-dashed border-charcoal/20 bg-paper/60 rounded-card">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-sage/70 text-forest shadow-xs">
            <Icon name="search" className="h-7 w-7" />
          </div>
          <h3 className="font-display text-2xl text-charcoal font-semibold">
            {t('common.noResults')}
          </h3>
          <p className="mt-2 max-w-md text-sm text-charcoal/70 leading-relaxed">
            {tr({
              uz: 'Siz tanlagan mezonlar yoki qidiruv sözi böyiça kurslar topilmadi. Qidiruv sözini özgartiring yoki filtrlarni tozalang.',
              ru: 'По выбранным критериям или поисковому запросу ничего не найдено. Попробуйте изменить запрос или сбросить фильтры.',
              en: 'No courses found matching your criteria. Try adjusting your search query or clearing active filters.',
            })}
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button variant="primary" onClick={clear}>
              {t('common.clearFilters')}
            </Button>
            <Link
              to="/builder"
              className="inline-flex items-center gap-1.5 rounded-control border border-charcoal/20 bg-paper px-4 py-2.5 text-xs font-medium text-charcoal transition hover:border-forest hover:text-forest shadow-2xs"
            >
              {tr({ uz: 'Abonement yiğiş', ru: 'Собрать абонемент', en: 'Build subscription' })}
              <Icon name="arrowRight" className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      ) : (
        <div className="reveal-stagger grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.map((c) => (
            <div key={c.id} className="reveal">
              <CourseCard course={c} showInternal={viewer.role === 'admin' || viewer.role === 'teacher'} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
