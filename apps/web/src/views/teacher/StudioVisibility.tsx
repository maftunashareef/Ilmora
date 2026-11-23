import { useState } from 'react'
import { Link } from '@/lib/router'
import { StatusBadge, VisibilityBadge } from '../../components/course/badges'
import { Badge, Button, Card, Icon, Modal, Notice, PageTitle, Segmented, Select } from '../../components/ui'
import { VisibilityControl } from '../../components/VisibilityControl'
import { useT } from '../../i18n/useT'
import { useCurrentTeacher } from '../../store/selectors'
import { useStore, type ContentKind } from '../../store/useStore'
import type { Audience, Publishable, Status, Visibility } from '../../types'

type Row = Publishable & { id: string; kind: ContentKind; title: string; href: string }

export function StudioVisibility() {
  const { t, tr } = useT()
  const teacher = useCurrentTeacher()
  const s = useStore()
  const perms = s.site.permissions.teacher
  const [filter, setFilter] = useState<'all' | ContentKind>('all')
  const [audienceFor, setAudienceFor] = useState<Row | null>(null)
  if (!teacher) return null
  const rows: Row[] = [
    ...s.courses.filter((c) => c.teacherId === teacher.id).map((c) => ({ ...c, kind: 'course' as const, title: tr(c.title), href: `/courses/${c.id}` })),
    ...s.videos.filter((v) => v.teacherId === teacher.id).map((v) => ({ ...v, kind: 'video' as const, title: tr(v.title), href: `/videos/${v.id}` })),
    ...s.playlists.filter((p) => p.teacherId === teacher.id).map((p) => ({ ...p, kind: 'playlist' as const, title: tr(p.title), href: `/playlists/${p.id}` })),
    ...s.resources.filter((r) => r.teacherId === teacher.id).map((r) => ({ ...r, kind: 'resource' as const, title: tr(r.title), href: `/resources/${r.id}` })),
  ].filter((r) => filter === 'all' || r.kind === filter)
  const KIND_LABEL: Record<ContentKind, string> = { course: t('common.course'), video: t('common.video'), playlist: t('common.playlist'), resource: t('common.resource') }
  const setStatus = (r: Row, status: Status) => {
    // Ж17: never decide «review instead of publish» on switches that have not arrived yet (they read «off» until then).
    if (status === 'published' && s.permissionsStatus !== 'ready' && s.role !== 'admin') { s.notify(t('perm.notReady'), 'warn'); return }
    if (status === 'published' && !perms.publishDirectly) { s.setPublishable(r.kind, r.id, { status: 'draft', reviewRequested: true }); s.notify(t('studio.reviewPending'), 'warn'); return }
    s.setPublishable(r.kind, r.id, { status, reviewRequested: false })
  }
  return (
    <div>
      <PageTitle eyebrow={t('dash.teacherStudio')} title={t('studio.visibility')} subtitle={t('studio.visibility.hint')} />
      <div className="mb-4 grid gap-3 md:grid-cols-3">
        <Card className="p-4 text-xs text-charcoal/65"><div className="mb-1 flex items-center gap-1.5 font-medium text-charcoal"><Icon name="globe" className="h-3.5 w-3.5" />{t('vis.public')}</div>{t('vis.publicHint')}</Card>
        <Card className="p-4 text-xs text-charcoal/65"><div className="mb-1 flex items-center gap-1.5 font-medium text-charcoal"><Icon name="lock" className="h-3.5 w-3.5" />{t('vis.private')}</div>{t('vis.privateHint')}</Card>
        <Card className="p-4 text-xs text-charcoal/65"><div className="mb-1 font-medium text-charcoal">{t('status.draft')} / {t('status.archived')}</div>{t('status.draftHint')} {t('status.archivedHint')}</Card>
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented<'all' | ContentKind> size="sm" value={filter} onChange={setFilter} options={[{ id: 'all', label: t('common.all') }, { id: 'course', label: t('common.courses') }, { id: 'video', label: t('common.videos') }, { id: 'playlist', label: t('common.playlists') }, { id: 'resource', label: t('common.resources') }]} />
        <span className="text-xs text-charcoal/50">{rows.length}</span>
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-ivory/70 text-left text-[11px] uppercase tracking-wider text-charcoal/50"><tr><th className="px-4 py-3">{t('common.title')}</th><th className="px-3 py-3">{t('common.type')}</th><th className="px-3 py-3">{t('common.status')}</th><th className="px-3 py-3">{t('common.visibility')}</th><th className="px-3 py-3">{t('vis.audience')}</th></tr></thead>
          <tbody className="divide-y divide-charcoal/8">
            {rows.map((r) => (
              <tr key={`${r.kind}-${r.id}`} className="hover:bg-ivory/40">
                <td className="max-w-[18rem] px-4 py-2.5"><Link to={r.href} className="line-clamp-1 font-medium text-charcoal hover:text-forest">{r.title}</Link><div className="mt-1 flex gap-1"><StatusBadge status={r.status} /><VisibilityBadge visibility={r.visibility} />{r.reviewRequested && <Badge tone="warn">{t('studio.reviewPending')}</Badge>}</div></td>
                <td className="px-3 py-2.5"><Badge tone="muted">{KIND_LABEL[r.kind]}</Badge></td>
                <td className="px-3 py-2.5"><Select aria-label={t('common.status')} className="w-40 py-1.5 text-xs" value={r.status} onChange={(e) => setStatus(r, e.target.value as Status)}><option value="draft">{t('status.draft')}</option><option value="published">{perms.publishDirectly || r.status === 'published' ? t('status.published') : t('studio.submitReview')}</option><option value="archived">{t('status.archived')}</option></Select></td>
                <td className="px-3 py-2.5"><Select aria-label={t('common.visibility')} className="w-32 py-1.5 text-xs" value={r.visibility} onChange={(e) => s.setPublishable(r.kind, r.id, { visibility: e.target.value as Visibility, audience: e.target.value === 'public' ? { studentIds: [], groupIds: [] } : r.audience })}><option value="public">{t('vis.public')}</option><option value="private">{t('vis.private')}</option></Select></td>
                <td className="px-3 py-2.5">{r.visibility === 'private' ? <Button size="sm" variant={r.audience.groupIds.length + r.audience.studentIds.length ? 'ghost' : 'secondary'} onClick={() => setAudienceFor(r)}><Icon name="users" className="h-3.5 w-3.5" />{r.audience.groupIds.length + r.audience.studentIds.length || t('vis.noAudience')}</Button> : <span className="text-xs text-charcoal/40">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Notice tone="info" className="mt-4 text-xs">{t('vis.enrollmentNote')} {t('access.securityNote')}</Notice>
      <Modal open={!!audienceFor} onClose={() => setAudienceFor(null)} title={audienceFor?.title ?? ''}>
        {audienceFor && <VisibilityControl value="private" audience={audienceFor.audience} teacherId={teacher.id} onChange={(v: Visibility | null, a: Audience) => { s.setPublishable(audienceFor.kind, audienceFor.id, { visibility: v ?? 'private', audience: a }); setAudienceFor({ ...audienceFor, visibility: v ?? 'private', audience: a }) }} />}
      </Modal>
    </div>
  )
}
