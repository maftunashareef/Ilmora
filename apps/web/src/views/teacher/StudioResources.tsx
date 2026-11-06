import { useEffect, useState } from 'react'
import { Link, useSearchParams } from '@/lib/router'
import { StatusBadge, VisibilityBadge } from '../../components/course/badges'
import { finalizePublish, PublishFields, type PublishDraft } from '../../components/PublishFields'
import { Badge, Button, EmptyState, Field, Icon, Input, LField, Modal, Notice, PageTitle, Select } from '../../components/ui'
import { StorageUploadField } from '../../components/StorageUploadField'
import { emptyL, useT } from '../../i18n/useT'
import { formatBytes } from '../../lib/format'
import { useCurrentTeacher } from '../../store/selectors'
import { uid, useStore } from '../../store/useStore'
import type { Resource, ResourceKind } from '../../types'

const KINDS: ResourceKind[] = ['pdf', 'doc', 'sheet', 'link', 'other']

export function StudioResources() {
  const { t, tr } = useT()
  const teacher = useCurrentTeacher()
  const [params, setParams] = useSearchParams()
  const resources = useStore((s) => s.resources.filter((r) => r.teacherId === teacher?.id))
  const courses = useStore((s) => s.courses.filter((c) => c.teacherId === teacher?.id))
  const perms = useStore((s) => s.site.permissions.teacher)
  const { upsertResource, removeResource, notify, storageConfigured } = useStore()
  const [editing, setEditing] = useState<Resource | 'new' | null>(null)
  const [draft, setDraft] = useState<Resource | null>(null)
  const [pub, setPub] = useState<PublishDraft>({ status: 'draft', visibility: null, audience: { studentIds: [], groupIds: [] } })
  useEffect(() => { if (params.get('new')) { open('new'); setParams({}, { replace: true }) } }, [params]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!teacher) return null

  function open(r: Resource | 'new') {
    const d: Resource = r === 'new' ? { id: uid('r'), teacherId: teacher!.id, title: emptyL(), description: emptyL(), kind: 'pdf', status: 'draft', visibility: 'public', audience: { studentIds: [], groupIds: [] }, featured: false, updatedAt: new Date().toISOString() } : r
    setDraft(d); setPub({ status: d.status, visibility: r === 'new' ? null : d.visibility, audience: d.audience }); setEditing(r)
  }
  const save = () => {
    if (!draft) return
    if (!draft.title.uz && !draft.title.en && !draft.title.ru) { notify(`${t('common.title')}: ${t('common.required')}`, 'warn'); return }
    // A file resource carries an uploaded file (its storage address in `url`) or, without storage, a link to the file elsewhere.
    if (draft.kind === 'link' ? !draft.url?.trim() : !draft.file && !draft.url?.trim()) { notify(`${draft.kind === 'link' ? t('common.link') : t('common.upload')}: ${t('common.required')}`, 'warn'); return }
    const r = finalizePublish(pub, 'teacher', perms)
    if (!r.ok) { notify(t(r.error), 'warn'); return }
    upsertResource({ ...draft, ...r.patch }); setEditing(null); notify(t('common.saved')); if (r.note) notify(t(r.note), 'warn')
  }

  return (
    <div>
      <PageTitle eyebrow={t('dash.teacherStudio')} title={t('studio.resources')} subtitle={t('studio.uploadNote')} action={<Button disabled={!perms.uploadResources} onClick={() => open('new')}><Icon name="plus" className="h-4 w-4" />{t('studio.newResource')}</Button>} />
      {!perms.uploadResources && <Notice tone="warn" className="mb-6"><Icon name="lock" className="mr-1 inline h-3.5 w-3.5" />{t('studio.lockedByAdmin')}: {t('perm.teacher.uploadResources')}</Notice>}
      {resources.length === 0 ? <EmptyState title={t('common.empty')} /> : (
        <ul className="space-y-2">
          {resources.map((r) => (
            <li key={r.id} className="card flex flex-wrap items-center gap-3 p-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-control bg-sage text-forest"><Icon name={r.kind === 'link' ? 'external' : 'file'} className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><Link to={`/resources/${r.id}`} className="truncate text-sm font-medium text-charcoal hover:text-forest">{tr(r.title)}</Link><StatusBadge status={r.status} /><VisibilityBadge visibility={r.visibility} />{r.reviewRequested && <Badge tone="warn">{t('studio.reviewPending')}</Badge>}</div>
                <div className="mt-0.5 truncate text-[11px] text-charcoal/50">{t(`kind.${r.kind}`)}{r.file && ` · ${r.file.name} · ${formatBytes(r.file.size)}`}{r.url && ` · ${r.url}`} · {tr(courses.find((c) => c.id === r.courseId)?.title) || t('studio.noCourse')}</div>
              </div>
              <Button size="sm" variant="secondary" disabled={!perms.uploadResources} onClick={() => open(r)}><Icon name="edit" className="h-3.5 w-3.5" />{t('common.edit')}</Button>
              <Button size="sm" variant="ghost" aria-label={t('common.delete')} disabled={!perms.uploadResources} onClick={() => { if (confirm(t('common.confirmDelete'))) removeResource(r.id) }}><Icon name="trash" className="h-3.5 w-3.5" /></Button>
            </li>
          ))}
        </ul>
      )}
      <Modal wide open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? t('studio.newResource') : draft ? tr(draft.title) : ''} footer={<><Button variant="ghost" onClick={() => setEditing(null)}>{t('common.cancel')}</Button><Button onClick={save}>{t('common.save')}</Button></>}>
        {draft && (
          <div className="space-y-6">
            <LField label={t('common.title')} required value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} />
            <LField label={t('common.description')} multiline value={draft.description} onChange={(v) => setDraft({ ...draft, description: v })} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t('studio.resourceKind')}><Select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as ResourceKind })}>{KINDS.map((k) => <option key={k} value={k}>{t(`kind.${k}`)}</option>)}</Select></Field>
              <Field label={t('studio.relatedCourse')}><Select value={draft.courseId ?? ''} onChange={(e) => setDraft({ ...draft, courseId: e.target.value || undefined })}><option value="">{t('studio.noCourse')}</option>{courses.map((c) => <option key={c.id} value={c.id}>{tr(c.title)}</option>)}</Select></Field>
              {draft.kind !== 'link' && <Field label={t('studio.pagesCount')} hint={t('common.optional')}><Input type="number" min={1} value={draft.pages ?? ''} onChange={(e) => setDraft({ ...draft, pages: e.target.value ? Number(e.target.value) : undefined })} /></Field>}
            </div>
            {draft.kind === 'link' ? (
              <Field label={t('common.link')} required><Input placeholder="https://…" value={draft.url ?? ''} onChange={(e) => setDraft({ ...draft, url: e.target.value })} /></Field>
            ) : (
              <div className="space-y-3">
                {/* The file goes to object storage; the resource keeps its name, size and type, and its storage address in `url`. */}
                <div><div className="mb-1.5 text-xs font-medium text-charcoal/70">{t('common.upload')} <span className="text-champagne">*</span></div><StorageUploadField kind="resource-file" url={draft.file ? draft.url : undefined} fileName={draft.file?.name} onUploaded={(r) => setDraft({ ...draft, file: { name: r.name, size: r.size, mime: r.mime }, url: r.publicUrl })} onRemove={() => setDraft({ ...draft, file: undefined, url: undefined })} /></div>
                {storageConfigured === false && <Field label={t('studio.upload.fileLink')} required><Input placeholder="https://…" value={draft.file ? '' : draft.url ?? ''} onChange={(e) => setDraft({ ...draft, file: undefined, url: e.target.value })} /></Field>}
              </div>
            )}
            <PublishFields value={pub} onChange={setPub} teacherId={teacher.id} mode="teacher" />
          </div>
        )}
      </Modal>
    </div>
  )
}
