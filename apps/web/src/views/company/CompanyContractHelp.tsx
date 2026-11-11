'use client'
import { useEffect, useState } from 'react'
import { formatSom, type ContractHelpCardDto, type MatchStatus } from '@ilmora/shared'
import { Badge, Button, Card, EmptyState, Icon, Notice, PageTitle, Select } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { apiErrorText } from '../../lib/apiErrors'
import { companyApi } from '../../services/companyCabinet'
import { useRegions } from '../../services/registry'
import { useStore } from '../../store/useStore'
import { CompanyClosed } from './common'
import { useCompany } from './companyStore'

const TONE: Record<MatchStatus, 'champagne' | 'forest' | 'danger' | 'muted'> = { PENDING: 'champagne', ACCEPTED: 'forest', DECLINED: 'danger', WITHDRAWN: 'muted' }

/**
 * Help with the contract fee (ТЗ 5.3): anonymised cards — no name or contacts, the institution by type and region only,
 * certificates and ILMORA courses as counts (titles would link the card to the named graduate card); «Проявить интерес» asks the student,
 * who decides whether to share contacts (then the student is in «Мои контакты»).
 */
export function CompanyContractHelp() {
  const { t, tr, lang } = useT()
  const notify = useStore((s) => s.notify)
  const { profile } = useCompany()
  const open = !!profile?.workspaceOpen
  const regions = useRegions()
  const [region, setRegion] = useState('')
  const [answer, setAnswer] = useState<{ key: string; list?: ContractHelpCardDto[]; error?: unknown } | null>(null)
  const [round, setRound] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const key = `${region}|${round}`
  useEffect(() => {
    if (!open) return
    let live = true
    companyApi.contractHelp(region || undefined).then((list) => { if (live) setAnswer({ key, list }) }, (error) => { if (live) setAnswer({ key, error }) })
    return () => { live = false }
  }, [open, region, round, key])

  if (profile && !open) return <div><PageTitle eyebrow={t('dash.company')} title={t('co.h.title')} /><CompanyClosed /></div>
  const current = answer?.key === key ? answer : null
  const interest = async (c: ContractHelpCardDto) => {
    setBusy(c.id)
    try { await companyApi.interest(c.id); notify(t('co.h.interested')); setRound((n) => n + 1) } catch (e) { notify(apiErrorText(e, lang), 'warn') } finally { setBusy(null) }
  }
  return (
    <div>
      <PageTitle eyebrow={t('dash.company')} title={t('co.h.title')} subtitle={t('co.h.hint')} />
      <div className="mb-4 w-full sm:w-64">
        <Select aria-label={t('min.filter.region')} value={region} onChange={(e) => setRegion(e.target.value)}>
          <option value="">{t('min.filter.allRegions')}</option>
          {regions.map((r) => <option key={r.id} value={r.id}>{tr(r.name)}</option>)}
        </Select>
      </div>
      {current?.error != null && <Notice tone="warn">{apiErrorText(current.error, lang)}</Notice>}
      {!current && <p className="text-sm text-charcoal/55" role="status">{t('common.loading')}</p>}
      {current?.list && current.list.length === 0 && <EmptyState icon={<Icon name="shield" className="h-6 w-6" />} title={t('co.h.empty')} />}
      <ul className="grid gap-3 lg:grid-cols-2">
        {current?.list?.map((c) => (
          <li key={c.id}>
            <Card className="flex h-full flex-col">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-sm font-semibold text-charcoal">{t('co.h.number', { n: c.number })}</span>
                {c.studyConfirmed && <Badge tone="sage"><Icon name="check" className="h-3 w-3" />{t('co.g.confirmed')}</Badge>}
              </div>
              <div className="mt-2 space-y-0.5 text-sm text-charcoal/75">
                {c.age != null && <div>{t('co.h.age', { n: c.age })}{c.region && <> · {tr(c.region.name)}</>}</div>}
                {c.institution && <div>{t(`inst.type.${c.institution.type}`)}{c.institution.region && <> · {tr(c.institution.region.name)}</>}</div>}
                {c.direction && <div>{c.direction.name} · {tr(c.direction.industry.name)}</div>}
                <div>{c.mode === 'STUDYING' ? t('co.h.studying', { n: c.course ?? '—' }) : t('co.h.applying', { year: c.enrollYear ?? '—' })}{c.studyForm && <> · {t(`co.h.studyForm.${c.studyForm}`)}</>}</div>
                {c.contractAmount != null && <div className="font-medium text-charcoal">{t('co.h.contract', { amount: formatSom(c.contractAmount, lang, false) })}</div>}
                <div>{t('co.h.years', { n: c.yearsToWork })} · {t('co.h.workRegion', { region: c.workRegion ? tr(c.workRegion.name) : t('inst.r.anyRegion') })}</div>
              </div>
              <p className="mt-2 text-sm text-charcoal/80"><span className="text-xs text-charcoal/50">{t('co.h.motivation')}:</span> {c.motivation}</p>
              {c.certificates > 0 && <p className="mt-1 text-xs text-charcoal/60">{t('co.g.certificates', { list: c.certificates })}</p>}
              {c.ilmoraCourses > 0 && <p className="mt-1 text-xs text-charcoal/60">{t('co.g.ilmoraCourses', { list: c.ilmoraCourses })}</p>}
              <div className="mt-auto flex justify-end pt-3">
                {c.contactRequest ? <Badge tone={TONE[c.contactRequest]}>{t(`co.g.request.${c.contactRequest}`)}</Badge>
                  : <Button size="sm" disabled={busy !== null} onClick={() => void interest(c)}><Icon name="star" className="h-3.5 w-3.5" />{t('co.h.interest')}</Button>}
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  )
}
