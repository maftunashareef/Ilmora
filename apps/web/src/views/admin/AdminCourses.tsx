import { useState } from 'react'
import { Link } from '@/lib/router'
import { StatusBadge, VisibilityBadge } from '../../components/course/badges'
import { CourseForm } from '../../components/course/CourseForm'
import { ScheduleChips } from '../../components/course/CourseCard'
import { ArtCover, Badge, Button, Card, Eyebrow, Icon, Input, Modal, PageTitle, Segmented, Toggle } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { formatSom } from '../../lib/format'
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
  const list = courses.filter((c) => !q || (tr(c.title) + teachers.find((x) => x.id === c.teacherId)?.name).toLowerCase().includes(q.toLowerCase()))
  const setTpl = (patch: Partial<CourseCardTemplate>) => patchSite((s) => ({ ...s, courseCard: { ...s.courseCard, ...patch } }))

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
                <div className="flex flex-wrap items-center gap-2"><Link to={`/courses/${c.id}`} className="truncate font-medium text-charcoal hover:text-forest">{tr(c.title)}</Link><StatusBadge status={c.status} /><VisibilityBadge visibility={c.visibility} />{c.featured && <Badge tone="champagne"><Icon name="star" className="h-3 w-3" /></Badge>}{c.reviewRequested && <Badge tone="warn">{t('admin.reviewQueue')}</Badge>}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-charcoal/55">
                  <span>{tr(categories.find((x) => x.id === c.categoryId)?.name)}</span><span>{center?.name}</span><span>{teachers.find((x) => x.id === c.teacherId)?.name}</span>
                  {c.groups[0] && <ScheduleChips group={c.groups[0]} compact />}{c.groups.length > 1 && <span>+{c.groups.length - 1}</span>}
                </div>
              </div>
              <div className="text-right text-sm font-medium text-charcoal">{formatSom(c.price, lang)}</div>
              <div className="flex gap-1">
                <Button size="sm" variant="secondary" onClick={() => setEditing(c)}><Icon name="edit" className="h-3.5 w-3.5" />{t('common.edit')}</Button>
                <Button size="sm" variant="danger" aria-label={t('common.delete')} onClick={() => { if (confirm(t('common.confirmDelete'))) { removeCourse(c.id); notify(t('common.saved')) } }}><Icon name="trash" className="h-3.5 w-3.5" /></Button>
              </div>
            </li>
          )
        })}
      </ul>
      <Modal wide open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? t('admin.courses.newCourse') : editing ? tr(editing.title) : ''}>
        {editing && <CourseForm mode="admin" initial={editing === 'new' ? undefined : editing} onCancel={() => setEditing(null)} onSave={(c) => { upsertCourse(c); setEditing(null); notify(t('common.saved')) }} />}
      </Modal>
    </div>
  )
}
