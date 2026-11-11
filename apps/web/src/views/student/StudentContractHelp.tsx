'use client'
import { useEffect, useState } from 'react'
import { CONTRACT_HELP_MOTIVATION_MAX, CONTRACT_HELP_YEARS_MAX, formatDate, type ContractHelpDto, type MatchStatus } from '@ilmora/shared'
import { Badge, Button, Card, Field, Icon, LinkButton, Notice, PageTitle, Select, Textarea } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { isApiError } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import {
  CONTRACT_HELP_MISSING, contractHelpOpen, contractHelpProblems, emptyContractHelp, studentApi, type ContractHelpForm,
} from '../../services/studentOpportunities'
import { useStore } from '../../store/useStore'

const TONE: Record<MatchStatus, 'champagne' | 'forest' | 'danger' | 'muted'> = { PENDING: 'champagne', ACCEPTED: 'forest', DECLINED: 'danger', WITHDRAWN: 'muted' }

/**
 * «Помощь с оплатой контракта» (ТЗ 5.3): the student asks companies of their industry for help; companies see an
 * anonymised card (no name or contacts) and may show interest — the student decides whether to open contacts. One open
 * request at a time; «Договор заключён» names a company the student opened contacts to.
 */
export function StudentContractHelp() {
  const { t, lang } = useT()
  const [answer, setAnswer] = useState<{ round: number; data?: ContractHelpDto | null; error?: unknown } | null>(null)
  const [round, setRound] = useState(0)
  useEffect(() => {
    let live = true
    studentApi.contractHelp().then((data) => { if (live) setAnswer({ round, data }) }, (error) => { if (live) setAnswer({ round, error }) })
    return () => { live = false }
  }, [round])
  const reload = () => setRound((n) => n + 1)

  return (
    <div>
      <PageTitle eyebrow={t('dash.studentSpace')} title={t('st.h.title')} subtitle={t('st.h.hint')} />
      {!answer && <p className="text-sm text-charcoal/55" role="status">{t('common.loading')}</p>}
      {answer?.error != null && <Notice tone="warn">{apiErrorText(answer.error, lang)}</Notice>}
      {answer && answer.error == null && (contractHelpOpen(answer.data)
        ? <OpenRequest request={answer.data!} onChange={reload} />
        : <>
          {answer.data?.status === 'SIGNED' && <Notice tone="ok" className="mb-4">{t('st.h.signedDone', { company: answer.data.signedWith?.name ?? '—', date: formatDate(answer.data.signedAt ?? answer.data.createdAt, lang) })}</Notice>}
          {answer.data?.status === 'WITHDRAWN' && <Notice className="mb-4">{t('st.h.withdrawnDone', { date: formatDate(answer.data.withdrawnAt ?? answer.data.createdAt, lang) })}</Notice>}
          <AskForm onDone={reload} />
        </>)}
    </div>
  )
}

function AskForm({ onDone }: { onDone: () => void }) {
  const { t, lang } = useT()
  const notify = useStore((s) => s.notify)
  const [f, setF] = useState<ContractHelpForm>(emptyContractHelp)
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<unknown>(null)
  const problems = contractHelpProblems(f)
  const bad = (k: (typeof problems)[number]) => touched && problems.includes(k)
  const missing = isApiError(failure) && failure.code === 'contract_help_profile' ? ((failure.details as { missing?: string[] } | undefined)?.missing ?? []) : []
  const incomplete = isApiError(failure) && failure.code === 'questionnaire_incomplete'
  const send = async () => {
    setTouched(true)
    if (problems.length) return
    setBusy(true); setFailure(null)
    try { await studentApi.askContractHelp(f); notify(t('st.h.sent')); onDone() } catch (e) { setFailure(e) } finally { setBusy(false) }
  }
  return (
    <Card>
      <h2 className="font-display text-xl text-charcoal">{t('st.h.askTitle')}</h2>
      <p className="mt-1 text-sm text-charcoal/65">{t('st.h.how')}</p>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <Field label={t('st.h.motivation')} required hint={`${f.motivation.trim().length} / ${CONTRACT_HELP_MOTIVATION_MAX}`} className="md:col-span-2">
          <Textarea rows={4} maxLength={CONTRACT_HELP_MOTIVATION_MAX} value={f.motivation} aria-invalid={bad('motivation')} placeholder={t('st.h.motivationPlaceholder')}
            onChange={(e) => setF({ ...f, motivation: e.target.value })} />
          {bad('motivation') && <p className="mt-1 text-xs text-red-700" role="alert">{t('st.h.problem.motivation')}</p>}
        </Field>
        <Field label={t('st.h.years')} required>
          <Select value={f.yearsToWork} aria-invalid={bad('years')} onChange={(e) => setF({ ...f, yearsToWork: e.target.value })} className={f.yearsToWork ? undefined : 'text-charcoal/40'}>
            <option value="" disabled>{t('q.choose')}</option>
            {Array.from({ length: CONTRACT_HELP_YEARS_MAX }, (_, i) => i + 1).map((n) => <option key={n} value={n} className="text-charcoal">{n}</option>)}
          </Select>
          {bad('years') && <p className="mt-1 text-xs text-red-700" role="alert">{t('st.h.problem.years')}</p>}
        </Field>
        <Field label={t('st.h.workRegion')} required>
          <Select value={f.workRegion} onChange={(e) => setF({ ...f, workRegion: e.target.value as ContractHelpForm['workRegion'] })}>
            <option value="OWN">{t('st.h.region.OWN')}</option>
            <option value="ANY">{t('st.h.region.ANY')}</option>
          </Select>
        </Field>
      </div>
      <label className="mt-4 flex cursor-pointer items-start gap-2.5 text-sm text-charcoal/80">
        <input type="checkbox" className="mt-0.5 h-4 w-4 accent-forest" checked={f.consent} onChange={(e) => setF({ ...f, consent: e.target.checked })} aria-invalid={bad('consent')} />
        <span>{t('st.h.consent')}</span>
      </label>
      {bad('consent') && <p className="mt-1 text-xs text-red-700" role="alert">{t('st.h.problem.consent')}</p>}
      {missing.length > 0 && (
        <Notice tone="warn" className="mt-4">
          <span className="flex flex-wrap items-center justify-between gap-3">{t('st.h.missing', { fields: missing.map((m) => (CONTRACT_HELP_MISSING[m] ? t(CONTRACT_HELP_MISSING[m]) : m)).join(', ') })}
            <LinkButton to="/student/questionnaire" size="sm" variant="secondary">{t('st.openQuestionnaire')}</LinkButton></span>
        </Notice>
      )}
      {incomplete && (
        <Notice tone="warn" className="mt-4">
          <span className="flex flex-wrap items-center justify-between gap-3">{apiErrorText(failure, lang)}<LinkButton to="/student/questionnaire" size="sm" variant="secondary">{t('st.openQuestionnaire')}</LinkButton></span>
        </Notice>
      )}
      {failure != null && !missing.length && !incomplete && <Notice tone="warn" className="mt-4">{apiErrorText(failure, lang)}</Notice>}
      <div className="mt-5 flex justify-end">
        <Button disabled={busy} onClick={() => void send()}>{busy ? <Icon name="refresh" className="h-4 w-4 animate-spin" /> : <Icon name="check" className="h-4 w-4" />}{t('st.h.send')}</Button>
      </div>
    </Card>
  )
}

function OpenRequest({ request: r, onChange }: { request: ContractHelpDto; onChange: () => void }) {
  const { t, tr, lang } = useT()
  const notify = useStore((s) => s.notify)
  const [busy, setBusy] = useState<string | null>(null)
  const [company, setCompany] = useState('')
  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key)
    try { await fn(); notify(done); onChange() } catch (e) { notify(apiErrorText(e, lang), 'warn') } finally { setBusy(null) }
  }
  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-xl text-charcoal">{t('st.h.mine')}</h2>
          <Badge tone={r.status === 'INTERESTED' ? 'forest' : 'champagne'}>{t(`st.h.status.${r.status}`)}</Badge>
        </div>
        <p className="mt-3 whitespace-pre-line text-sm text-charcoal/80">{r.motivation}</p>
        <div className="mt-3 text-sm text-charcoal/65">
          {t('st.h.yearsN', { n: r.yearsToWork })} · {r.workRegion ? tr(r.workRegion.name) : t('st.h.region.ANY')} · {formatDate(r.createdAt, lang)}
        </div>
        <div className="mt-4 flex justify-end">
          <Button size="sm" variant="ghost" className="text-red-800" disabled={busy !== null}
            onClick={() => { if (confirm(t('st.h.withdrawConfirm'))) void act('withdraw', studentApi.withdrawContractHelp, t('st.h.withdrawn')) }}>{t('st.h.withdraw')}</Button>
        </div>
      </Card>

      <Card>
        <h2 className="font-display text-xl text-charcoal">{t('st.h.interests', { n: r.interests.length })}</h2>
        {r.interests.length === 0 && <p className="mt-2 text-sm text-charcoal/55">{t('st.h.noInterests')}</p>}
        <ul className="mt-3 divide-y divide-charcoal/8">
          {r.interests.map((i) => (
            <li key={i.requestId} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <div className="font-medium text-charcoal">{i.company.name}</div>
                <div className="text-xs text-charcoal/55">{formatDate(i.createdAt, lang)}</div>
              </div>
              {i.status === 'PENDING'
                ? <span className="flex gap-2">
                  <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void act(`d-${i.requestId}`, () => studentApi.declineRequest(i.requestId), t('st.r.declined'))}>{t('st.r.decline')}</Button>
                  <Button size="sm" disabled={busy !== null} onClick={() => void act(`a-${i.requestId}`, () => studentApi.acceptRequest(i.requestId), t('st.r.accepted'))}><Icon name="check" className="h-3.5 w-3.5" />{t('st.r.accept')}</Button>
                </span>
                : <Badge tone={TONE[i.status]}>{t(`st.r.status.${i.status}`)}</Badge>}
            </li>
          ))}
        </ul>
        {r.interests.some((i) => i.status === 'PENDING') && <p className="mt-2 text-xs text-charcoal/55">{t('st.r.acceptHint')}</p>}
      </Card>

      {r.signableCompanies.length > 0 && (
        <Card>
          <h2 className="font-display text-xl text-charcoal">{t('st.h.signedTitle')}</h2>
          <p className="mt-1 text-sm text-charcoal/65">{t('st.h.signedHint')}</p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <Field label={t('st.h.signedWith')} className="min-w-[16rem] flex-1">
              <Select value={company} onChange={(e) => setCompany(e.target.value)} className={company ? undefined : 'text-charcoal/40'}>
                <option value="" disabled>{t('q.choose')}</option>
                {r.signableCompanies.map((c) => <option key={c.id} value={c.id} className="text-charcoal">{c.name}</option>)}
              </Select>
            </Field>
            <Button disabled={!company || busy !== null} onClick={() => void act('signed', () => studentApi.signed(company), t('st.h.signedToast'))}><Icon name="check" className="h-4 w-4" />{t('st.h.signed')}</Button>
          </div>
        </Card>
      )}
    </div>
  )
}
