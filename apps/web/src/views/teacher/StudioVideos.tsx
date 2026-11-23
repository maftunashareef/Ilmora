import { useEffect, useState } from 'react'
import { Link } from '@/lib/router'
import { useSearchParams } from '@/lib/routerHooks'
import { StatusBadge, VisibilityBadge } from '../../components/course/badges'
import { PublishFields, type PublishDraft } from '../../components/PublishFields'
import { finalizePublish } from '../../components/publish'
import { ArtCover, Badge, Button, EmptyState, Field, Icon, Input, LField, Modal, Notice, PageTitle, Segmented, Select } from '../../components/ui'
import { StorageUploadField } from '../../components/StorageUploadField'
import { emptyL, useT } from '../../i18n/useT'
import { formatDuration } from '../../lib/format'
import { useCurrentTeacher } from '../../store/selectors'
import { uid, useStore } from '../../store/useStore'
import type { Video } from '../../types'

export function StudioVideos() {
  const { t, tr } = useT()
  const teacher = useCurrentTeacher()
  const [params, setParams] = useSearchParams()
  const videos = useStore((s) => s.videos.filter((v) => v.teacherId === teacher?.id))
  const courses = useStore((s) => s.courses.filter((c) => c.teacherId === teacher?.id))
  const { upsertVideo, removeVideo, notify } = useStore()
  const [editing, setEditing] = useState<Video | 'new' | null>(null)
  useEffect(() => { if (params.get('new')) { setEditing('new'); setParams({}, { replace: true }) } }, [params, setParams])
  if (!teacher) return null
  return (
    <div>
      <PageTitle eyebrow={t('dash.teacherStudio')} title={t('studio.videos')} subtitle={t('channel.demoVideoNote')} action={<Button onClick={() => setEditing('new')}><Icon name="plus" className="h-4 w-4" />{t('studio.newVideo')}</Button>} />
      {videos.length === 0 ? <EmptyState title={t('common.empty')} action={<Button onClick={() => setEditing('new')}>{t('studio.newVideo')}</Button>} /> : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {videos.map((v) => (
            <li key={v.id} className="card flex gap-3 p-3">
              <Link to={`/videos/${v.id}`} className="relative shrink-0"><ArtCover seed={v.coverSeed} imageUrl={v.thumbnailUpload?.previewUrl || v.thumbnailUrl} className="h-20 w-32 rounded-control" /><span className="absolute bottom-1 right-1 rounded-sm bg-charcoal/80 px-1 text-[10px] text-ivory">{formatDuration(v.durationSec)}</span></Link>
              <div className="min-w-0 flex-1">
                <Link to={`/videos/${v.id}`} className="line-clamp-1 text-sm font-medium text-charcoal hover:text-forest">{tr(v.title)}</Link>
                <div className="mt-1 flex flex-wrap gap-1"><StatusBadge status={v.status} /><VisibilityBadge visibility={v.visibility} />{v.reviewRequested && <Badge tone="warn">{t('studio.reviewPending')}</Badge>}{v.source.kind === 'upload' && <Badge tone="muted">{t('channel.uploadedFile')}</Badge>}</div>
                <div className="mt-1.5 truncate text-[11px] text-charcoal/50">{tr(courses.find((c) => c.id === v.courseId)?.title) || t('studio.noCourse')}{v.visibility === 'private' && ` · ${v.audience.groupIds.length + v.audience.studentIds.length} ${t('vis.audience').toLowerCase()}`}</div>
                <div className="mt-2 flex gap-1"><Button size="sm" variant="secondary" onClick={() => setEditing(v)}><Icon name="edit" className="h-3.5 w-3.5" />{t('common.edit')}</Button><Button size="sm" variant="ghost" onClick={() => { if (confirm(t('common.confirmDelete'))) removeVideo(v.id) }} aria-label={t('common.delete')}><Icon name="trash" className="h-3.5 w-3.5" /></Button></div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Modal wide open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? t('studio.newVideo') : editing ? tr(editing.title) : ''}>
        {editing && <VideoForm teacherId={teacher.id} initial={editing === 'new' ? undefined : editing} onCancel={() => setEditing(null)} onSave={async (v) => { await upsertVideo(v); setEditing(null); notify(t('common.saved')) }} />}
      </Modal>
    </div>
  )
}

function VideoForm({ initial, teacherId, onSave, onCancel }: { initial?: Video; teacherId: string; onSave: (v: Video) => Promise<void>; onCancel: () => void }) {
  const { t, tr } = useT()
  const courses = useStore((s) => s.courses.filter((c) => c.teacherId === teacherId))
  const perms = useStore((s) => s.site.permissions.teacher)
  const notify = useStore((s) => s.notify)
  const [draft, setDraft] = useState<Video>(() => initial ?? { id: uid('v'), teacherId, title: emptyL(), description: emptyL(), source: { kind: 'link', url: '' }, durationSec: 600, coverSeed: Math.floor(Math.random() * 60), status: 'draft', visibility: 'public', audience: { studentIds: [], groupIds: [] }, featured: false, updatedAt: new Date().toISOString() })
  const [pub, setPub] = useState<PublishDraft>({ status: initial?.status ?? 'draft', visibility: initial ? initial.visibility : null, audience: initial?.audience ?? { studentIds: [], groupIds: [] } })
  const sourceKind = draft.source.kind
  const [saving, setSaving] = useState(false)
  const save = async () => {
    if (saving) return
    if (!draft.title.uz && !draft.title.en && !draft.title.ru) { notify(`${t('common.title')}: ${t('common.required')}`, 'warn'); return }
    if (draft.source.kind === 'link' && !draft.source.url.trim()) { notify(`${t('studio.videoLink')}: ${t('common.required')}`, 'warn'); return }
    if (draft.source.kind === 'upload' && !draft.source.file) { notify(`${t('studio.videoUpload')}: ${t('common.required')}`, 'warn'); return }
    const r = finalizePublish(pub, 'teacher', perms)
    if (!r.ok) { notify(t(r.error), 'warn'); return }
    setSaving(true)
    // «Сохранено» only after the server has kept it; on an error the store shows it and the form keeps what was typed (М11).
    try {
      await onSave({ ...draft, ...r.patch })
      if (r.note) notify(t(r.note), 'warn')
    } catch { /* shown by the store */ } finally { setSaving(false) }
  }
  return (
    <div className="space-y-6">
      <LField label={t('common.title')} required value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} />
      <LField label={t('common.description')} multiline value={draft.description} onChange={(v) => setDraft({ ...draft, description: v })} />
      <div>
        <div className="mb-2 text-sm font-medium text-charcoal">{t('studio.videoSource')}</div>
        {/* Videos are YouTube/Vimeo links. The switch only appears for a lesson saved as a file earlier, so it can be turned into a link. */}
        {initial?.source.kind === 'upload' && <Segmented<'link' | 'upload'> value={sourceKind} onChange={(k) => setDraft({ ...draft, source: k === 'link' ? { kind: 'link', url: '' } : initial.source })} options={[{ id: 'link', label: t('common.link') }, { id: 'upload', label: t('channel.uploadedFile') }]} />}
        <div className="mt-3">
          {draft.source.kind === 'link' ? (
            <Field label={t('studio.videoLink')} required><Input placeholder="https://www.youtube.com/watch?v=…" value={draft.source.url} onChange={(e) => setDraft({ ...draft, source: { kind: 'link', url: e.target.value } })} /></Field>
          ) : (
            <div className="rounded-card border border-charcoal/10 bg-paper p-3 text-xs">
              <div className="truncate font-medium text-charcoal">{draft.source.file.name || t('channel.uploadedFile')}</div>
              <Notice tone="warn" className="mt-2 text-[12px]">{t('studio.videoUploadNote')}</Notice>
            </div>
          )}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('studio.durationMin')}><Input type="number" min={1} value={Math.round(draft.durationSec / 60)} onChange={(e) => setDraft({ ...draft, durationSec: Number(e.target.value) * 60 })} /></Field>
        <Field label={t('studio.relatedCourse')}><Select value={draft.courseId ?? ''} onChange={(e) => setDraft({ ...draft, courseId: e.target.value || undefined })}><option value="">{t('studio.noCourse')}</option>{courses.map((c) => <option key={c.id} value={c.id}>{tr(c.title)}</option>)}</Select></Field>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={`${t('studio.thumbnail')} · URL`} hint={t('common.optional')}><Input placeholder="https://…" value={draft.thumbnailUrl ?? ''} onChange={(e) => setDraft({ ...draft, thumbnailUrl: e.target.value || undefined })} /></Field>
        {/* The thumbnail goes to object storage and its address becomes the thumbnail URL (no browser-only preview is ever saved). */}
        <div><div className="mb-1.5 text-xs font-medium text-charcoal/70">{t('studio.thumbnail')} · {t('common.upload')}</div><StorageUploadField kind="video-thumbnail" url={draft.thumbnailUrl} onUploaded={(r) => setDraft({ ...draft, thumbnailUrl: r.publicUrl, thumbnailUpload: undefined })} onRemove={() => setDraft({ ...draft, thumbnailUrl: undefined, thumbnailUpload: undefined })} /></div>
      </div>
      <div>
        <div className="mb-2 text-xs font-medium text-charcoal/70">{t('common.preview')}</div>
        <div className="flex gap-4 rounded-card border border-charcoal/10 bg-ivory/60 p-3">
          <ArtCover seed={draft.coverSeed} imageUrl={draft.thumbnailUpload?.previewUrl || draft.thumbnailUrl} className="h-24 w-40 shrink-0 rounded-control" />
          <div className="min-w-0"><div className="line-clamp-2 text-sm font-medium text-charcoal">{tr(draft.title) || '—'}</div><div className="mt-1 text-xs text-charcoal/55">{formatDuration(draft.durationSec)} · {draft.source.kind === 'link' ? t('channel.videoLink') : t('channel.uploadedFile')}</div><div className="mt-2 flex gap-1"><VisibilityBadge visibility={pub.visibility} /><StatusBadge status={pub.status} /></div></div>
        </div>
      </div>
      <PublishFields value={pub} onChange={setPub} teacherId={teacherId} mode="teacher" />
      {!perms.publishDirectly && <Notice tone="info" className="text-xs">{t('studio.reviewNote')}</Notice>}
      <div className="flex justify-end gap-2 border-t border-charcoal/10 pt-4"><Button variant="ghost" onClick={onCancel}>{t('common.cancel')}</Button><Button disabled={saving} onClick={() => void save()}>{t('common.save')}</Button></div>
    </div>
  )
}
