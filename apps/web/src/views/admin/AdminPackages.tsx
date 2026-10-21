import { Button, Card, cx, Field, Icon, Input, LField, Notice, PageTitle, Toggle } from '../../components/ui'
import { emptyL, useT } from '../../i18n/useT'
import { uid, useStore } from '../../store/useStore'
import type { Package } from '../../types'

export function AdminPackages() {
  const { t, tr } = useT()
  const packages = useStore((s) => s.site.packages)
  const patchSite = useStore((s) => s.patchSite)
  const notify = useStore((s) => s.notify)
  const setAll = (list: Package[]) => patchSite((s) => ({ ...s, packages: list }))
  const up = (id: string, patch: Partial<Package>) => setAll(packages.map((p) => (p.id === id ? { ...p, ...patch } : p)))
  return (
    <div>
      <PageTitle eyebrow={t('dash.admin')} title={t('admin.packages')} subtitle={t('admin.packages.hint')} action={<Button onClick={() => { setAll([...packages, { id: uid('pkg'), name: emptyL(), maxCourses: 4, description: emptyL(), perks: [], enabled: false, highlight: false }]); notify(t('common.saved')) }}><Icon name="plus" className="h-4 w-4" />{t('admin.packages.add')}</Button>} />
      <div className="grid gap-6 lg:grid-cols-2">
        {packages.map((p) => (
          <Card key={p.id} className={cx(!p.enabled && 'opacity-70')}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="font-display text-3xl text-charcoal">{tr(p.name) || '—'}</div>
              <div className="flex items-center gap-3"><Toggle checked={p.enabled} onChange={(v) => up(p.id, { enabled: v })} label={t('common.enabled')} /><Button size="sm" variant="danger" disabled={packages.length <= 1} onClick={() => { if (confirm(t('common.confirmDelete'))) setAll(packages.filter((x) => x.id !== p.id)) }}><Icon name="trash" className="h-3.5 w-3.5" /></Button></div>
            </div>
            <div className="space-y-4">
              <LField label={t('common.name')} value={p.name} onChange={(v) => up(p.id, { name: v })} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('admin.packages.limit')}><Input type="number" min={1} max={6} value={p.maxCourses} onChange={(e) => up(p.id, { maxCourses: Math.max(1, Number(e.target.value)) })} /></Field>
                <div className="flex items-end pb-2"><Toggle checked={p.highlight} onChange={(v) => up(p.id, { highlight: v })} label={t('admin.packages.highlight')} /></div>
              </div>
              <LField label={t('common.description')} value={p.description} onChange={(v) => up(p.id, { description: v })} />
              <div>
                <div className="mb-2 flex items-center justify-between text-xs font-medium text-charcoal/70"><span>{t('admin.packages.perks')}</span><Button size="sm" variant="ghost" onClick={() => up(p.id, { perks: [...p.perks, emptyL()] })}><Icon name="plus" className="h-3.5 w-3.5" />{t('common.add')}</Button></div>
                <div className="space-y-2">
                  {p.perks.map((perk, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <div className="flex-1"><LField label={`${i + 1}`} value={perk} onChange={(v) => up(p.id, { perks: p.perks.map((x, j) => (j === i ? v : x)) })} /></div>
                      <Button size="sm" variant="ghost" className="mt-6" aria-label={t('common.delete')} onClick={() => up(p.id, { perks: p.perks.filter((_, j) => j !== i) })}><Icon name="x" className="h-3.5 w-3.5" /></Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>
      <Notice tone="info" className="mt-6 text-xs">{t('builder.transparent')} {t('admin.packages.hint')}</Notice>
    </div>
  )
}
