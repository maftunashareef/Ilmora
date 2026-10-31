import { useState } from 'react'
import { Link } from '@/lib/router'
import { Badge, Button, Card, cx, Field, Icon, Input, LField, Notice, PageTitle, Segmented, Select, Toggle } from '../../components/ui'
import { emptyL, useT } from '../../i18n/useT'
import { uid, useStore, type PageKey } from '../../store/useStore'
import type { Section, SectionType } from '../../types'

const PAGE_PATH: Record<PageKey, string> = { home: '/', howItWorks: '/how-it-works', centers: '/centers' }
const TYPES: SectionType[] = ['hero', 'discounts', 'marquee', 'packages', 'featuredCourses', 'categories', 'howItWorks', 'steps', 'studio3d', 'furnitureStory', 'teachers', 'centers', 'faq', 'centerCta', 'announcement', 'richText', 'inquiryForm', 'courseFinder', 'journey']
const HAS_ITEMS: SectionType[] = ['howItWorks', 'steps']
const HAS_COUNT: SectionType[] = ['featuredCourses', 'discounts', 'teachers', 'faq']
const HAS_BODY: SectionType[] = ['richText']

export function AdminPages() {
  const { t, tr } = useT()
  const [page, setPage] = useState<PageKey>('home')
  const sections = useStore((s) => s.site.pages[page])
  const { updateSection, moveSection, addSection, removeSection, restorePageDefaults, notify } = useStore()
  const [openId, setOpenId] = useState<string | null>(null)
  const [newType, setNewType] = useState<SectionType>('richText')

  return (
    <div>
      <PageTitle eyebrow={t('dash.admin')} title={t('admin.pages')} subtitle={t('admin.pages.hint')} action={
        <>
          <Link to={PAGE_PATH[page]} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 rounded-control border border-charcoal/15 px-4 py-2.5 text-sm font-medium hover:border-forest/50">{t('admin.pages.openPage')} <Icon name="external" className="h-3.5 w-3.5" /></Link>
          <Button variant="secondary" onClick={() => { if (confirm(t('admin.pages.restoreConfirm'))) { restorePageDefaults(page); notify(t('common.saved')) } }}><Icon name="refresh" className="h-4 w-4" />{t('common.restoreDefaults')}</Button>
        </>
      } />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium text-charcoal/60">{t('admin.pages.which')}</span>
        <Segmented<PageKey> value={page} onChange={(p) => { setPage(p); setOpenId(null) }} options={[{ id: 'home', label: t('admin.pages.home') }, { id: 'howItWorks', label: t('admin.pages.how') }, { id: 'centers', label: t('admin.pages.centers') }]} />
      </div>
      <ol className="space-y-2">
        {sections.map((sec, i) => {
          const open = openId === sec.id
          return (
            <li key={sec.id} className={cx('card p-0 transition', !sec.enabled && 'opacity-60')}>
              <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="w-6 text-center font-display text-lg text-champagne">{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-medium text-charcoal">{tr(sec.title) || <span className="text-charcoal/40">—</span>}</span><Badge tone="muted">{sec.type}</Badge></div>
                  {tr(sec.subtitle) && <div className="mt-0.5 truncate text-xs text-charcoal/50">{tr(sec.subtitle)}</div>}
                </div>
                <Toggle checked={sec.enabled} onChange={(v) => updateSection(page, sec.id, { enabled: v })} />
                <div className="flex items-center gap-0.5">
                  <Button size="sm" variant="ghost" aria-label={t('common.moveUp')} disabled={i === 0} onClick={() => moveSection(page, sec.id, -1)}><Icon name="up" className="h-4 w-4" /></Button>
                  <Button size="sm" variant="ghost" aria-label={t('common.moveDown')} disabled={i === sections.length - 1} onClick={() => moveSection(page, sec.id, 1)}><Icon name="down" className="h-4 w-4" /></Button>
                  <Button size="sm" variant={open ? 'secondary' : 'ghost'} aria-expanded={open} onClick={() => setOpenId(open ? null : sec.id)}><Icon name="edit" className="h-4 w-4" />{t('common.edit')}</Button>
                </div>
              </div>
              {open && <SectionEditor page={page} sec={sec} onRemove={() => { if (confirm(t('common.confirmDelete'))) { removeSection(page, sec.id); setOpenId(null) } }} />}
            </li>
          )
        })}
      </ol>
      <Card className="mt-6 flex flex-wrap items-end gap-3">
        <Field label={t('admin.pages.sectionType')} className="min-w-56"><Select value={newType} onChange={(e) => setNewType(e.target.value as SectionType)}>{TYPES.map((tp) => <option key={tp} value={tp}>{tp}</option>)}</Select></Field>
        <Button onClick={() => { addSection(page, newType); notify(t('common.saved')) }}><Icon name="plus" className="h-4 w-4" />{t('admin.pages.addSection')}</Button>
        <p className="w-full text-xs text-charcoal/50">{t('admin.overview.templateNote')}</p>
      </Card>
    </div>
  )
}

function SectionEditor({ page, sec, onRemove }: { page: PageKey; sec: Section; onRemove: () => void }) {
  const { t } = useT()
  const updateSection = useStore((s) => s.updateSection)
  const up = (patch: Partial<Section>) => updateSection(page, sec.id, patch)
  const items = sec.items ?? []
  const upItem = (id: string, patch: Partial<NonNullable<Section['items']>[number]>) => up({ items: items.map((it) => (it.id === id ? { ...it, ...patch } : it)) })
  const move = (i: number, d: -1 | 1) => { const list = [...items]; const j = i + d; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; up({ items: list }) }
  return (
    <div className="animate-fade space-y-5 border-t border-charcoal/10 bg-ivory/50 px-5 py-5">
      {sec.type === 'hero' && <Notice tone="info">{t('admin.nav')}: {t('admin.brand.headline')} / {t('admin.brand.tagline')} / {t('admin.brand.cta')} → <Link to="/admin/theme" className="underline">{t('admin.theme')}</Link></Notice>}
      <LField label={t('common.title')} value={sec.title} onChange={(v) => up({ title: v })} />
      <LField label={t('common.subtitle')} multiline value={sec.subtitle} onChange={(v) => up({ subtitle: v })} />
      {HAS_BODY.includes(sec.type) && <LField label={t('common.body')} multiline value={sec.body ?? emptyL()} onChange={(v) => up({ body: v })} />}
      <div className="grid gap-4 sm:grid-cols-2">
        {HAS_COUNT.includes(sec.type) && <Field label={t('admin.pages.count')}><Input type="number" min={1} max={12} value={sec.count ?? 4} onChange={(e) => up({ count: Number(e.target.value) })} /></Field>}
        <Field label={t('common.imageUrl')} hint={t('common.optional')}><Input placeholder="https://…" value={sec.imageUrl ?? ''} onChange={(e) => up({ imageUrl: e.target.value || undefined })} /></Field>
      </div>
      {HAS_ITEMS.includes(sec.type) && (
        <div>
          <div className="mb-2 text-sm font-medium text-charcoal">{t('admin.pages.items')}</div>
          <ol className="space-y-3">
            {items.map((it, i) => (
              <li key={it.id} className="rounded-card border border-charcoal/10 bg-paper p-4">
                <div className="mb-3 flex items-center justify-between"><span className="font-display text-lg text-champagne">{String(i + 1).padStart(2, '0')}</span><div className="flex gap-0.5"><Button size="sm" variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('common.moveUp')}><Icon name="up" className="h-4 w-4" /></Button><Button size="sm" variant="ghost" disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label={t('common.moveDown')}><Icon name="down" className="h-4 w-4" /></Button><Button size="sm" variant="danger" onClick={() => up({ items: items.filter((x) => x.id !== it.id) })}><Icon name="trash" className="h-3.5 w-3.5" /></Button></div></div>
                <div className="space-y-3"><LField label={t('common.title')} value={it.title} onChange={(v) => upItem(it.id, { title: v })} /><LField label={t('common.body')} value={it.body} onChange={(v) => upItem(it.id, { body: v })} /></div>
              </li>
            ))}
          </ol>
          <Button size="sm" variant="secondary" className="mt-3" onClick={() => up({ items: [...items, { id: uid('it'), title: emptyL(), body: emptyL() }] })}><Icon name="plus" className="h-3.5 w-3.5" />{t('admin.pages.addItem')}</Button>
        </div>
      )}
      <div className="flex justify-between border-t border-charcoal/10 pt-4">
        <Button variant="danger" size="sm" onClick={onRemove}><Icon name="trash" className="h-3.5 w-3.5" />{t('common.delete')}</Button>
        <span className="text-xs text-charcoal/45">{t('common.saved')} ✓</span>
      </div>
    </div>
  )
}
