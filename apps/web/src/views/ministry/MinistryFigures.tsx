'use client'
import { useEffect, useState } from 'react'
import { formatDate, formatTime, type MinistryStatsDto, type MinistryTableKey, type StatsTableDto } from '@ilmora/shared'
import { Button, Card, Field, Icon, Notice, PageTitle, Select } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { REFRESH_LIMITED, isApiError } from '../../lib/api'
import { apiErrorText, retryMinutes } from '../../lib/apiErrors'
import {
  cellText, columnTotal, exportFileName, filterYears, formatCount, INSTITUTION_TYPES, ministry, NO_FIGURES_FILTER, OWNERSHIPS, saveBlob,
  type FiguresFilter,
} from '../../services/ministry'
import { useRegions } from '../../services/registry'
import { useStore } from '../../store/useStore'

/** Columns of the coverage table shown as tiles above the tables. */
const HEADLINE = ['inList', 'registered', 'coverage', 'approved'] as const

/** The ministry's figures (ТЗ 7.3): filters, the headline of the registry's coverage and every table with its Excel download. */
export function MinistryFigures() {
  const { t, tr, lang } = useT()
  const notify = useStore((s) => s.notify)
  const regions = useRegions()
  const [filter, setFilter] = useState<FiguresFilter>(NO_FIGURES_FILTER)
  const [data, setData] = useState<MinistryStatsDto | null>(null)
  const [error, setError] = useState<unknown>(null)
  // The filter the last answer (figures or error) is for: until it matches the current one, the figures are loading.
  const [answeredFor, setAnsweredFor] = useState<FiguresFilter | null>(null)
  const loading = answeredFor !== filter
  const [busy, setBusy] = useState<MinistryTableKey | null>(null)

  useEffect(() => {
    let live = true
    ministry.stats(filter).then(
      (d) => { if (live) { setData(d); setError(null); setAnsweredFor(filter) } },
      (e) => { if (live) { setError(e); setAnsweredFor(filter) } },
    )
    return () => { live = false }
  }, [filter])

  const set = <K extends keyof FiguresFilter>(k: K, v: FiguresFilter[K]) => setFilter((f) => ({ ...f, [k]: v }))
  const filtered = Object.values(filter).some(Boolean)

  const download = async (table: StatsTableDto) => {
    setBusy(table.key)
    try {
      saveBlob(await ministry.exportTable(table.key, lang, filter), exportFileName(table.key))
      notify(t('min.downloaded', { table: tr(table.title) }))
    } catch (e) {
      const m = isApiError(e) && e.code !== REFRESH_LIMITED ? retryMinutes(e) : null
      notify(isApiError(e) && e.status === 429 && e.code !== REFRESH_LIMITED ? (m ? t('min.downloadLimitedIn', { n: m }) : t('min.downloadLimited')) : apiErrorText(e, lang), 'warn')
    } finally {
      setBusy(null)
    }
  }

  const coverage = data?.tables.find((x) => x.key === 'coverage')
  const tables = data?.tables.filter((x) => x.key !== 'coverage') ?? []

  return (
    <div>
      <PageTitle eyebrow={t('dash.ministry')} title={t('min.figures.title')} subtitle={t('min.figures.hint')} />

      <Card className="mb-6">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('min.filter.region')}>
            <Select value={filter.regionId} onChange={(e) => set('regionId', e.target.value)}>
              <option value="">{t('min.filter.allRegions')}</option>
              {regions.map((r) => <option key={r.id} value={r.id}>{tr(r.name)}</option>)}
            </Select>
          </Field>
          <Field label={t('min.filter.type')}>
            <Select value={filter.type} onChange={(e) => set('type', e.target.value as FiguresFilter['type'])}>
              <option value="">{t('min.filter.allTypes')}</option>
              {INSTITUTION_TYPES.map((x) => <option key={x} value={x}>{t(`inst.type.${x}`)}</option>)}
            </Select>
          </Field>
          <Field label={t('min.filter.ownership')}>
            <Select value={filter.ownership} onChange={(e) => set('ownership', e.target.value as FiguresFilter['ownership'])}>
              <option value="">{t('min.filter.allOwnership')}</option>
              {OWNERSHIPS.map((x) => <option key={x} value={x}>{t(`min.own.${x}`)}</option>)}
            </Select>
          </Field>
          <Field label={t('min.filter.year')}>
            <Select value={filter.year} onChange={(e) => set('year', e.target.value)} aria-describedby="min-year-hint">
              <option value="">{t('min.filter.allYears')}</option>
              {filterYears().map((y) => <option key={y} value={y}>{y}</option>)}
            </Select>
            <p id="min-year-hint" className="mt-1 text-[11px] leading-snug text-charcoal/50">{t('min.filter.yearHint')}</p>
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-charcoal/55">
          <span role="status" aria-live="polite">
            {loading ? <><Icon name="refresh" className="mr-1 inline h-3.5 w-3.5 animate-spin" />{t('common.loading')}</>
              : data ? t('min.updated', { time: `${formatDate(data.generatedAt, lang)}, ${formatTime(data.generatedAt, lang)}` }) : null}
          </span>
          {filtered && <Button size="sm" variant="ghost" onClick={() => setFilter(NO_FIGURES_FILTER)}><Icon name="x" className="h-3.5 w-3.5" />{t('min.filter.reset')}</Button>}
        </div>
      </Card>

      {error != null && <Notice tone="warn" className="mb-6">{apiErrorText(error, lang)}</Notice>}

      {coverage && coverage.rows[0] && (
        <section aria-label={tr(coverage.title)} className="mb-6">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-display text-xl text-charcoal">{tr(coverage.title)}</h2>
            <ExcelButton table={coverage} busy={busy} onDownload={download} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {HEADLINE.map((key) => {
              const col = coverage.columns.find((c) => c.key === key)
              const v = coverage.rows[0][key]
              if (!col) return null
              return (
                <div key={key} className="rounded-card border border-charcoal/10 bg-paper p-4">
                  <div className="text-xs font-semibold uppercase tracking-wider text-charcoal/50">{tr(col.label)}</div>
                  <div className="mt-1.5 font-display text-3xl text-charcoal">{cellText(v, lang)}</div>
                </div>
              )
            })}
          </div>
          <p className="mt-2 text-xs text-charcoal/55">
            {coverage.columns.filter((c) => !(HEADLINE as readonly string[]).includes(c.key)).map((c) => `${tr(c.label)}: ${cellText(coverage.rows[0][c.key], lang)}`).join(' · ')}
          </p>
        </section>
      )}

      {tables.length > 0 && (
        <nav aria-label={t('min.tables')} className="mb-6 flex flex-wrap gap-1.5">
          {tables.map((x) => (
            <a key={x.key} href={`#min-${x.key}`} className="rounded-full border border-charcoal/12 bg-paper px-3 py-1 text-xs text-charcoal/70 transition hover:border-forest/40 hover:text-forest">{tr(x.title)}</a>
          ))}
        </nav>
      )}

      <div className="space-y-6">
        {tables.map((x) => <FiguresTable key={x.key} table={x} busy={busy} onDownload={download} />)}
      </div>
    </div>
  )
}

function ExcelButton({ table, busy, onDownload }: { table: StatsTableDto; busy: MinistryTableKey | null; onDownload: (t: StatsTableDto) => void }) {
  const { t, tr } = useT()
  const mine = busy === table.key
  return (
    <Button size="sm" variant="secondary" disabled={busy !== null} aria-label={t('min.excelLabel', { table: tr(table.title) })} onClick={() => onDownload(table)}>
      <Icon name={mine ? 'refresh' : 'download'} className={mine ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />{t('min.excel')}
    </Button>
  )
}

/** One table of figures: the API's column titles in the reader's language, numbers on the right, a total under grouped rows. */
function FiguresTable({ table, busy, onDownload }: { table: StatsTableDto; busy: MinistryTableKey | null; onDownload: (t: StatsTableDto) => void }) {
  const { t, tr, lang } = useT()
  const grouped = table.rows.length > 1 && !table.columns[0]?.numeric
  return (
    <section id={`min-${table.key}`} aria-labelledby={`min-${table.key}-title`} className="scroll-mt-24">
      <Card padded={false}>
        <div className="flex items-center justify-between gap-3 border-b border-charcoal/10 px-5 py-3.5">
          <h2 id={`min-${table.key}-title`} className="font-display text-lg leading-snug text-charcoal">{tr(table.title)}</h2>
          <ExcelButton table={table} busy={busy} onDownload={onDownload} />
        </div>
        {table.rows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-charcoal/55">{t('min.noRows')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="bg-sage/30 text-left text-xs text-charcoal/60">
                  {table.columns.map((c) => <th key={c.key} scope="col" className={`px-4 py-2.5 font-medium ${c.numeric && c.key !== 'year' ? 'text-right' : ''}`}>{tr(c.label)}</th>)}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r, i) => (
                  <tr key={i} className="border-t border-charcoal/8">
                    {table.columns.map((c, j) => {
                      const v = r[c.key]
                      const short = c.key === 'gap' && typeof v === 'number' && v > 0
                      const Cell = j === 0 ? 'th' : 'td'
                      return (
                        <Cell key={c.key} scope={j === 0 ? 'row' : undefined} className={`px-4 py-2 ${j === 0 ? 'font-medium text-charcoal' : 'text-charcoal/80'} ${c.numeric && c.key !== 'year' ? 'text-right tabular-nums' : 'text-left'} ${short ? 'font-semibold text-amber-800' : ''}`}>
                          {cellText(v, lang)}
                        </Cell>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
              {grouped && (
                <tfoot>
                  <tr className="border-t-2 border-charcoal/15 bg-paper font-semibold text-charcoal">
                    {table.columns.map((c, j) => {
                      const total = c.numeric ? columnTotal(table, c.key) : null
                      return j === 0
                        ? <th key={c.key} scope="row" className="px-4 py-2 text-left">{t('min.total')}</th>
                        : <td key={c.key} className="px-4 py-2 text-right tabular-nums">{total === null ? '' : formatCount(total, lang)}</td>
                    })}
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </Card>
    </section>
  )
}
