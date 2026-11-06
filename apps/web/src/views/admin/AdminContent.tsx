import { useState } from 'react'
import { Link } from '@/lib/router'
import { Badge, Button, Card, Eyebrow, Icon, Modal, PageTitle, Segmented, Select, Toggle } from '../../components/ui'
import { VisibilityControl } from '../../components/VisibilityControl'
import { useT } from '../../i18n/useT'
import { siteHref } from '../../lib/siteUrl'
import { useStore, type ContentKind } from '../../store/useStore'
import type { Audience, Publishable, Status, Visibility } from '../../types'

type Row = Publishable & { id: string; teacherId: string; kind: ContentKind; title: string; href: string }

export function AdminContent() {
  const { t, tr, lang } = useT()
  const s = useStore()
  const [filter, setFilter] = useState<'all' | ContentKind>('all')
  const [audienceFor, setAudienceFor] = useState<Row | null>(null)
  const rows: Row[] = [
    ...s.courses.map((c) => ({ ...c, kind: 'course' as const, title: tr(c.title), href: `/courses/${c.id}` })),
    ...s.videos.map((v) => ({ ...v, kind: 'video' as const, title: tr(v.title), href: `/videos/${v.id}` })),
    ...s.playlists.map((p) => ({ ...p, kind: 'playlist' as const, title: tr(p.title), href: `/playlists/${p.id}` })),
    ...s.resources.map((r) => ({ ...r, kind: 'resource' as const, title: tr(r.title), href: `/resources/${r.id}` })),
  ]
  const review = rows.filter((r) => r.reviewRequested)
  const list = rows.filter((r) => filter === 'all' || r.kind === filter).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const KIND_LABEL: Record<ContentKind, string> = { course: t('common.course'), video: t('common.video'), playlist: t('common.playlist'), resource: t('common.resource') }

  return (
    <div>
      <PageTitle eyebrow={t('dash.admin')} title={t('admin.content')} subtitle={t('admin.content.hint')} />
      {review.length > 0 && (
        <Card className="mb-6 border-amber-200 bg-amber-50/50">
          <Eyebrow className="mb-3 text-amber-800">{t('admin.reviewQueue')} · {review.length}</Eyebrow>
          <ul className="space-y-2">
            {review.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-control bg-paper p-3">
                <Badge tone="muted">{KIND_LABEL[r.kind]}</Badge>
                <a href={siteHref(lang, r.href)} className="min-w-0 flex-1 truncate text-sm font-medium text-charcoal hover:text-forest">{r.title}</a>
                <span className="text-xs text-charcoal/55">{s.teachers.find((x) => x.id === r.teacherId)?.name}</span>
                <Button size="sm" onClick={() => { s.setPublishable(r.kind, r.id, { status: 'published', reviewRequested: false }); s.notify(t('common.saved')) }}><Icon name="check" className="h-3.5 w-3.5" />{t('admin.approve')}</Button>
                <Button size="sm" variant="ghost" onClick={() => s.setPublishable(r.kind, r.id, { reviewRequested: false })}>{t('common.cancel')}</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Segmented<'all' | ContentKind> size="sm" value={filter} onChange={setFilter} options={[{ id: 'all', label: t('common.all') }, { id: 'course', label: t('common.courses') }, { id: 'video', label: t('common.videos') }, { id: 'playlist', label: t('common.playlists') }, { id: 'resource', label: t('common.resources') }]} />
        <span className="text-xs text-charcoal/50">{list.length}</span>
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="bg-ivory/70 text-left text-[11px] uppercase tracking-wider text-charcoal/50">
            <tr><th className="px-4 py-3">{t('common.title')}</th><th className="px-3 py-3">{t('common.type')}</th><th className="px-3 py-3">{t('admin.content.owner')}</th><th className="px-3 py-3">{t('common.status')}</th><th className="px-3 py-3">{t('common.visibility')}</th><th className="px-3 py-3">{t('vis.audience')}</th><th className="px-3 py-3">{t('common.featured')}</th></tr>
          </thead>
          <tbody className="divide-y divide-charcoal/8">
            {list.map((r) => (
              <tr key={`${r.kind}-${r.id}`} className="align-middle hover:bg-ivory/40">
                <td className="max-w-[16rem] px-4 py-2.5"><Link to={r.href} className="line-clamp-1 font-medium text-charcoal hover:text-forest">{r.title}</Link></td>
                <td className="px-3 py-2.5"><Badge tone="muted">{KIND_LABEL[r.kind]}</Badge></td>
                <td className="px-3 py-2.5 text-xs text-charcoal/65">{s.teachers.find((x) => x.id === r.teacherId)?.name}</td>
                <td className="px-3 py-2.5"><Select aria-label={t('common.status')} className="w-36 py-1.5 text-xs" value={r.status} onChange={(e) => s.setPublishable(r.kind, r.id, { status: e.target.value as Status, reviewRequested: false })}>{(['draft', 'published', 'archived'] as Status[]).map((st) => <option key={st} value={st}>{t(`status.${st}`)}</option>)}</Select></td>
                <td className="px-3 py-2.5"><Select aria-label={t('common.visibility')} className="w-32 py-1.5 text-xs" value={r.visibility} onChange={(e) => s.setPublishable(r.kind, r.id, { visibility: e.target.value as Visibility })}><option value="public">{t('vis.public')}</option><option value="private">{t('vis.private')}</option></Select></td>
                <td className="px-3 py-2.5">{r.visibility === 'private' ? <Button size="sm" variant="ghost" onClick={() => setAudienceFor(r)}><Icon name="users" className="h-3.5 w-3.5" />{r.audience.groupIds.length + r.audience.studentIds.length}</Button> : <span className="text-xs text-charcoal/40">—</span>}</td>
                <td className="px-3 py-2.5"><Toggle checked={r.featured} onChange={(v) => s.setPublishable(r.kind, r.id, { featured: v })} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Modal open={!!audienceFor} onClose={() => setAudienceFor(null)} title={audienceFor?.title ?? ''}>
        {audienceFor && <VisibilityControl value="private" audience={audienceFor.audience} teacherId={audienceFor.teacherId} showEnrollmentNote={false} onChange={(v: Visibility | null, a: Audience) => { s.setPublishable(audienceFor.kind, audienceFor.id, { visibility: v ?? 'private', audience: a }); setAudienceFor({ ...audienceFor, visibility: v ?? 'private', audience: a }) }} />}
      </Modal>
    </div>
  )
}
