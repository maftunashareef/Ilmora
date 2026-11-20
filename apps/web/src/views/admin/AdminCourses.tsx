import { COMMISSION_MAX_PERCENT, COMMISSION_MIN_PERCENT, filterCourses, formatCounts, isOnlineCourse, isSafeExternalUrl, type FormatFilter } from '@ilmora/shared'
import { useEffect, useState } from 'react'
import { StatusBadge, VisibilityBadge } from '../../components/course/badges'
import { CourseForm } from '../../components/course/CourseForm'
import type { Pricing } from '../../components/course/DiscountFields'
import { FormatBadge, PriceNow, ScheduleChips } from '../../components/course/CourseCard'
import { ArtCover, Badge, Button, Card, Eyebrow, Icon, Input, Modal, PageTitle, Segmented, Toggle } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { api, isApiError } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import { siteHref } from '../../lib/siteUrl'
import { useStore } from '../../store/useStore'
import type { Course, CourseCardTemplate } from '../../types'

export function AdminCourses() {
  const { t, tr, lang } = useT()
  const courses = useStore((s) => s.courses)
  const teachers = useStore((s) => s.teachers)
  const centers = useStore((s) => s.centers)
  const categories = useStore((s) => s.categories)
  const tpl = useStore((s) => s.site.courseCard)
  const patchSite = useStore((s) => s.patchSite)
  const upsertCourse = useStore((s) => s.upsertCourse)
  const removeCourse = useStore((s) => s.removeCourse)
  const notify = useStore((s) => s.notify)
  const [editing, setEditing] = useState<Course | 'new' | null>(null)
  const [q, setQ] = useState('')
  const [format, setFormat] = useState<FormatFilter>('ALL')
  const searchable = (c: Course) => [tr(c.title), teachers.find((x) => x.id === c.teacherId)?.name, c.providerName, c.instructorName].join(' ')
  const counts = formatCounts(filterCourses(courses, { q }, searchable))
  const list = filterCourses(courses, { q, format }, searchable)
  // Publish / unpublish from the list; the full editor (visibility, audience) stays in the form.
  const togglePublished = (c: Course) => { void upsertCourse({ ...c, status: c.status === 'published' ? 'draft' : 'published' }).then(() => notify(t('common.saved'))).catch(() => undefined) }
  const setTpl = (patch: Partial<CourseCardTemplate>) => patchSite((s) => ({ ...s, courseCard: { ...s.courseCard, ...patch } }))
  // ILMORA's commission (ТЗ 18.11, 9.5): one for every center, set here by the Super Admin only.
  const [pricing, setPricing] = useState<Pricing | undefined>()
  const [commission, setCommission] = useState('')
  useEffect(() => {
    let live = true
    api<Pricing>('/admin/pricing').then((p) => { if (live) { setPricing(p); setCommission(String(p.commissionPercent)) } }).catch(() => undefined)
    return () => { live = false }
  }, [])
  const saveCommission = async () => {
    const k = Number(commission)
    if (!Number.isInteger(k) || k < COMMISSION_MIN_PERCENT || k > COMMISSION_MAX_PERCENT) { notify(t('calc.err.commission', { min: COMMISSION_MIN_PERCENT, max: COMMISSION_MAX_PERCENT }), 'warn'); return }
    try {
      const p = await api<Pricing>('/admin/pricing', { method: 'PUT', body: { commissionPercent: k } })
      setPricing(p); setCommission(String(p.commissionPercent)); notify(t('common.saved'))
    } catch (err) { notify(isApiError(err) ? apiErrorText(err, lang) : String(err), 'warn') }
  }

  return (
    <div>
      <PageTitle eyebrow={t('dash.admin')} title={t('admin.courses')} subtitle={t('admin.courses.hint')} action={<Button onClick={() => setEditing('new')}><Icon name="plus" className="h-4 w-4" />{t('admin.courses.newCourse')}</Button>} />
      <Card className="mb-6">
        <Eyebrow className="mb-1">{t('admin.courses.cardTemplate')}</Eyebrow>
        <p className="mb-4 text-xs text-charcoal/50">{t('admin.courses.cardHint')}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(['showCategory', 'showCenter', 'showTeacher', 'showLevel', 'showSchedule'] as const).map((k) => <Toggle key={k} checked={tpl[k]} onChange={(v) => setTpl({ [k]: v })} label={t(`admin.courses.${k}`)} />)}
          <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium text-charcoal">{t('admin.courses.priceStyle')}</span><Segmented<CourseCardTemplate['priceStyle']> size="sm" value={tpl.priceStyle} onChange={(priceStyle) => setTpl({ priceStyle })} options={[{ id: 'plain', label: t('admin.courses.plain') }, { id: 'emphasis', label: t('admin.courses.emphasis') }]} /></div>
        </div>
      </Card>
      <Card className="mb-6">
        <Eyebrow className="mb-1">{t('calc.adminTitle')}</Eyebrow>
        <p className="mb-4 text-xs text-charcoal/50">{t('calc.adminHint')}</p>
        <div className="flex flex-wrap items-center gap-3">
          <div className="w-28"><Input aria-label={t('calc.adminTitle')} type="number" min={COMMISSION_MIN_PERCENT} max={COMMISSION_MAX_PERCENT} step={1} value={commission} disabled={!pricing} onChange={(e) => setCommission(e.target.value)} /></div>
          <Button size="sm" disabled={!pricing || commission === String(pricing.commissionPercent)} onClick={() => void saveCommission()}>{t('common.save')}</Button>
          {pricing && <span className="text-xs text-charcoal/55">{t('calc.discountRange', { min: pricing.minDiscountPercent, max: pricing.maxDiscountPercent })}</span>}
        </div>
      </Card>
      <div className="mb-3">
        <Segmented<FormatFilter> size="sm" value={format} onChange={setFormat} options={[
          { id: 'ALL', label: `${t('format.all')} · ${counts.ALL}` },
          { id: 'OFFLINE', label: `${t('format.offline')} · ${counts.OFFLINE}` },
          { id: 'ONLINE', label: `${t('format.online')} · ${counts.ONLINE}` },
        ]} />
      </div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="relative w-72 max-w-full"><Icon name="search" className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-charcoal/40" /><Input aria-label={t('common.search')} className="pl-10" placeholder={t('common.search')} value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <span className="text-xs text-charcoal/50">{list.length} / {courses.length}</span>
      </div>
      <ul className="space-y-2">
        {list.map((c) => {
          const center = centers.find((x) => x.id === c.centerId)
          return (
            <li key={c.id} className="card flex flex-wrap items-center gap-4 p-3">
              <ArtCover seed={c.coverSeed} tone={center?.tone} imageUrl={c.imageUpload?.previewUrl || c.imageUrl} className="h-14 w-20 shrink-0 rounded-control" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><FormatBadge course={c} /><a href={siteHref(lang, `/courses/${c.id}`)} className="truncate font-medium text-charcoal hover:text-forest">{tr(c.title)}</a><StatusBadge status={c.status} /><VisibilityBadge visibility={c.visibility} />{c.featured && <Badge tone="champagne"><Icon name="star" className="h-3 w-3" /></Badge>}{c.reviewRequested && <Badge tone="warn">{t('admin.reviewQueue')}</Badge>}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-charcoal/55">
                  <span>{tr(categories.find((x) => x.id === c.categoryId)?.name)}</span>
                  {isOnlineCourse(c) ? (
                    <>
                      <span>{c.providerName}</span>{c.instructorName && <span>{c.instructorName}</span>}
                      {isSafeExternalUrl(c.externalUrl) && <a href={c.externalUrl as string} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-forest hover:underline"><Icon name="external" className="h-3 w-3" />{t('online.open')}</a>}
                    </>
                  ) : (
                    <><span>{center?.name}</span><span>{teachers.find((x) => x.id === c.teacherId)?.name}</span></>
                  )}
                  {c.groups[0] && <ScheduleChips group={c.groups[0]} compact />}{c.groups.length > 1 && <span>+{c.groups.length - 1}</span>}
                </div>
              </div>
              <div className="text-right text-sm font-medium text-charcoal">{isOnlineCourse(c) ? t('online.free') : <PriceNow course={c} withCurrency />}</div>
              <div className="flex gap-1">
                {c.status !== 'archived' && <Button size="sm" variant="ghost" onClick={() => togglePublished(c)}>{c.status === 'published' ? t('common.unpublish') : t('common.publish')}</Button>}
                <Button size="sm" variant="secondary" onClick={() => setEditing(c)}><Icon name="edit" className="h-3.5 w-3.5" />{t('common.edit')}</Button>
                <Button size="sm" variant="danger" aria-label={t('common.delete')} onClick={() => { if (confirm(t('common.confirmDelete'))) { void removeCourse(c.id).then(() => notify(t('common.saved'))).catch(() => undefined) } }}><Icon name="trash" className="h-3.5 w-3.5" /></Button>
              </div>
            </li>
          )
        })}
      </ul>
      <Modal wide open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? t('admin.courses.newCourse') : editing ? tr(editing.title) : ''}>
        {editing && <CourseForm mode="admin" initial={editing === 'new' ? undefined : editing} pricing={pricing} onCancel={() => setEditing(null)} onSave={(c) => { void upsertCourse(c).then(() => { setEditing(null); notify(t('common.saved')) }).catch(() => undefined) }} />}
      </Modal>
    </div>
  )
}
