import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CourseCard } from '../../components/course/CourseCard'
import { Button, EmptyState, Icon, Input, PageTitle, Select } from '../../components/ui'
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
  const setP = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p, { replace: true }) }

  const list = useMemo(() => {
    const ql = q.trim().toLowerCase()
    let out = courses.filter((c) => {
      const acc = checkAccess(c, viewer)
      // Public catalog: published + public. Owners/admins additionally see their internal items with badges.
      if (!acc.allowed) return false
      if (acc.reason === 'public') return true
      return viewer.role === 'admin' || viewer.role === 'teacher'
    })
    if (cat) out = out.filter((c) => c.categoryId === cat)
    if (center) out = out.filter((c) => c.centerId === center)
    if (level) out = out.filter((c) => c.level === level)
    if (day) out = out.filter((c) => c.groups.some((g) => g.days.includes(Number(day))))
    if (ql) out = out.filter((c) => {
      const teacher = teachers.find((x) => x.id === c.teacherId)?.name ?? ''
      const hay = [tr(c.title), tr(c.summary), tr(c.description), teacher, ...c.curriculum.map(tr), tr(categories.find((x) => x.id === c.categoryId)?.name)].join(' ').toLowerCase()
      return hay.includes(ql)
    })
    const sorters: Record<Sort, (a: typeof out[number], b: typeof out[number]) => number> = {
      featured: (a, b) => Number(b.featured) - Number(a.featured) || tr(a.title).localeCompare(tr(b.title)),
      priceAsc: (a, b) => a.price - b.price,
      priceDesc: (a, b) => b.price - a.price,
      title: (a, b) => tr(a.title).localeCompare(tr(b.title)),
    }
    return [...out].sort(sorters[sort])
  }, [courses, viewer, cat, center, level, day, q, sort, tr, teachers, categories])

  const hasFilters = cat || center || level || day || q
  const clear = () => { setQ(''); setParams({}, { replace: true }) }

  return (
    <div className="container-x py-12 lg:py-16">
      <PageTitle eyebrow={t('common.courses')} title={t('courses.title')} subtitle={t('courses.subtitle')} />
      <div className="card mb-8 grid gap-3 p-4 md:grid-cols-[1.4fr_repeat(5,minmax(0,1fr))]">
        {searchOn && (
          <div className="relative">
            <Icon name="search" className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-charcoal/40" />
            <Input aria-label={t('common.search')} className="pl-10" placeholder={t('courses.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        )}
        <Select aria-label={t('common.category')} value={cat} onChange={(e) => setP('cat', e.target.value)}>
          <option value="">{t('common.categories')}: {t('common.all')}</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{tr(c.name)}</option>)}
        </Select>
        <Select aria-label={t('common.center')} value={center} onChange={(e) => setP('center', e.target.value)}>
          <option value="">{t('courses.anyCenter')}</option>
          {centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select aria-label={t('common.level')} value={level} onChange={(e) => setP('level', e.target.value)}>
          <option value="">{t('courses.anyLevel')}</option>
          {(['beginner', 'intermediate', 'advanced'] as const).map((l) => <option key={l} value={l}>{t(`level.${l}`)}</option>)}
        </Select>
        <Select aria-label={t('common.schedule')} value={day} onChange={(e) => setP('day', e.target.value)}>
          <option value="">{t('courses.anyDay')}</option>
          {[0, 1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{t(`day.${d}` as 'day.0')}</option>)}
        </Select>
        <Select aria-label="Sort" value={sort} onChange={(e) => setP('sort', e.target.value)}>
          {(['featured', 'priceAsc', 'priceDesc', 'title'] as Sort[]).map((s) => <option key={s} value={s}>{t(`courses.sort.${s}` as 'courses.sort.featured')}</option>)}
        </Select>
      </div>
      <div className="mb-5 flex items-center justify-between text-xs text-charcoal/55">
        <span>{list.length} {t('common.results')}</span>
        {hasFilters && <Button size="sm" variant="ghost" onClick={clear}>{t('common.clearFilters')}</Button>}
      </div>
      {list.length === 0 ? (
        <EmptyState title={t('common.noResults')} action={<Button variant="secondary" onClick={clear}>{t('common.clearFilters')}</Button>} />
      ) : (
        <div className="reveal-stagger grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.map((c) => <div key={c.id} className="reveal"><CourseCard course={c} showInternal={viewer.role === 'admin' || viewer.role === 'teacher'} /></div>)}
        </div>
      )}
    </div>
  )
}
