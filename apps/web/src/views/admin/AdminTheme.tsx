import { Button, Card, Eyebrow, Field, Icon, Input, LField, Notice, PageTitle, Segmented, Select, Toggle } from '../../components/ui'
import { cx } from '../../components/ui/helpers'
import { useT } from '../../i18n/useT'
import { emptyL } from '../../i18n/useT'
import { uid, useStore } from '../../store/useStore'
import type { BodyFont, DisplayFont, Theme } from '../../types'

const COLOR_KEYS = ['ivory', 'forest', 'charcoal', 'champagne', 'sage', 'white'] as const

export function AdminTheme() {
  const { t, tr } = useT()
  const site = useStore((s) => s.site)
  const patchSite = useStore((s) => s.patchSite)
  const restoreThemeDefaults = useStore((s) => s.restoreThemeDefaults)
  const notify = useStore((s) => s.notify)
  const theme = site.theme
  const setTheme = (patch: Partial<Theme>) => patchSite((s) => ({ ...s, theme: { ...s.theme, ...patch } }))
  const setColor = (k: (typeof COLOR_KEYS)[number], v: string) => setTheme({ colors: { ...theme.colors, [k]: v } })
  const setBrand = (patch: Partial<typeof site.brand>) => patchSite((s) => ({ ...s, brand: { ...s.brand, ...patch } }))
  const nav = site.nav
  const setNav = (list: typeof nav) => patchSite((s) => ({ ...s, nav: list }))
  const moveNav = (i: number, d: -1 | 1) => { const list = [...nav]; const j = i + d; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; setNav(list) }

  return (
    <div>
      <PageTitle eyebrow={t('dash.admin')} title={t('admin.theme')} subtitle={t('admin.theme.hint')} action={<Button variant="secondary" onClick={() => { restoreThemeDefaults(); notify(t('common.saved')) }}><Icon name="refresh" className="h-4 w-4" />{t('common.restoreDefaults')}</Button>} />
      <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
        <Card>
          <Eyebrow className="mb-4">{t('admin.theme.colors')}</Eyebrow>
          <div className="grid gap-3 sm:grid-cols-2">
            {COLOR_KEYS.map((k) => (
              <label key={k} className="flex items-center gap-3 rounded-control border border-charcoal/10 bg-ivory/50 p-2.5">
                <input type="color" aria-label={t(`color.${k}`)} value={theme.colors[k]} onChange={(e) => setColor(k, e.target.value)} className="h-9 w-9 cursor-pointer rounded-control border-0 bg-transparent p-0" />
                <span className="min-w-0 flex-1"><span className="block text-xs font-medium text-charcoal">{t(`color.${k}`)}</span><span className="block font-mono text-[11px] uppercase text-charcoal/50">{theme.colors[k]}</span></span>
              </label>
            ))}
          </div>
        </Card>
        <Card>
          <Eyebrow className="mb-4">{t('admin.theme.fonts')}</Eyebrow>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('admin.theme.display')}><Select value={theme.fonts.display} onChange={(e) => setTheme({ fonts: { ...theme.fonts, display: e.target.value as DisplayFont } })}><option>Prata</option><option>Cormorant Garamond</option><option>Playfair Display</option></Select></Field>
            <Field label={t('admin.theme.bodyFont')}><Select value={theme.fonts.body} onChange={(e) => setTheme({ fonts: { ...theme.fonts, body: e.target.value as BodyFont } })}><option>Inter</option><option>Manrope</option></Select></Field>
          </div>
          <div className="mt-4">
            <div className="mb-1.5 text-xs font-medium text-charcoal/70">{t('admin.theme.radius')}</div>
            <Segmented<Theme['radius']> value={theme.radius} onChange={(radius) => setTheme({ radius })} options={[{ id: 'sharp', label: t('radius.sharp') }, { id: 'soft', label: t('radius.soft') }, { id: 'round', label: t('radius.round') }]} />
          </div>
          <p className="mt-4 text-xs text-charcoal/50">{t('admin.theme.fontNote')}</p>
          <div className="mt-5 rounded-card border border-charcoal/10 bg-ivory p-5">
            <div className="eyebrow mb-2">{t('admin.theme.sample')}</div>
            <div className="font-display text-3xl text-charcoal">{tr(site.brand.heroHeadline)}</div>
            <p className="mt-2 text-sm text-charcoal/65">Özbekça · Ğğ Öö Şş Çç · Русский · English — 1 200 000 söm</p>
            <div className="mt-3 flex gap-2"><span className="rounded-control bg-forest px-3 py-1.5 text-xs text-ivory">{tr(site.brand.primaryCta)}</span><span className="rounded-control bg-champagne px-3 py-1.5 text-xs text-charcoal">Bazis</span></div>
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <Eyebrow className="mb-4">{t('admin.nav')}</Eyebrow>
          <div className="grid gap-5">
            <Field label={t('admin.brand.name')}><Input value={site.brand.name} onChange={(e) => setBrand({ name: e.target.value })} /></Field>
            <LField label={t('admin.brand.headline')} value={site.brand.heroHeadline} onChange={(v) => setBrand({ heroHeadline: v })} />
            <LField label={t('admin.brand.tagline')} value={site.brand.heroTagline} onChange={(v) => setBrand({ heroTagline: v })} />
            <LField label={t('admin.brand.cta')} value={site.brand.primaryCta} onChange={(v) => setBrand({ primaryCta: v })} />
            <LField label={t('admin.brand.city')} value={site.brand.city} onChange={(v) => setBrand({ city: v })} />
            <LField label={t('admin.brand.footer')} multiline value={site.brand.footerNote} onChange={(v) => setBrand({ footerNote: v })} />
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between"><Eyebrow>{t('admin.nav.items')}</Eyebrow><Button size="sm" variant="secondary" onClick={() => setNav([...nav, { id: uid('n'), label: emptyL(), path: '/courses', enabled: true }])}><Icon name="plus" className="h-3.5 w-3.5" />{t('common.add')}</Button></div>
          <p className="mb-4 text-xs text-charcoal/50">{t('admin.nav.hint')}</p>
          <ol className="space-y-2">
            {nav.map((n, i) => (
              <li key={n.id} className={cx('rounded-card border border-charcoal/10 bg-ivory/50 p-3', !n.enabled && 'opacity-60')}>
                <div className="grid items-end gap-3 md:grid-cols-[1fr_12rem_auto]">
                  <LField label={t('common.name')} value={n.label} onChange={(v) => setNav(nav.map((x) => (x.id === n.id ? { ...x, label: v } : x)))} />
                  <Field label={t('admin.nav.path')}><Select value={n.path} onChange={(e) => setNav(nav.map((x) => (x.id === n.id ? { ...x, path: e.target.value } : x)))}>{['/courses', '/teachers', '/builder', '/course-finder', '/how-it-works', '/centers', '/faq', '/preview'].map((p) => <option key={p} value={p}>{p}</option>)}</Select></Field>
                  <div className="flex items-center gap-1 pb-1">
                    <Toggle checked={n.enabled} onChange={(v) => setNav(nav.map((x) => (x.id === n.id ? { ...x, enabled: v } : x)))} />
                    <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => moveNav(i, -1)} aria-label={t('common.moveUp')}><Icon name="up" className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" disabled={i === nav.length - 1} onClick={() => moveNav(i, 1)} aria-label={t('common.moveDown')}><Icon name="down" className="h-4 w-4" /></Button>
                    <Button size="sm" variant="danger" onClick={() => setNav(nav.filter((x) => x.id !== n.id))} aria-label={t('common.delete')}><Icon name="trash" className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </Card>
        <Card className="lg:col-span-2">
          <Eyebrow className="mb-4">{t('admin.media')}</Eyebrow>
          <div className="grid gap-4 md:grid-cols-2">
            <Field label={t('admin.media.heroVideo')}><Input placeholder="/media/ilmora-commercial.mp4" value={site.media.heroVideoUrl} onChange={(e) => patchSite((s) => ({ ...s, media: { ...s.media, heroVideoUrl: e.target.value } }))} /></Field>
            <Field label={t('admin.media.heroPoster')}><Input placeholder="https://…" value={site.media.heroPosterUrl} onChange={(e) => patchSite((s) => ({ ...s, media: { ...s.media, heroPosterUrl: e.target.value } }))} /></Field>
            <Field label={t('admin.media.video')}><Input placeholder="/media/furniture-scroll.mp4" value={site.media.furnitureVideoUrl} onChange={(e) => patchSite((s) => ({ ...s, media: { ...s.media, furnitureVideoUrl: e.target.value } }))} /></Field>
            <Field label={t('admin.media.poster')}><Input placeholder="https://…" value={site.media.furniturePosterUrl} onChange={(e) => patchSite((s) => ({ ...s, media: { ...s.media, furniturePosterUrl: e.target.value } }))} /></Field>
          </div>
          <Notice tone="info" className="mt-4 text-xs">{t('admin.media.hint')}</Notice>
        </Card>
      </div>
    </div>
  )
}
