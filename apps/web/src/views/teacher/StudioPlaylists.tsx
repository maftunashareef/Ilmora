import { useEffect, useState } from 'react'
import { Link } from '@/lib/router'
import { useSearchParams } from '@/lib/routerHooks'
import { StatusBadge, VisibilityBadge } from '../../components/course/badges'
import { PublishFields, type PublishDraft } from '../../components/PublishFields'
import { finalizePublish } from '../../components/publish'
import { ArtCover, Badge, Button, EmptyState, Icon, LField, Modal, PageTitle } from '../../components/ui'
import { cx } from '../../components/ui/helpers'
import { emptyL, useT } from '../../i18n/useT'
import { formatDuration } from '../../lib/format'
import { useCurrentTeacher } from '../../store/selectors'
import { uid, useStore } from '../../store/useStore'
import type { Playlist } from '../../types'

export function StudioPlaylists() {
  const { t, tr } = useT()
  const teacher = useCurrentTeacher()
  const [params, setParams] = useSearchParams()
  const playlists = useStore((s) => s.playlists.filter((p) => p.teacherId === teacher?.id))
  const videos = useStore((s) => s.videos.filter((v) => v.teacherId === teacher?.id))
  const { upsertPlaylist, removePlaylist, notify } = useStore()
  const perms = useStore((s) => s.site.permissions.teacher)
  const [editing, setEditing] = useState<Playlist | 'new' | null>(null)
  const [saving, setSaving] = useState(false)
  const [draft, setDraft] = useState<Playlist | null>(null)
  const [pub, setPub] = useState<PublishDraft>({ status: 'draft', visibility: null, audience: { studentIds: [], groupIds: [] } })
  useEffect(() => { if (params.get('new')) { open('new'); setParams({}, { replace: true }) } }, [params]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!teacher) return null

  function open(p: Playlist | 'new') {
    const d: Playlist = p === 'new' ? { id: uid('pl'), teacherId: teacher!.id, title: emptyL(), description: emptyL(), videoIds: [], coverSeed: Math.floor(Math.random() * 60), status: 'draft', visibility: 'public', audience: { studentIds: [], groupIds: [] }, featured: false, updatedAt: new Date().toISOString() } : p
    setDraft(d)
    setPub({ status: d.status, visibility: p === 'new' ? null : d.visibility, audience: d.audience })
    setEditing(p)
  }
  const save = async () => {
    if (!draft || saving) return
    if (!draft.title.uz && !draft.title.en && !draft.title.ru) { notify(`${t('common.title')}: ${t('common.required')}`, 'warn'); return }
    const r = finalizePublish(pub, 'teacher', perms)
    if (!r.ok) { notify(t(r.error), 'warn'); return }
    setSaving(true)
    // «Сохранено» only after the server has kept it; on an error the store shows it and the form keeps what was typed (М11).
    try {
      await upsertPlaylist({ ...draft, ...r.patch })
      setEditing(null); notify(t('common.saved')); if (r.note) notify(t(r.note), 'warn')
    } catch { /* shown by the store */ } finally { setSaving(false) }
  }
  const move = (i: number, d: -1 | 1) => { if (!draft) return; const list = [...draft.videoIds]; const j = i + d; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; setDraft({ ...draft, videoIds: list }) }

  return (
    <div>
      <PageTitle eyebrow={t('dash.teacherStudio')} title={t('studio.playlists')} action={<Button onClick={() => open('new')}><Icon name="plus" className="h-4 w-4" />{t('studio.newPlaylist')}</Button>} />
      {playlists.length === 0 ? <EmptyState title={t('common.empty')} /> : (
        <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {playlists.map((p) => (
            <li key={p.id} className="card overflow-hidden p-0">
              <Link to={`/playlists/${p.id}`} className="relative block"><ArtCover seed={p.coverSeed} className="aspect-video w-full" /><span className="absolute inset-y-0 right-0 flex w-20 flex-col items-center justify-center bg-charcoal/70 text-ivory"><Icon name="list" className="h-5 w-5" /><span className="text-[11px]">{p.videoIds.length}</span></span></Link>
              <div className="p-3.5">
                <Link to={`/playlists/${p.id}`} className="font-medium text-charcoal hover:text-forest">{tr(p.title)}</Link>
                <div className="mt-1.5 flex flex-wrap gap-1"><StatusBadge status={p.status} /><VisibilityBadge visibility={p.visibility} />{p.reviewRequested && <Badge tone="warn">{t('studio.reviewPending')}</Badge>}</div>
                <div className="mt-3 flex gap-1"><Button size="sm" variant="secondary" onClick={() => open(p)}><Icon name="edit" className="h-3.5 w-3.5" />{t('common.edit')}</Button><Button size="sm" variant="ghost" aria-label={t('common.delete')} onClick={() => { if (confirm(t('common.confirmDelete'))) removePlaylist(p.id) }}><Icon name="trash" className="h-3.5 w-3.5" /></Button></div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <Modal wide open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? t('studio.newPlaylist') : draft ? tr(draft.title) : ''} footer={<><Button variant="ghost" onClick={() => setEditing(null)}>{t('common.cancel')}</Button><Button disabled={saving} onClick={() => void save()}>{t('common.save')}</Button></>}>
        {draft && (
          <div className="space-y-6">
            <LField label={t('common.title')} required value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} />
            <LField label={t('common.description')} multiline value={draft.description} onChange={(v) => setDraft({ ...draft, description: v })} />
            <div>
              <div className="mb-2 text-sm font-medium text-charcoal">{t('studio.selectVideos')} · {draft.videoIds.length}</div>
              <div className="grid gap-4 md:grid-cols-2">
                <ul className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
                  {videos.map((v) => {
                    const on = draft.videoIds.includes(v.id)
                    return (
                      <li key={v.id}>
                        <label className={cx('flex cursor-pointer items-center gap-3 rounded-control border p-2 text-sm', on ? 'border-forest bg-sage/40' : 'border-charcoal/10 hover:border-forest/40')}>
                          <input type="checkbox" className="accent-forest" checked={on} onChange={() => setDraft({ ...draft, videoIds: on ? draft.videoIds.filter((x) => x !== v.id) : [...draft.videoIds, v.id] })} />
                          <ArtCover seed={v.coverSeed} imageUrl={v.thumbnailUpload?.previewUrl || v.thumbnailUrl} className="h-9 w-14 shrink-0 rounded-[6px]" />
                          <span className="min-w-0 flex-1"><span className="line-clamp-1">{tr(v.title)}</span><span className="text-[11px] text-charcoal/50">{formatDuration(v.durationSec)} · {t(`status.${v.status}`)} · {t(`vis.${v.visibility}`)}</span></span>
                        </label>
                      </li>
                    )
                  })}
                  {videos.length === 0 && <li className="text-xs text-charcoal/50">{t('common.empty')}</li>}
                </ul>
                <ol className="space-y-1.5 rounded-card border border-charcoal/10 bg-ivory/50 p-3">
                  <div className="eyebrow mb-1">{t('channel.inPlaylist')}</div>
                  {draft.videoIds.map((id, i) => { const v = videos.find((x) => x.id === id); if (!v) return null; return (
                    <li key={id} className="flex items-center gap-2 rounded-control bg-paper px-2 py-1.5 text-xs"><span className="w-4 text-charcoal/40">{i + 1}</span><span className="min-w-0 flex-1 truncate">{tr(v.title)}</span><Button size="sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('common.moveUp')}><Icon name="up" className="h-3.5 w-3.5" /></Button><Button size="sm" variant="ghost" disabled={i === draft.videoIds.length - 1} onClick={() => move(i, 1)} aria-label={t('common.moveDown')}><Icon name="down" className="h-3.5 w-3.5" /></Button></li>
                  ) })}
                  {draft.videoIds.length === 0 && <li className="text-xs text-charcoal/45">{t('common.empty')}</li>}
                </ol>
              </div>
            </div>
            <PublishFields value={pub} onChange={setPub} teacherId={teacher.id} mode="teacher" />
          </div>
        )}
      </Modal>
    </div>
  )
}
