'use client'
import { useCallback, useEffect, useState } from 'react'
import { discountFromDraft, discountToDraft, emptyDiscountDraft, type DiscountDraft, isDiscountActive, isoToTashkentLocal, studentPercent } from '@ilmora/shared'
import { Link } from '@/lib/router'
import { StatusBadge, VisibilityBadge } from '../../components/course/badges'
import { PriceNow, ScheduleChips } from '../../components/course/CourseCard'
import { CourseForm } from '../../components/course/CourseForm'
import { DiscountFields } from '../../components/course/DiscountFields'
import { Badge, Button, Card, EmptyState, Icon, Modal, Notice, PageTitle } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { formatPercent } from '../../lib/format'
import { siteHref } from '../../lib/siteUrl'
import { api, isApiError } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import { publishSeatCounts } from '../../lib/enrollment'
import { useStore } from '../../store/useStore'
import type { Course } from '../../types'
import { centerCourseInput, centerGroupInput, useCenterScope, type CenterCourses as Loaded, type CenterTeacher } from './centerApi'

/** Tashkent wall-clock text for an instant, e.g. "2026-11-10 23:30". */
const when = (iso: string) => isoToTashkentLocal(iso).replace('T', ' ')

/** The center's courses: create and edit (with groups and weekly schedules), publish, archive, discounts. */
export function CenterCourses() {
  const scope = useCenterScope()
  const { t, tr, lang } = useT()
  const user = useStore((s) => s.auth.user)
  const notify = useStore((s) => s.notify)
  const linked = scope.admin || (!!user?.roles.includes('CENTER_ADMIN') && !!user.centerId)
  const [data, setData] = useState<Loaded | null>(null)
  const [teachers, setTeachers] = useState<CenterTeacher[]>([])
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState<Course | 'new' | null>(null)
  const [discounting, setDiscounting] = useState<Course | null>(null)
  const [draft, setDraft] = useState<DiscountDraft>(emptyDiscountDraft())
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => api<Loaded>(`${scope.base}/courses`).then((d) => { publishSeatCounts(d.courses.flatMap((c) => c.groups)); setData(d) }).catch(() => setFailed(true)), [scope.base])
  useEffect(() => {
    if (!linked) return
    void load()
    api<CenterTeacher[]>(`${scope.base}/teachers`).then(setTeachers).catch(() => undefined)
  }, [linked, load, scope.base])

  if (!linked) return <EmptyState icon={<Icon name="building" className="h-5 w-5" />} title={t('center.noCenter')} body={t('center.noCenterHint')} />

  const fail = (err: unknown) => notify(isApiError(err) ? apiErrorText(err, lang) : t('center.loadError'), 'warn')

  /** Create or update the course, then reconcile its groups (added / changed / removed), like the studio does. */
  const saveCourse = async (c: Course) => {
    setBusy(true)
    try {
      const existing = data?.courses.find((x) => x.id === c.id)
      const saved = existing
        ? await api<Course>(`${scope.base}/courses/${c.id}`, { method: 'PATCH', body: centerCourseInput(c) })
        : await api<Course>(`${scope.base}/courses`, { method: 'POST', body: centerCourseInput(c) })
      const before = existing?.groups ?? []
      for (const g of c.groups) {
        const prev = before.find((x) => x.id === g.id)
        if (!prev) await api(`${scope.base}/courses/${saved.id}/groups`, { method: 'POST', body: centerGroupInput(g) })
        else if (JSON.stringify(centerGroupInput(prev)) !== JSON.stringify(centerGroupInput(g))) await api(`${scope.base}/groups/${g.id}`, { method: 'PATCH', body: centerGroupInput(g) })
      }
      for (const g of before) if (!c.groups.some((x) => x.id === g.id)) await api(`${scope.base}/groups/${g.id}`, { method: 'DELETE' })
      notify(t('common.saved'))
      setEditing(null)
      await load()
    } catch (err) { fail(err) } finally { setBusy(false) }
  }
  const remove = async (c: Course) => {
    if (!confirm(t('common.confirmDelete'))) return
    setBusy(true)
    try { await api(`${scope.base}/courses/${c.id}`, { method: 'DELETE' }); notify(t('common.saved')); await load() } catch (err) { fail(err) } finally { setBusy(false) }
  }
  const saveDiscount = async () => {
    if (!discounting) return
    const parsed = discountFromDraft(draft)
    if (!parsed.ok) { notify(t('discount.invalid'), 'warn'); return }
    setBusy(true)
    try {
      await api<Course>(`/manage/courses/${discounting.id}/discount`, { method: 'PUT', body: { discount: parsed.discount } })
      notify(parsed.discount ? t('center.saved') : t('center.removed'))
      setDiscounting(null)
      await load()
    } catch (err) { fail(err) } finally { setBusy(false) }
  }

  const discountLabel = (c: Course) => {
    if (!c.discount) return <Badge tone="muted">{t('center.discountNone')}</Badge>
    const vars = { percent: c.discount.percent, student: formatPercent(studentPercent(c.discount.percent), lang), from: when(c.discount.startsAt), until: when(c.discount.endsAt) }
    return isDiscountActive(c.discount) ? <Badge tone="forest">{t('center.discountActive', vars)}</Badge> : <Badge tone="champagne">{t('center.discountScheduled', vars)}</Badge>
  }
  const center = data ? { id: data.center.id, name: data.center.name } : undefined

  return (
    <div>
      <PageTitle eyebrow={t('dash.center')} title={data?.center.name ?? t('center.courses')} subtitle={t('center.hint')} action={<Button disabled={!data || teachers.length === 0} title={teachers.length === 0 ? t('center.needTeacherFirst') : undefined} onClick={() => setEditing('new')}><Icon name="plus" className="h-4 w-4" />{t('center.addCourse')}</Button>} />
      {failed && <Notice tone="warn">{t('center.loadError')}</Notice>}
      {data && teachers.length === 0 && <Notice tone="info" className="mb-4">{t('center.needTeacherFirst')} <Link to={scope.links('teachers')} className="underline">{t('center.teachers')}</Link></Notice>}
      {data && data.courses.length === 0 && <EmptyState title={t('center.empty')} />}
      {data && data.courses.length > 0 && (
        <ul className="space-y-3">
          {data.courses.map((c) => (
            <li key={c.id}>
              <Card className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {scope.admin ? <a href={siteHref(lang, `/courses/${c.id}`)} className="truncate font-medium text-charcoal hover:text-forest">{tr(c.title)}</a> : <Link to={`/courses/${c.id}`} className="truncate font-medium text-charcoal hover:text-forest">{tr(c.title)}</Link>}
                    <StatusBadge status={c.status} />
                    <VisibilityBadge visibility={c.visibility} />
                  </div>
                  <div className="mt-1 text-xs text-charcoal/55">{teachers.find((x) => x.id === c.teacherId)?.name}</div>
                  <div className="mt-2 flex flex-wrap gap-2">{c.groups.map((g) => <span key={g.id} className="rounded-control border border-charcoal/10 bg-paper px-2 py-1 text-[11px] text-charcoal/70">{g.name} · <ScheduleChips group={g} compact /> · {g.enrolled ?? 0}/{g.capacity}</span>)}</div>
                  <div className="mt-2">{discountLabel(c)}</div>
                </div>
                <div className="text-right text-sm font-medium text-charcoal"><PriceNow course={c} withCurrency /></div>
                <div className="flex gap-1">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(c)} aria-label={t('common.edit')}><Icon name="edit" className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="secondary" onClick={() => { setDiscounting(c); setDraft(discountToDraft(c.discount)) }} title={c.discount ? t('center.editDiscount') : t('center.setDiscount')}><Icon name="tag" className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="danger" disabled={busy} onClick={() => void remove(c)} aria-label={t('common.delete')}><Icon name="trash" className="h-3.5 w-3.5" /></Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Modal wide open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? t('center.addCourse') : editing ? tr(editing.title) : ''}>
        {editing && center && (
          <CourseForm key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? undefined : editing} mode="center" teachers={teachers} center={center} teacherId={teachers[0]?.id} onSave={(c) => void saveCourse(c)} onCancel={() => setEditing(null)} />
        )}
      </Modal>
      <Modal
        wide
        open={!!discounting}
        onClose={() => setDiscounting(null)}
        title={discounting ? tr(discounting.title) : ''}
        footer={<><Button variant="ghost" onClick={() => setDiscounting(null)}>{t('common.cancel')}</Button><Button disabled={busy} onClick={() => void saveDiscount()}>{t('common.save')}</Button></>}
      >
        {discounting && <DiscountFields value={draft} onChange={setDraft} price={discounting.price} />}
      </Modal>
    </div>
  )
}
