import { useMemo, useState } from 'react'
import { Link, useSearchParams } from '@/lib/router'
import { CourseCard } from '../../components/course/CourseCard'
import { Button, Icon, Input, Select, cx } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { checkAccess } from '../../lib/access'
import { useViewer } from '../../store/selectors'
import { useStore } from '../../store/useStore'

type Sort = 'featured' | 'priceAsc' | 'priceDesc' | 'title'

export function CoursesPage() {
  const { t, tr } = useT()
  const [params, setParams] = useSearchParams()
  const viewer = useViewer()
  const courses = useStore((s) => s.courses)
  const categories = useStore((s) => s.categories)
  const centers = useStore((s) => s.centers)
  const teachers = useStore((s) => s.teachers)
  const searchOn = useStore((s) => s.site.features.publicSearch)

  const [q, setQ] = useState(params.get('q') ?? '')
  const cat = params.get('cat') ?? ''
  const center = params.get('center') ?? ''
  const level = params.get('level') ?? ''
  const day = params.get('day') ?? ''
  const sort = (params.get('sort') as Sort) || 'featured'
  const setP = (k: string, v: string) => {
    const p = new URLSearchParams(params)
    if (v) p.set(k, v)
    else p.delete(k)
    setParams(p, { replace: true })
  }

  // Pre-calculate counts per category for the discovery chips
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    courses.forEach((c) => {
      const acc = checkAccess(c, viewer)
      if (acc.allowed) {
        counts[c.categoryId] = (counts[c.categoryId] || 0) + 1
      }
    })
    return counts
  }, [courses, viewer])

  const totalAllowedCourses = useMemo(
    () => courses.filter((c) => checkAccess(c, viewer).allowed).length,
    [courses, viewer]
  )

  const list = useMemo(() => {
    const ql = q.trim().toLowerCase()
    let out = courses.filter((c) => {
      const acc = checkAccess(c, viewer)
      if (!acc.allowed) return false
      if (acc.reason === 'public') return true
      return viewer.role === 'admin' || viewer.role === 'teacher'
    })
    if (cat) out = out.filter((c) => c.categoryId === cat)
    if (center) out = out.filter((c) => c.centerId === center)
    if (level) out = out.filter((c) => c.level === level)
    if (day) out = out.filter((c) => c.groups.some((g) => g.days.includes(Number(day))))
    if (ql) {
      out = out.filter((c) => {
        const teacher = teachers.find((x) => x.id === c.teacherId)?.name ?? ''
        const categoryName = tr(categories.find((x) => x.id === c.categoryId)?.name)
        const centerName = centers.find((x) => x.id === c.centerId)?.name ?? ''
        const hay = [
          tr(c.title),
          tr(c.summary),
          tr(c.description),
          teacher,
          centerName,
          categoryName,
          ...c.curriculum.map(tr),
        ]
          .join(' ')
          .toLowerCase()
        return hay.includes(ql)
      })
    }
    const sorters: Record<Sort, (a: (typeof out)[number], b: (typeof out)[number]) => number> = {
      featured: (a, b) => Number(b.featured) - Number(a.featured) || tr(a.title).localeCompare(tr(b.title)),
      priceAsc: (a, b) => a.price - b.price,
      priceDesc: (a, b) => b.price - a.price,
      title: (a, b) => tr(a.title).localeCompare(tr(b.title)),
    }
    return [...out].sort(sorters[sort])
  }, [courses, viewer, cat, center, level, day, q, sort, tr, teachers, categories, centers])

  const hasFilters = Boolean(cat || center || level || day || q)
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
        <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl text-charcoal tracking-tight">
          {t('courses.title')}
        </h1>
        <p className="mt-3 max-w-2xl text-[15px] sm:text-base text-charcoal/75 leading-relaxed">
          {t('courses.subtitle')}
        </p>

        {/* Live Catalog Metadata Pill Strip */}
        <div className="mt-4 flex flex-wrap items-center gap-2.5 text-xs text-charcoal/70">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ivory px-3 py-1 border border-charcoal/10 font-medium">
            <span className="font-bold text-forest">{totalAllowedCourses}</span> {tr({ uz: 'ta kurs', ru: 'курсов', en: 'courses' })}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ivory px-3 py-1 border border-charcoal/10 font-medium">
            <span className="font-bold text-forest">{centers.length}</span> {tr({ uz: 'ta markaz', ru: 'центров', en: 'centers' })}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-ivory px-3 py-1 border border-charcoal/10 font-medium">
            <span className="font-bold text-forest">{categories.length}</span> {tr({ uz: 'ta yo‘nalish', ru: 'направлений', en: 'categories' })}
          </span>
        </div>
      </div>

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
                  aria-label="Clear search"
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
              aria-label="Sort"
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

            {q && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-sage/70 px-3 py-1 font-medium text-forest border border-forest/15 shadow-2xs">
                <span>&ldquo;{q}&rdquo;</span>
                <button
                  type="button"
                  aria-label="Remove search filter"
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
                  aria-label="Remove category filter"
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
                  aria-label="Remove center filter"
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
                  aria-label="Remove level filter"
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
                  aria-label="Remove day filter"
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
              ({totalAllowedCourses} {tr({ uz: 'kursdan', ru: 'из курсов', en: 'from courses' })})
            </span>
          )}
        </span>

        <div className="hidden sm:inline-flex items-center gap-2 text-forest text-[11px] font-medium bg-sage/40 px-3 py-1 rounded-full border border-forest/10">
          <Icon name="check" className="h-3 w-3 text-forest" />
          <span>{tr({ uz: 'Duo va Trio abonementlariga mos', ru: 'Подходит для абонементов Duo и Trio', en: 'Eligible for Duo and Trio subscriptions' })}</span>
        </div>
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
              uz: 'Siz tanlagan mezonlar yoki qidiruv so‘zi bo‘yicha kurslar topilmadi. Qidiruv so‘zini o‘zgartiring yoki filtrlarni tozalang.',
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
              {tr({ uz: 'Abonement yig‘ish', ru: 'Собрать абонемент', en: 'Build subscription' })}
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
