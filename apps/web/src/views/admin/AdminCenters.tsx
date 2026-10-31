import { useState } from 'react'
import { Button, Card, Eyebrow, Field, Icon, Input, LField, Modal, PageTitle } from '../../components/ui'
import { countLabel, NOUNS } from '@ilmora/shared'
import { emptyL, useT } from '../../i18n/useT'
import { uid, useStore } from '../../store/useStore'
import { CenterAdminsModal } from './CenterAdmins'
import type { Category, Center } from '../../types'

export function AdminCenters() {
  const { t, tr, lang } = useT()
  const s = useStore()
  const [center, setCenter] = useState<Center | null>(null)
  const [cat, setCat] = useState<Category | null>(null)
  const [adminsFor, setAdminsFor] = useState<Center | null>(null)
  const centerInUse = (id: string) => s.courses.some((c) => c.centerId === id) || s.teachers.some((x) => x.centerId === id)
  const catInUse = (id: string) => s.courses.some((c) => c.categoryId === id)
  return (
    <div>
      <PageTitle eyebrow={t('dash.admin')} title={t('admin.centers')} subtitle={t('centers.partnersNote')} />
      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <div className="mb-3 flex items-center justify-between"><Eyebrow>{t('common.centers')} · {s.centers.length}</Eyebrow><Button size="sm" onClick={() => setCenter({ id: uid('ce'), name: '', district: emptyL(), description: emptyL(), tone: '#163C35' })}><Icon name="plus" className="h-3.5 w-3.5" />{t('admin.centers.addCenter')}</Button></div>
          <ul className="space-y-2">
            {s.centers.map((c) => (
              <li key={c.id} className="card flex items-center gap-3 p-3">
                <span className="h-10 w-1.5 rounded-full" style={{ background: c.tone }} />
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-charcoal">{c.name}</div><div className="truncate text-xs text-charcoal/55">{tr(c.district)} · {countLabel(lang, s.courses.filter((x) => x.centerId === c.id).length, NOUNS.course)} · {countLabel(lang, s.teachers.filter((x) => x.centerId === c.id).length, NOUNS.teacher)}</div></div>
                <Button size="sm" variant="secondary" title={t('admin.centerAdmins')} aria-label={t('admin.centerAdmins')} onClick={() => setAdminsFor(c)}><Icon name="users" className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant="secondary" onClick={() => setCenter(c)}><Icon name="edit" className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant="danger" disabled={centerInUse(c.id)} title={centerInUse(c.id) ? t('admin.centers.inUse') : undefined} onClick={() => { if (confirm(t('common.confirmDelete'))) s.removeCenter(c.id) }}><Icon name="trash" className="h-3.5 w-3.5" /></Button>
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
                <Button size="sm" variant="secondary" onClick={() => setCat(c)}><Icon name="edit" className="h-3.5 w-3.5" /></Button>
                <Button size="sm" variant="danger" disabled={catInUse(c.id)} title={catInUse(c.id) ? t('admin.centers.inUse') : undefined} onClick={() => { if (confirm(t('common.confirmDelete'))) s.removeCategory(c.id) }}><Icon name="trash" className="h-3.5 w-3.5" /></Button>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <CenterAdminsModal center={adminsFor} onClose={() => setAdminsFor(null)} />
      <Modal open={!!center} onClose={() => setCenter(null)} title={center?.name || t('admin.centers.addCenter')} footer={<><Button variant="ghost" onClick={() => setCenter(null)}>{t('common.cancel')}</Button><Button onClick={() => { if (center?.name.trim()) { s.upsertCenter(center); setCenter(null); s.notify(t('common.saved')) } }}>{t('common.save')}</Button></>}>
        {center && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-[1fr_auto]"><Field label={t('common.name')} required><Input value={center.name} onChange={(e) => setCenter({ ...center, name: e.target.value })} /></Field><Field label={t('admin.centers.tone')}><input type="color" className="h-[42px] w-16 cursor-pointer rounded-control border border-charcoal/15 bg-paper" value={center.tone} onChange={(e) => setCenter({ ...center, tone: e.target.value })} /></Field></div>
            <LField label={t('admin.centers.district')} value={center.district} onChange={(v) => setCenter({ ...center, district: v })} />
            <LField label={t('common.description')} multiline value={center.description} onChange={(v) => setCenter({ ...center, description: v })} />
          </div>
        )}
      </Modal>
      <Modal open={!!cat} onClose={() => setCat(null)} title={cat ? tr(cat.name) || t('admin.centers.addCategory') : ''} footer={<><Button variant="ghost" onClick={() => setCat(null)}>{t('common.cancel')}</Button><Button onClick={() => { if (cat && (cat.name.uz || cat.name.en || cat.name.ru)) { s.upsertCategory(cat); setCat(null); s.notify(t('common.saved')) } }}>{t('common.save')}</Button></>}>
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
