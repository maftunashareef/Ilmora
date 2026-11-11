'use client'
import { useEffect, useId, useState } from 'react'
import { formatDate, type DirectionChoice, type MatchStatus, type TrainingRequestDto } from '@ilmora/shared'
import { DirectionField } from '../../components/DirectionField'
import { Badge, Button, Card, EmptyState, Field, FieldGroup, Icon, Input, Notice, PageTitle, Select, Textarea } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { apiErrorText } from '../../lib/apiErrors'
import { companyApi } from '../../services/companyCabinet'
import { offerYears } from '../../services/institutionCabinet'
import { useRegions } from '../../services/registry'
import { useStore } from '../../store/useStore'
import { Contacts } from '../institution/common'
import { CompanyClosed, InstitutionLine } from './common'
import { useCompany } from './companyStore'

const TONE: Record<MatchStatus, 'champagne' | 'forest' | 'danger' | 'muted'> = { PENDING: 'champagne', ACCEPTED: 'forest', DECLINED: 'danger', WITHDRAWN: 'muted' }

/**
 * Requests «под обучение» (ТЗ 5.2): which field of study, how many people, by which year, region or any; institutions of
 * that industry offer to train them; an accepted offer opens the institution's contacts.
 */
export function CompanyRequests() {
  const { t, lang } = useT()
  const { profile } = useCompany()
  const open = !!profile?.workspaceOpen
  const [answer, setAnswer] = useState<{ round: number; list?: TrainingRequestDto[]; error?: unknown } | null>(null)
  const [round, setRound] = useState(0)
  const [creating, setCreating] = useState(false)
  useEffect(() => {
    if (!open) return
    let live = true
    companyApi.requests().then((list) => { if (live) setAnswer({ round, list }) }, (error) => { if (live) setAnswer({ round, error }) })
    return () => { live = false }
  }, [open, round])

  if (profile && !open) return <div><PageTitle eyebrow={t('dash.company')} title={t('co.r.title')} /><CompanyClosed /></div>
  const current = answer?.round === round ? answer : null
  return (
    <div>
      <PageTitle eyebrow={t('dash.company')} title={t('co.r.title')} subtitle={t('co.r.hint')}
        action={!creating ? <Button onClick={() => setCreating(true)}><Icon name="plus" className="h-4 w-4" />{t('co.r.new')}</Button> : undefined} />
      {creating && <NewRequest onCancel={() => setCreating(false)} onCreated={() => { setCreating(false); setRound((n) => n + 1) }} />}
      {current?.error != null && <Notice tone="warn">{apiErrorText(current.error, lang)}</Notice>}
      {!current && <p className="text-sm text-charcoal/55" role="status">{t('common.loading')}</p>}
      {current?.list && current.list.length === 0 && !creating && <EmptyState icon={<Icon name="cap" className="h-6 w-6" />} title={t('co.r.empty')} />}
      <ul className="space-y-3">{current?.list?.map((r) => <li key={r.id}><RequestCard request={r} onChanged={() => setRound((n) => n + 1)} /></li>)}</ul>
    </div>
  )
}

function NewRequest({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => void }) {
  const { t, tr, lang } = useT()
  const notify = useStore((s) => s.notify)
  const regions = useRegions()
  const years = offerYears()
  const directionId = useId()
  const [direction, setDirection] = useState<DirectionChoice | null>(null)
  const [count, setCount] = useState('')
  const [byYear, setByYear] = useState(String(years[1]))
  const [regionId, setRegionId] = useState('')
  const [requirements, setRequirements] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const valid = !!direction?.id && Number(count) >= 1 && Number(count) <= 10_000
  const create = async () => {
    if (!valid || !direction?.id) return
    setBusy(true); setError(null)
    try { await companyApi.createRequest({ directionId: direction.id, count: Number(count), byYear: Number(byYear), regionId: regionId || null, requirements }); notify(t('co.r.created')); onCreated() } catch (e) { setError(e); setBusy(false) }
  }
  return (
    <Card className="mb-5">
      <div className="grid gap-4 md:grid-cols-2">
        <FieldGroup label={t('inst.p.direction')} required className="md:col-span-2" htmlFor={directionId}><DirectionField id={directionId} value={direction} onChange={setDirection} /></FieldGroup>
        <Field label={t('inst.r.offerCount')} required><Input inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, '').slice(0, 5))} /></Field>
        <Field label={t('inst.r.offerYear')} required><Select value={byYear} onChange={(e) => setByYear(e.target.value)}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select></Field>
        <Field label={t('min.filter.region')}>
          <Select value={regionId} onChange={(e) => setRegionId(e.target.value)}>
            <option value="">{t('inst.r.anyRegion')}</option>
            {regions.map((r) => <option key={r.id} value={r.id}>{tr(r.name)}</option>)}
          </Select>
        </Field>
        <Field label={t('co.r.requirements')} className="md:col-span-2"><Textarea rows={3} maxLength={2000} value={requirements} onChange={(e) => setRequirements(e.target.value)} /></Field>
      </div>
      {error != null && <Notice tone="warn" className="mt-3">{apiErrorText(error, lang)}</Notice>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>{t('common.cancel')}</Button>
        <Button disabled={busy || !valid} onClick={() => void create()}>{busy ? <Icon name="refresh" className="h-4 w-4 animate-spin" /> : <Icon name="check" className="h-4 w-4" />}{t('co.r.create')}</Button>
      </div>
    </Card>
  )
}

function RequestCard({ request: r, onChanged }: { request: TrainingRequestDto; onChanged: () => void }) {
  const { t, tr, lang } = useT()
  const notify = useStore((s) => s.notify)
  const years = offerYears()
  const [edit, setEdit] = useState<{ count: string; byYear: string; requirements: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key)
    try { await fn(); notify(done); setEdit(null); onChanged() } catch (e) { notify(apiErrorText(e, lang), 'warn') } finally { setBusy(null) }
  }
  const isOpen = r.status === 'OPEN'
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="font-medium text-charcoal">{r.direction.name} <span className="text-sm font-normal text-charcoal/55">· {tr(r.direction.industry.name)}</span></div>
          <div className="mt-0.5 text-sm text-charcoal/75">{t('inst.r.need', { count: r.count, year: r.byYear })} · {r.region ? tr(r.region.name) : t('inst.r.anyRegion')}</div>
          {r.requirements && <p className="mt-1 whitespace-pre-line text-sm text-charcoal/65">{r.requirements}</p>}
        </div>
        <div className="text-right">
          <Badge tone={isOpen ? 'forest' : 'muted'}>{t(`co.r.status.${r.status}`)}</Badge>
          <div className="mt-1 text-xs text-charcoal/50">{formatDate(r.createdAt, lang)}</div>
        </div>
      </div>
      <p className="mt-2 text-xs text-charcoal/60">{t('co.r.summary', { pending: r.summary.pending, accepted: r.summary.accepted, promised: r.summary.promised })}</p>

      {edit && (
        <div className="mt-3 grid gap-3 border-t border-charcoal/10 pt-3 sm:grid-cols-[8rem_10rem_minmax(0,1fr)]">
          <Field label={t('inst.r.offerCount')}><Input inputMode="numeric" value={edit.count} onChange={(e) => setEdit({ ...edit, count: e.target.value.replace(/\D/g, '').slice(0, 5) })} /></Field>
          <Field label={t('inst.r.offerYear')}><Select value={edit.byYear} onChange={(e) => setEdit({ ...edit, byYear: e.target.value })}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select></Field>
          <Field label={t('co.r.requirements')}><Textarea rows={2} maxLength={2000} value={edit.requirements} onChange={(e) => setEdit({ ...edit, requirements: e.target.value })} /></Field>
          <div className="flex justify-end gap-2 sm:col-span-3">
            <Button variant="ghost" onClick={() => setEdit(null)}>{t('common.cancel')}</Button>
            <Button disabled={busy !== null || !(Number(edit.count) >= 1)} onClick={() => void act('save', () => companyApi.updateRequest(r.id, { count: Number(edit.count), byYear: Number(edit.byYear), requirements: edit.requirements }), t('common.saved'))}>{t('co.r.save')}</Button>
          </div>
        </div>
      )}
      {isOpen && !edit && (
        <div className="mt-3 flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="ghost" className="text-red-800" disabled={busy !== null} onClick={() => { if (confirm(t('co.r.closeConfirm'))) void act('close', () => companyApi.closeRequest(r.id), t('co.r.closedToast')) }}>{t('co.r.close')}</Button>
          <Button size="sm" variant="secondary" onClick={() => setEdit({ count: String(r.count), byYear: String(Math.max(r.byYear, years[0])), requirements: r.requirements ?? '' })}><Icon name="edit" className="h-3.5 w-3.5" />{t('co.r.edit')}</Button>
        </div>
      )}

      <div className="mt-4 border-t border-charcoal/10 pt-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wider text-charcoal/50">{t('co.r.offers')}</div>
        {r.offers.length === 0 ? <p className="text-sm text-charcoal/55">{t('co.r.noOffers')}</p> : (
          <ul className="space-y-3">
            {r.offers.map((o) => (
              <li key={o.id} className="rounded-control border border-charcoal/10 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <InstitutionLine institution={o.institution} />
                  <Badge tone={TONE[o.status]}>{t(`inst.r.status.${o.status}`)}</Badge>
                </div>
                <div className="mt-1 text-sm text-charcoal/75">{t('co.r.offerLine', { count: o.count, year: o.byYear })}</div>
                {o.comment && <p className="mt-1 text-xs text-charcoal/60">«{o.comment}»</p>}
                {o.status === 'PENDING' && (
                  <div className="mt-2 flex justify-end gap-2">
                    <Button size="sm" variant="ghost" className="text-red-800" disabled={busy !== null} onClick={() => void act(`d-${o.id}`, () => companyApi.declineOffer(o.id), t('co.r.declined'))}>{t('co.r.decline')}</Button>
                    <Button size="sm" disabled={busy !== null} onClick={() => void act(`a-${o.id}`, () => companyApi.acceptOffer(o.id), t('co.r.accepted'))}><Icon name="check" className="h-3.5 w-3.5" />{t('co.r.accept')}</Button>
                  </div>
                )}
                {o.contacts && <Contacts contacts={o.contacts} title={t('co.r.contacts')} />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}
