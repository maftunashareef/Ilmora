'use client'
import { useEffect, useState } from 'react'
import { discountFromDraft, discountToDraft, emptyDiscountDraft, type DiscountDraft, isDiscountActive, isoToTashkentLocal } from '@ilmora/shared'
import { Link } from '@/lib/router'
import { StatusBadge, VisibilityBadge } from '../../components/course/badges'
import { PriceNow } from '../../components/course/CourseCard'
import { DiscountFields } from '../../components/course/DiscountFields'
import { Badge, Button, Card, EmptyState, Icon, Modal, Notice, PageTitle } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { api, isApiError } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import { useStore } from '../../store/useStore'
import type { Course } from '../../types'

type Loaded = { center: { id: string; name: string }; courses: Course[] }

/** Tashkent wall-clock text for an instant, e.g. "2026-11-10 23:30". */
const when = (iso: string) => isoToTashkentLocal(iso).replace('T', ' ')

/** The center administrator's page: the courses of their own center and a discount editor for each. */
export function CenterCourses() {
  const { t, tr, lang } = useT()
  const user = useStore((s) => s.auth.user)
  const notify = useStore((s) => s.notify)
  const linked = !!user?.roles.includes('CENTER_ADMIN') && !!user.centerId
  const [data, setData] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState<Course | null>(null)
  const [draft, setDraft] = useState<DiscountDraft>(emptyDiscountDraft())
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!linked) return
    let live = true
    api<Loaded>('/manage/center/courses')
      .then((d) => live && setData(d))
      .catch(() => live && setFailed(true))
    return () => { live = false }
  }, [linked])

  if (!linked) {
    return <EmptyState icon={<Icon name="building" className="h-5 w-5" />} title={t('center.noCenter')} body={t('center.noCenterHint')} />
  }

  const open = (c: Course) => {
    setEditing(c)
    setDraft(discountToDraft(c.discount))
  }

  const save = async (discountDraft: DiscountDraft) => {
    if (!editing) return
    const parsed = discountFromDraft(discountDraft)
    if (!parsed.ok) { notify(t('discount.invalid'), 'warn'); return }
    setBusy(true)
    try {
      const saved = await api<Course>(`/manage/courses/${editing.id}/discount`, { method: 'PUT', body: { discount: parsed.discount } })
      setData((d) => d && { ...d, courses: d.courses.map((c) => (c.id === saved.id ? saved : c)) })
      notify(parsed.discount ? t('center.saved') : t('center.removed'))
      setEditing(null)
    } catch (err) {
      notify(isApiError(err) ? apiErrorText(err, lang) : t('center.loadError'), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const discountLabel = (c: Course) => {
    if (!c.discount) return <Badge tone="muted">{t('center.discountNone')}</Badge>
    const vars = { percent: c.discount.percent, from: when(c.discount.startsAt), until: when(c.discount.endsAt) }
    return isDiscountActive(c.discount) ? <Badge tone="forest">{t('center.discountActive', vars)}</Badge> : <Badge tone="champagne">{t('center.discountScheduled', vars)}</Badge>
  }

  return (
    <div>
      <PageTitle eyebrow={t('dash.center')} title={data?.center.name ?? t('center.courses')} subtitle={t('center.hint')} />
      {failed && <Notice tone="warn">{t('center.loadError')}</Notice>}
      {data && data.courses.length === 0 && <EmptyState title={t('center.empty')} />}
      {data && data.courses.length > 0 && (
        <ul className="space-y-3">
          {data.courses.map((c) => (
            <li key={c.id}>
              <Card className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link to={`/courses/${c.id}`} className="truncate font-medium text-charcoal hover:text-forest">{tr(c.title)}</Link>
                    <StatusBadge status={c.status} />
                    <VisibilityBadge visibility={c.visibility} />
                  </div>
                  <div className="mt-2">{discountLabel(c)}</div>
                </div>
                <div className="text-right text-sm font-medium text-charcoal"><PriceNow course={c} withCurrency /></div>
                <Button size="sm" variant="secondary" onClick={() => open(c)}>
                  <Icon name="edit" className="h-3.5 w-3.5" />
                  {c.discount ? t('center.editDiscount') : t('center.setDiscount')}
                </Button>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Modal
        wide
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing ? tr(editing.title) : ''}
        footer={<><Button variant="ghost" onClick={() => setEditing(null)}>{t('common.cancel')}</Button><Button disabled={busy} onClick={() => void save(draft)}>{t('common.save')}</Button></>}
      >
        {editing && <DiscountFields value={draft} onChange={setDraft} price={editing.price} />}
      </Modal>
    </div>
  )
}
