'use client'
import { useEffect, useMemo, useState } from 'react'
import type { MinistryInstitutionItemDto, PageDto } from '@ilmora/shared'
import { Badge, Button, Card, EmptyState, Field, Icon, Input, Notice, PageTitle, Select } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { apiErrorText } from '../../lib/apiErrors'
import { Link } from '../../lib/router'
import { useSearchParams } from '../../lib/routerHooks'
import { useIndustries, useRegions } from '../../services/registry'
import { INSTITUTION_TYPES, MINISTRY_INSTITUTION_STATUSES, ministry, OWNERSHIPS, type InstitutionsFilter } from '../../services/ministry'
import { Pager, StatusBadge } from './common'

const KEYS = ['q', 'status', 'type', 'ownership', 'regionId', 'industryId'] as const

/** The filter as the page address keeps it, so «back» from a card returns to the same list. */
function filterOf(sp: URLSearchParams): InstitutionsFilter {
  const pick = <T extends string>(v: string | null, allowed: readonly T[]) => (v && (allowed as readonly string[]).includes(v) ? (v as T) : '')
  return {
    q: sp.get('q') ?? '', status: pick(sp.get('status'), MINISTRY_INSTITUTION_STATUSES), type: pick(sp.get('type'), INSTITUTION_TYPES),
    ownership: pick(sp.get('ownership'), OWNERSHIPS), regionId: sp.get('regionId') ?? '', industryId: sp.get('industryId') ?? '',
    page: Math.max(1, Number(sp.get('page')) || 1),
  }
}

/** The ministry's registry of institutions (ТЗ 7.2): read-only, with search and filters; a row opens the institution's card. */
export function MinistryInstitutions() {
  const { t, tr, lang } = useT()
  const [sp, setSp] = useSearchParams()
  const filter = useMemo(() => filterOf(sp), [sp])
  const regions = useRegions()
  const industries = useIndustries()
  const [text, setText] = useState(filter.q)
  const [result, setResult] = useState<PageDto<MinistryInstitutionItemDto> | null>(null)
  const [error, setError] = useState<unknown>(null)

  useEffect(() => {
    let live = true
    ministry.institutions(filter).then((r) => { if (live) { setResult(r); setError(null) } }, (e) => { if (live) setError(e) })
    return () => { live = false }
  }, [filter])

  const update = (patch: Partial<InstitutionsFilter>) => {
    const next = { ...filter, page: 1, ...patch }
    const out: Record<string, string> = {}
    for (const k of KEYS) if (next[k].trim()) out[k] = next[k].trim()
    if (next.page > 1) out.page = String(next.page)
    setSp(out)
  }

  return (
    <div>
      <PageTitle eyebrow={t('dash.ministry')} title={t('min.inst.title')} subtitle={t('min.inst.hint')} />
      <Card className="mb-5">
        <form role="search" className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={(e) => { e.preventDefault(); update({ q: text }) }}>
          <Input aria-label={t('min.inst.search')} placeholder={t('min.inst.search')} value={text} maxLength={200} onChange={(e) => setText(e.target.value)} />
          <Button type="submit" variant="secondary"><Icon name="search" className="h-4 w-4" />{t('common.search')}</Button>
        </form>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label={t('common.status')}>
            <Select value={filter.status} onChange={(e) => update({ status: e.target.value as InstitutionsFilter['status'] })}>
              <option value="">{t('min.status.all')}</option>
              {MINISTRY_INSTITUTION_STATUSES.map((s) => <option key={s} value={s}>{t(`min.status.${s}`)}</option>)}
            </Select>
          </Field>
          <Field label={t('min.filter.type')}>
            <Select value={filter.type} onChange={(e) => update({ type: e.target.value as InstitutionsFilter['type'] })}>
              <option value="">{t('min.filter.allTypes')}</option>
              {INSTITUTION_TYPES.map((x) => <option key={x} value={x}>{t(`inst.type.${x}`)}</option>)}
            </Select>
          </Field>
          <Field label={t('min.filter.ownership')}>
            <Select value={filter.ownership} onChange={(e) => update({ ownership: e.target.value as InstitutionsFilter['ownership'] })}>
              <option value="">{t('min.filter.allOwnership')}</option>
              {OWNERSHIPS.map((x) => <option key={x} value={x}>{t(`min.own.${x}`)}</option>)}
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
        <ul className="space-y-2" aria-label={t('min.inst.title')}>
          {result.items.map((it) => (
            <li key={it.id}>
              <Link to={`/ministry/institutions/${it.id}`} className="block rounded-card border border-charcoal/10 bg-paper px-4 py-3 transition hover:border-forest/40 hover:shadow-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-forest">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-charcoal">{it.name}</div>
                    {it.nameRu && it.nameRu !== it.name && <div className="text-xs text-charcoal/55">{it.nameRu}</div>}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <StatusBadge status={it.status} />
                    {it.source === 'STUDENT' && <Badge tone="warn">{t('min.source.STUDENT')}</Badge>}
                    {it.official && <Badge tone="sage"><Icon name="check" className="h-3 w-3" />{t('min.official')}</Badge>}
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-charcoal/60">
                  <span>{t(`inst.type.${it.type}`)}{it.ownership ? ` · ${t(`min.own.${it.ownership}`)}` : ''}</span>
                  {(it.region || it.districtName) && <span><Icon name="pin" className="mr-0.5 inline h-3 w-3" />{[it.region ? tr(it.region.name) : null, it.districtName].filter(Boolean).join(', ')}</span>}
                  {it.stir && <span>{t('auth.org.stir')}: {it.stir}</span>}
                  <span>{t('min.inst.students', { n: it.students })}</span>
                  <span>{t('min.inst.directions', { n: it.directions })}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {result && <Pager page={result.page} total={result.total} pageSize={result.pageSize} onPage={(page) => update({ page })} />}
    </div>
  )
}
