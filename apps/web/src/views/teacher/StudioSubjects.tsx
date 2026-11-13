import { useEffect, useState } from 'react'
import { Link } from '@/lib/router'
import { useSearchParams } from '@/lib/routerHooks'
import { StatusBadge, VisibilityBadge } from '../../components/course/badges'
import { ScheduleChips } from '../../components/course/CourseCard'
import { CourseForm } from '../../components/course/CourseForm'
import { ArtCover, Badge, Button, Card, Eyebrow, Icon, LField, Modal, Notice, PageTitle } from '../../components/ui'
import { countLabel, NOUNS } from '@ilmora/shared'
import { emptyL, useT } from '../../i18n/useT'
import { formatSom } from '../../lib/format'
import { useCurrentTeacher } from '../../store/selectors'
import { uid, useStore } from '../../store/useStore'
import type { Course, Subject } from '../../types'

export function StudioSubjects() {
  const { t, tr, lang } = useT()
  const teacher = useCurrentTeacher()
  const [params, setParams] = useSearchParams()
  const subjects = useStore((s) => s.subjects.filter((x) => x.teacherId === teacher?.id))
  const courses = useStore((s) => s.courses.filter((x) => x.teacherId === teacher?.id))
  const centers = useStore((s) => s.centers)
  const { upsertSubject, removeSubject, upsertCourse, removeCourse, notify } = useStore()
  const perms = useStore((s) => s.site.permissions.teacher)
  const [subject, setSubject] = useState<Subject | null>(null)
  const [editing, setEditing] = useState<Course | 'new' | null>(null)
  useEffect(() => { if (params.get('new')) { setEditing('new'); setParams({}, { replace: true }) } }, [params, setParams])
  if (!teacher) return null

  return (
    <div>
      <PageTitle eyebrow={t('dash.teacherStudio')} title={t('studio.subjects')} subtitle={t('studio.subjectsHint')} action={<><Button variant="secondary" onClick={() => setSubject({ id: uid('sub'), teacherId: teacher.id, name: emptyL(), description: emptyL() })}><Icon name="plus" className="h-4 w-4" />{t('studio.newSubject')}</Button><Button onClick={() => setEditing('new')}><Icon name="plus" className="h-4 w-4" />{t('studio.newCourse')}</Button></>} />
      {!perms.editCourses && <Notice tone="warn" className="mb-6"><Icon name="lock" className="mr-1 inline h-3.5 w-3.5" />{t('studio.lockedByAdmin')}: {t('perm.teacher.editCourses')}</Notice>}
      <section className="mb-10">
        <Eyebrow className="mb-3">{t('studio.subjects')} · {subjects.length}</Eyebrow>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {subjects.map((sub) => (
            <Card key={sub.id} className="flex items-start justify-between gap-3 p-4">
              <div><div className="font-display text-xl text-charcoal">{tr(sub.name)}</div><div className="mt-0.5 text-xs text-charcoal/55">{tr(sub.description)}</div><div className="mt-2 text-[11px] text-charcoal/45">{countLabel(lang, courses.filter((c) => c.subjectId === sub.id).length, NOUNS.course)}</div></div>
              <div className="flex gap-0.5"><Button size="sm" variant="ghost" onClick={() => setSubject(sub)} aria-label={t('common.edit')}><Icon name="edit" className="h-3.5 w-3.5" /></Button><Button size="sm" variant="ghost" onClick={() => { if (confirm(t('common.confirmDelete'))) removeSubject(sub.id) }} aria-label={t('common.delete')}><Icon name="trash" className="h-3.5 w-3.5" /></Button></div>
            </Card>
          ))}
          {subjects.length === 0 && <Card className="text-sm text-charcoal/50">{t('common.empty')}</Card>}
        </div>
      </section>
      <section>
        <Eyebrow className="mb-3">{t('common.courses')} · {courses.length}</Eyebrow>
        <ul className="space-y-2">
          {courses.map((c) => (
            <li key={c.id} className="card flex flex-wrap items-center gap-4 p-3">
              <ArtCover seed={c.coverSeed} tone={centers.find((x) => x.id === c.centerId)?.tone} imageUrl={c.imageUpload?.previewUrl || c.imageUrl} className="h-14 w-20 shrink-0 rounded-control" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><Link to={`/courses/${c.id}`} className="font-medium text-charcoal hover:text-forest">{tr(c.title)}</Link><StatusBadge status={c.status} /><VisibilityBadge visibility={c.visibility} />{c.reviewRequested && <Badge tone="warn">{t('studio.reviewPending')}</Badge>}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-charcoal/55"><span>{tr(subjects.find((x) => x.id === c.subjectId)?.name) || t('studio.noSubject')}</span>{c.groups[0] && <ScheduleChips group={c.groups[0]} compact />}<span>{formatSom(c.price, lang)}</span></div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setEditing(c)}><Icon name="edit" className="h-3.5 w-3.5" />{t('common.edit')}</Button>
              <Button size="sm" variant="danger" aria-label={t('common.delete')} onClick={() => { if (confirm(t('common.confirmDelete'))) removeCourse(c.id) }}><Icon name="trash" className="h-3.5 w-3.5" /></Button>
            </li>
          ))}
        </ul>
      </section>
      <Modal open={!!subject} onClose={() => setSubject(null)} title={t('studio.newSubject')} footer={<><Button variant="ghost" onClick={() => setSubject(null)}>{t('common.cancel')}</Button><Button onClick={() => { if (subject && (subject.name.uz || subject.name.en || subject.name.ru)) { void upsertSubject(subject).then(() => { setSubject(null); notify(t('common.saved')) }).catch(() => undefined) } }}>{t('common.save')}</Button></>}>
        {subject && <div className="space-y-4"><LField label={t('common.name')} required value={subject.name} onChange={(v) => setSubject({ ...subject, name: v })} /><LField label={t('common.description')} value={subject.description} onChange={(v) => setSubject({ ...subject, description: v })} /></div>}
      </Modal>
      <Modal wide open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? t('studio.newCourse') : editing ? tr(editing.title) : ''}>
        {editing && <CourseForm mode="teacher" teacherId={teacher.id} initial={editing === 'new' ? undefined : editing} onCancel={() => setEditing(null)} onSave={(c) => { void upsertCourse(c).then(() => { setEditing(null); notify(t('common.saved')) }).catch(() => undefined) }} />}
      </Modal>
    </div>
  )
}
