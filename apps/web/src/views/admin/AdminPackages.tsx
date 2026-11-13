import { Button, Card, Field, Icon, Input, LField, Notice, PageTitle, Select, Toggle } from '../../components/ui'
import { cx } from '../../components/ui/helpers'
import { emptyL, useT } from '../../i18n/useT'
import { useStore } from '../../store/useStore'
import type { Package } from '../../types'
import { UniversityPackagesAdmin } from './UniversityPackages'

export function AdminPackages() {
  const { t, tr } = useT()
  const packages = useStore((s) => s.site.packages)
  const savePackage = useStore((s) => s.savePackage)
  const addPackage = useStore((s) => s.addPackage)
  const notify = useStore((s) => s.notify)
  // Each change is saved to the packages API (the id and code stay the same, so subscriptions keep pointing at the package).
  const up = (id: string, patch: Partial<Package>) => savePackage(id, patch)
  return (
    <div>
      <PageTitle eyebrow={t('dash.admin')} title={t('admin.packages')} subtitle={t('admin.packages.hint')} action={<Button onClick={async () => { await addPackage(); notify(t('common.saved')) }}><Icon name="plus" className="h-4 w-4" />{t('admin.packages.add')}</Button>} />
      <div className="grid gap-6 lg:grid-cols-2">
        {packages.map((p) => (
          <Card key={p.id} className={cx(!p.enabled && 'opacity-70')}>
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="font-display text-3xl text-charcoal">{tr(p.name) || '—'}</div>
              <div className="flex items-center gap-3"><Toggle checked={p.enabled} onChange={(v) => up(p.id, { enabled: v })} label={t('common.enabled')} /><span title={t('admin.packages.noDelete')}><Button size="sm" variant="danger" disabled aria-label={t('admin.packages.noDelete')}><Icon name="trash" className="h-3.5 w-3.5" /></Button></span></div>
            </div>
            <div className="space-y-4">
              <LField label={t('common.name')} value={p.name} onChange={(v) => up(p.id, { name: v })} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t('admin.packages.limit')}><Input type="number" min={1} max={6} value={p.maxCourses} onChange={(e) => up(p.id, { maxCourses: Math.max(1, Number(e.target.value)) })} /></Field>
                <div className="flex items-end pb-2"><Toggle checked={p.highlight} onChange={(v) => up(p.id, { highlight: v })} label={t('admin.packages.highlight')} /></div>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field label={t('admin.packages.accessKind')}>
                  <Select value={p.accessKind ?? 'PERIOD'} onChange={(e) => up(p.id, { accessKind: e.target.value as 'PERIOD' | 'LESSONS', ...(e.target.value === 'LESSONS' ? { lessonCount: p.lessonCount ?? 12 } : {}) })}>
                    <option value="PERIOD">{t('student.sub.kind.PERIOD')}</option>
                    <option value="LESSONS">{t('student.sub.kind.LESSONS')}</option>
                  </Select>
                </Field>
                {(p.accessKind ?? 'PERIOD') === 'PERIOD'
                  ? <Field label={t('admin.packages.periodDays')}><Input type="number" min={1} max={366} value={p.periodDays ?? ''} onChange={(e) => up(p.id, { periodDays: e.target.value === '' ? null : Math.max(1, Number(e.target.value)) })} /></Field>
                  : <Field label={t('admin.packages.lessonCount')}><Input type="number" min={1} max={500} value={p.lessonCount ?? ''} onChange={(e) => up(p.id, { lessonCount: Math.max(1, Number(e.target.value) || 1) })} /></Field>}
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
      <UniversityPackagesAdmin />
    </div>
  )
}
