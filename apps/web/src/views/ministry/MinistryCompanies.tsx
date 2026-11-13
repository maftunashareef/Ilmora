'use client'
import { useEffect, useMemo, useState } from 'react'
import type { MinistryCompanyItemDto, PageDto } from '@ilmora/shared'
import { Badge, Button, Card, EmptyState, Field, Icon, Input, Notice, PageTitle, Select } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { apiErrorText } from '../../lib/apiErrors'
import { useSearchParams } from '../../lib/routerHooks'
import { useIndustries, useRegions } from '../../services/registry'
import { MINISTRY_COMPANY_STATUSES, ministry, type CompaniesFilter } from '../../services/ministry'
import { Pager, StatusBadge } from './common'

const KEYS = ['q', 'status', 'regionId', 'industryId'] as const

function filterOf(sp: URLSearchParams): CompaniesFilter {
  const status = sp.get('status')
  return {
    q: sp.get('q') ?? '', status: status && (MINISTRY_COMPANY_STATUSES as readonly string[]).includes(status) ? (status as CompaniesFilter['status']) : '',
    regionId: sp.get('regionId') ?? '', industryId: sp.get('industryId') ?? '', page: Math.max(1, Number(sp.get('page')) || 1),
  }
}

/** The ministry's registry of companies (ТЗ 7.2): read-only, with search by name or STIR, industry, region and status. */
export function MinistryCompanies() {
  const { t, tr, lang } = useT()
  const [sp, setSp] = useSearchParams()
  const filter = useMemo(() => filterOf(sp), [sp])
  const regions = useRegions()
  const industries = useIndustries()
  const [text, setText] = useState(filter.q)
  const [result, setResult] = useState<PageDto<MinistryCompanyItemDto> | null>(null)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    let live = true
    ministry.companies(filter).then((r) => { if (live) { setResult(r); setError(null) } }, (e) => { if (live) setError(e) })
    return () => { live = false }
  }, [filter])

  const update = (patch: Partial<CompaniesFilter>) => {
    const next = { ...filter, page: 1, ...patch }
    const out: Record<string, string> = {}
    for (const k of KEYS) if (next[k].trim()) out[k] = next[k].trim()
    if (next.page > 1) out.page = String(next.page)
    setSp(out)
  }

  return (
    <div>
      <PageTitle eyebrow={t('dash.ministry')} title={t('min.comp.title')} subtitle={t('min.comp.hint')} />
      <Card className="mb-5">
        <form role="search" className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={(e) => { e.preventDefault(); update({ q: text }) }}>
          <Input aria-label={t('min.comp.search')} placeholder={t('min.comp.search')} value={text} maxLength={200} onChange={(e) => setText(e.target.value)} />
          <Button type="submit" variant="secondary"><Icon name="search" className="h-4 w-4" />{t('common.search')}</Button>
        </form>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label={t('common.status')}>
            <Select value={filter.status} onChange={(e) => update({ status: e.target.value as CompaniesFilter['status'] })}>
              <option value="">{t('min.status.all')}</option>
              {MINISTRY_COMPANY_STATUSES.map((s) => <option key={s} value={s}>{t(`min.status.${s}`)}</option>)}
            </Select>
          </Field>
          <Field label={t('min.filter.region')}>
            <Select value={filter.regionId} onChange={(e) => update({ regionId: e.target.value })}>
              <option value="">{t('min.filter.allRegions')}</option>
              {regions.map((r) => <option key={r.id} value={r.id}>{tr(r.name)}</option>)}
            </Select>
          </Field>
          <Field label={t('min.filter.industry')}>
            <Select value={filter.industryId} onChange={(e) => update({ industryId: e.target.value })}>
              <option value="">{t('min.filter.allIndustries')}</option>
              {industries.list.map((i) => <option key={i.id} value={i.id}>{tr(i.name)}</option>)}
            </Select>
          </Field>
        </div>
      </Card>

      {error != null && <Notice tone="warn" className="mb-3">{apiErrorText(error, lang)}</Notice>}
      {!result && error == null && <p className="text-sm text-charcoal/55" role="status">{t('common.loading')}</p>}
      {result && <p className="mb-2 text-xs text-charcoal/55" role="status">{t('rev.found', { n: result.total })}</p>}
      {result && result.items.length === 0 && <EmptyState icon={<Icon name="search" className="h-6 w-6" />} title={t('rev.nothingFound')} />}
      {result && result.items.length > 0 && (
        <ul className="space-y-2" aria-label={t('min.comp.title')}>
          {result.items.map((c) => (
            <li key={c.id} className="rounded-card border border-charcoal/10 bg-paper px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="font-medium text-charcoal">{c.name}</div>
                <StatusBadge status={c.status} />
              </div>
              <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-charcoal/60">
                <span>{t('auth.org.stir')}: {c.stir}</span>
                {c.region && <span><Icon name="pin" className="mr-0.5 inline h-3 w-3" />{tr(c.region.name)}</span>}
              </div>
              {c.industries.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{c.industries.map((i) => <Badge key={i.id} tone="sage">{tr(i.name)}</Badge>)}</div>}
            </li>
          ))}
        </ul>
      )}
      {result && <Pager page={result.page} total={result.total} pageSize={result.pageSize} onPage={(page) => update({ page })} />}
    </div>
  )
}
