'use client'
import { useState } from 'react'
import { Badge, Button, Card, Eyebrow, Field, Icon, Input, LField, LinkButton, Modal, Notice, PageTitle } from '../../components/ui'
import { countLabel, NOUNS } from '@ilmora/shared'
import { emptyL, useT } from '../../i18n/useT'
import { api, isApiError } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import { Link } from '../../lib/router'
import { uid, useStore } from '../../store/useStore'
import { CenterAdminsModal } from './CenterAdmins'
import { centerStatusTone, PendingCentersPanel, useAdminCenters, type AdminCenterRow } from './PendingCenters'
import type { Category, Center } from '../../types'

/** Super Admin: approval requests first, then every center with its status actions, editing and administrators; plus the categories. */
export function AdminCenters() {
  const { t, tr, lang } = useT()
  const s = useStore()
  const { list, busy: statusBusy, reload, setStatus, reviewName } = useAdminCenters()
  const [center, setCenter] = useState<Center | null>(null)
  const [cat, setCat] = useState<Category | null>(null)
  const [adminsFor, setAdminsFor] = useState<Center | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const notify = s.notify
  const busy = statusBusy ?? deleting

  const saveCenter = async () => {
    if (!center?.name.trim()) return
    try { await s.upsertCenter(center) } catch { return }
    setCenter(null)
    notify(t('common.saved'))
    await reload()
  }
  const removeCenter = async (c: AdminCenterRow) => {
    if (!confirm(t('common.confirmDelete'))) return
    setDeleting(c.id)
    try { await api(`/admin/centers/${c.id}`, { method: 'DELETE' }); await reload() } catch (err) { notify(isApiError(err) ? apiErrorText(err, lang) : String(err), 'warn') } finally { setDeleting(null) }
  }
  const catInUse = (id: string) => s.courses.some((c) => c.categoryId === id)
  const pending = list?.filter((c) => c.status === 'PENDING').length ?? 0

  return (
    <div>
      <PageTitle eyebrow={t('dash.admin')} title={t('admin.centers')} subtitle={t('centers.partnersNote')} />
      {pending > 0 && <Notice tone="warn" className="mb-4">{t('admin.centers.pendingCount', { n: pending })}</Notice>}
      <div className="mb-8"><PendingCentersPanel list={list} busy={busy} setStatus={setStatus} reviewName={reviewName} /></div>
      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <div className="mb-3 flex items-center justify-between"><Eyebrow>{t('common.centers')} · {list?.length ?? 0}</Eyebrow><Button size="sm" onClick={() => setCenter({ id: uid('ce'), name: '', district: emptyL(), description: emptyL(), tone: '#163C35' })}><Icon name="plus" className="h-3.5 w-3.5" />{t('admin.centers.addCenter')}</Button></div>
          <ul className="space-y-2">
            {(list ?? []).map((c) => (
              <li key={c.id} className="card p-3">
                <div className="flex items-center gap-3">
                  <span className="h-10 w-1.5 shrink-0 rounded-full" style={{ background: c.tone }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><Link to={`/admin/centers/${c.id}`} className="truncate text-sm font-medium text-charcoal hover:text-forest">{c.name}</Link><Badge tone={centerStatusTone(c.status)}>{t(`center.status.${c.status}`)}</Badge></div>
                    <div className="truncate text-xs text-charcoal/55">{tr(c.district)} · {countLabel(lang, c.counts.courses, NOUNS.course)} · {countLabel(lang, c.counts.teachers, NOUNS.teacher)}{c.owner ? ` · ${t('admin.centers.registeredBy', { name: c.owner.login ? `@${c.owner.login}` : c.owner.displayName })}` : ''}</div>
                    {c.blockReason && <div className="text-xs text-red-700">{c.blockReason}</div>}
                  </div>
                  <LinkButton size="sm" variant="secondary" to={`/admin/centers/${c.id}`}><Icon name="external" className="h-3.5 w-3.5" />{t('admin.centers.openDashboard')}</LinkButton>
                  <Button size="sm" variant="secondary" title={t('admin.centerAdmins')} aria-label={t('admin.centerAdmins')} onClick={() => setAdminsFor(c)}><Icon name="users" className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="secondary" onClick={() => setCenter(c)} aria-label={t('common.edit')}><Icon name="edit" className="h-3.5 w-3.5" /></Button>
                  <Button size="sm" variant="danger" disabled={busy === c.id || c.counts.courses + c.counts.teachers > 0} title={c.counts.courses + c.counts.teachers > 0 ? t('admin.centers.inUse') : undefined} onClick={() => void removeCenter(c)}><Icon name="trash" className="h-3.5 w-3.5" /></Button>
                </div>
                <div className="mt-2 flex flex-wrap gap-2 pl-5">
                  {c.status !== 'ACTIVE' && <Button size="sm" disabled={busy === c.id} onClick={() => void setStatus(c, 'ACTIVE')}><Icon name="check" className="h-3.5 w-3.5" />{c.status === 'BLOCKED' ? t('admin.centers.unblock') : t('admin.centers.approve')}</Button>}
                  {c.status === 'PENDING' && <Button size="sm" variant="danger" disabled={busy === c.id} onClick={() => void setStatus(c, 'REJECTED')}><Icon name="x" className="h-3.5 w-3.5" />{t('admin.centers.reject')}</Button>}
                  {c.status === 'ACTIVE' && <Button size="sm" variant="danger" disabled={busy === c.id} onClick={() => void setStatus(c, 'BLOCKED')}><Icon name="lock" className="h-3.5 w-3.5" />{t('admin.centers.block')}</Button>}
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section>
          <div className="mb-3 flex items-center justify-between"><Eyebrow>{t('common.categories')} · {s.categories.length}</Eyebrow><Button size="sm" onClick={() => setCat({ id: uid('cat'), name: emptyL(), glyph: '◇' })}><Icon name="plus" className="h-3.5 w-3.5" />{t('admin.centers.addCategory')}</Button></div>
          <ul className="space-y-2">
            {s.categories.map((c) => (
              <li key={c.id} className="card flex items-center gap-3 p-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-control bg-sage font-display text-xl text-forest">{c.glyph}</span>
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-charcoal">{tr(c.name)}</div><div className="text-xs text-charcoal/55">{countLabel(lang, s.courses.filter((x) => x.categoryId === c.id).length, NOUNS.course)}</div></div>
                <Button size="sm" variant="secondary" onClick={() => setCat(c)} aria-label={t('common.edit')}><Icon name="edit" className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant="danger" disabled={catInUse(c.id)} title={catInUse(c.id) ? t('admin.centers.inUse') : undefined} onClick={() => { if (confirm(t('common.confirmDelete'))) s.removeCategory(c.id) }} aria-label={t('common.delete')}><Icon name="trash" className="h-3.5 w-3.5" /></Button>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <CenterAdminsModal center={adminsFor} onClose={() => setAdminsFor(null)} />
      <Modal open={!!center} onClose={() => setCenter(null)} title={center?.name || t('admin.centers.addCenter')} footer={<><Button variant="ghost" onClick={() => setCenter(null)}>{t('common.cancel')}</Button><Button onClick={() => void saveCenter()}>{t('common.save')}</Button></>}>
        {center && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_auto]"><Field label={t('common.name')} required><Input value={center.name} onChange={(e) => setCenter({ ...center, name: e.target.value })} /></Field><Field label={t('admin.centers.tone')}><input type="color" className="h-[42px] w-16 cursor-pointer rounded-control border border-charcoal/15 bg-paper" value={center.tone} onChange={(e) => setCenter({ ...center, tone: e.target.value })} /></Field></div>
            <LField label={t('admin.centers.district')} value={center.district} onChange={(v) => setCenter({ ...center, district: v })} />
            <LField label={t('common.description')} multiline value={center.description} onChange={(v) => setCenter({ ...center, description: v })} />
          </div>
        )}
      </Modal>
      <Modal open={!!cat} onClose={() => setCat(null)} title={cat ? tr(cat.name) || t('admin.centers.addCategory') : ''} footer={<><Button variant="ghost" onClick={() => setCat(null)}>{t('common.cancel')}</Button><Button onClick={() => { if (cat && (cat.name.uz || cat.name.en || cat.name.ru)) { void s.upsertCategory(cat).then(() => { setCat(null); s.notify(t('common.saved')) }).catch(() => undefined) } }}>{t('common.save')}</Button></>}>
        {cat && (
          <div className="space-y-4">
            <LField label={t('common.name')} required value={cat.name} onChange={(v) => setCat({ ...cat, name: v })} />
            <Field label={t('admin.centers.glyph')} className="max-w-32"><Input maxLength={3} value={cat.glyph} onChange={(e) => setCat({ ...cat, glyph: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
      <Card className="mt-8 text-xs text-charcoal/55">{t('admin.overview.templateNote')}</Card>
    </div>
  )
}
