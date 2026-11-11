'use client'
import { useEffect, useMemo, useState } from 'react'
import { formatDate, type IncomingTrainingRequestDto, type MatchStatus } from '@ilmora/shared'
import { Badge, Button, Card, EmptyState, Field, Icon, Input, Notice, PageTitle, Select, Tabs, Textarea } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { apiErrorText } from '../../lib/apiErrors'
import { institutionApi, offerYears } from '../../services/institutionCabinet'
import { useStore } from '../../store/useStore'
import { ClosedNotice, CompanyLine, Contacts } from './common'
import { usePassport } from './passportStore'

type Tab = 'incoming' | 'mine'
const TONE: Record<MatchStatus, 'champagne' | 'forest' | 'danger' | 'muted'> = { PENDING: 'champagne', ACCEPTED: 'forest', DECLINED: 'danger', WITHDRAWN: 'muted' }

/**
 * Companies' requests in the industries of the institution's fields of study (ТЗ 5.2): offer to train N people by a
 * year; the company's contacts open once it accepts. «Мои предложения» — every offer made, with its status.
 */
export function InstitutionRequests() {
  const { t, tr, lang } = useT()
  const { passport } = usePassport()
  const open = !!passport?.workspaceOpen
  const [tab, setTab] = useState<Tab>('incoming')
  const [industryId, setIndustryId] = useState('')
  const [answer, setAnswer] = useState<{ key: string; list?: IncomingTrainingRequestDto[]; error?: unknown } | null>(null)
  const [round, setRound] = useState(0)
  const key = `${tab}|${industryId}|${round}`

  // The industries of the institution's fields of study: requests come by them.
  const industries = useMemo(() => {
    const seen = new Map<string, NonNullable<typeof passport>['directions'][number]['direction']['industry']>()
    for (const d of passport?.directions ?? []) seen.set(d.direction.industry.id, d.direction.industry)
    return [...seen.values()]
  }, [passport])

  useEffect(() => {
    if (!open) return
    let live = true
    const load = tab === 'incoming' ? institutionApi.incoming(industryId || undefined) : institutionApi.myOffers()
    load.then((list) => { if (live) setAnswer({ key, list }) }, (error) => { if (live) setAnswer({ key, error }) })
    return () => { live = false }
  }, [open, tab, industryId, round, key])

  if (passport && !open) return <div><PageTitle eyebrow={t('dash.institution')} title={t('inst.r.title')} /><ClosedNotice /></div>
  const current = answer?.key === key ? answer : null

  return (
    <div>
      <PageTitle eyebrow={t('dash.institution')} title={t('inst.r.title')} subtitle={t('inst.r.hint')} />
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <Tabs value={tab} onChange={setTab} tabs={[{ id: 'incoming', label: t('inst.r.tab.incoming') }, { id: 'mine', label: t('inst.r.tab.mine') }]} />
        {tab === 'incoming' && industries.length > 1 && (
          <div className="w-full sm:w-64">
            <Select aria-label={t('min.filter.industry')} value={industryId} onChange={(e) => setIndustryId(e.target.value)}>
              <option value="">{t('min.filter.allIndustries')}</option>
              {industries.map((i) => <option key={i.id} value={i.id}>{tr(i.name)}</option>)}
            </Select>
          </div>
        )}
      </div>
      {passport && passport.directions.length === 0 && <Notice className="mb-4">{t('inst.r.noDirections')}</Notice>}
      {current?.error != null && <Notice tone="warn">{apiErrorText(current.error, lang)}</Notice>}
      {!current && <p className="text-sm text-charcoal/55" role="status">{t('common.loading')}</p>}
      {current?.list && current.list.length === 0 && <EmptyState icon={<Icon name="briefcase" className="h-6 w-6" />} title={t(tab === 'incoming' ? 'inst.r.empty' : 'inst.r.emptyMine')} />}
      {current?.list && current.list.length > 0 && (
        <ul className="space-y-3">
          {current.list.map((r) => <li key={r.id}><RequestCard request={r} onChanged={() => setRound((n) => n + 1)} /></li>)}
        </ul>
      )}
    </div>
  )
}

function RequestCard({ request: r, onChanged }: { request: IncomingTrainingRequestDto; onChanged: () => void }) {
  const { t, tr, lang } = useT()
  const notify = useStore((s) => s.notify)
  const years = offerYears()
  const [form, setForm] = useState<{ count: string; byYear: string; comment: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const count = Number(form?.count)
  const valid = !!form && Number.isInteger(count) && count >= 1 && count <= 10_000 && !!form.byYear

  const send = async () => {
    if (!form || !valid) return
    setBusy(true); setError(null)
    try { await institutionApi.offer(r.id, { count, byYear: Number(form.byYear), comment: form.comment }); notify(t('inst.r.sent')); setForm(null); onChanged() } catch (e) { setError(e) } finally { setBusy(false) }
  }
  const withdraw = async () => {
    if (!r.myOffer) return
    setBusy(true)
    try { await institutionApi.withdraw(r.myOffer.id); notify(t('inst.r.withdrawn')); onChanged() } catch (e) { notify(apiErrorText(e, lang), 'warn') } finally { setBusy(false) }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <CompanyLine company={r.company} />
        <span className="text-xs text-charcoal/50">{formatDate(r.createdAt, lang)}</span>
      </div>
      <div className="mt-3 rounded-control bg-ivory/70 px-3 py-2.5 text-sm">
        <div className="font-medium text-charcoal">{r.direction.name} <span className="font-normal text-charcoal/55">· {tr(r.direction.industry.name)}</span></div>
        <div className="mt-0.5 text-charcoal/75">{t('inst.r.need', { count: r.count, year: r.byYear })} · {r.region ? tr(r.region.name) : t('inst.r.anyRegion')}</div>
        {r.requirements && <p className="mt-1.5 whitespace-pre-line text-charcoal/70"><span className="text-charcoal/50">{t('inst.r.requirements')}:</span> {r.requirements}</p>}
      </div>

      {r.myOffer ? (
        <div className="mt-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={TONE[r.myOffer.status]}>{t(`inst.r.status.${r.myOffer.status}`)}</Badge>
            <span className="text-charcoal/75">{t('inst.r.myOffer', { count: r.myOffer.count, year: r.myOffer.byYear })}</span>
            {r.myOffer.status === 'PENDING' && <Button size="sm" variant="ghost" className="ml-auto text-red-800" disabled={busy} onClick={() => void withdraw()}>{t('inst.r.withdraw')}</Button>}
          </div>
          {r.myOffer.comment && <p className="mt-1 text-xs text-charcoal/60">«{r.myOffer.comment}»</p>}
          {r.myOffer.contacts && <Contacts contacts={r.myOffer.contacts} title={t('inst.r.contacts')} />}
        </div>
      ) : form ? (
        <div className="mt-4 grid gap-3 border-t border-charcoal/10 pt-4 sm:grid-cols-[8rem_10rem_minmax(0,1fr)]">
          <Field label={t('inst.r.offerCount')} required><Input inputMode="numeric" value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value.replace(/\D/g, '').slice(0, 5) })} /></Field>
          <Field label={t('inst.r.offerYear')} required>
            <Select value={form.byYear} onChange={(e) => setForm({ ...form, byYear: e.target.value })}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select>
          </Field>
          <Field label={t('inst.r.comment')}><Textarea rows={2} maxLength={1000} value={form.comment} onChange={(e) => setForm({ ...form, comment: e.target.value })} /></Field>
          {error != null && <Notice tone="warn" className="sm:col-span-3">{apiErrorText(error, lang)}</Notice>}
          <div className="flex justify-end gap-2 sm:col-span-3">
            <Button variant="ghost" onClick={() => { setForm(null); setError(null) }}>{t('common.cancel')}</Button>
            <Button disabled={busy || !valid} onClick={() => void send()}>{busy ? <Icon name="refresh" className="h-4 w-4 animate-spin" /> : <Icon name="check" className="h-4 w-4" />}{t('inst.r.send')}</Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex justify-end">
          <Button size="sm" onClick={() => setForm({ count: String(r.count), byYear: String(Math.max(r.byYear, years[0])), comment: '' })}><Icon name="plus" className="h-3.5 w-3.5" />{t('inst.r.offer')}</Button>
        </div>
      )}
    </Card>
  )
}
