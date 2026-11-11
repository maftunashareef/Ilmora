'use client'
import { useEffect, useState } from 'react'
import { formatDate, formatSom, type ApplicationStatus, type StudentApplicationDto, type VacancyDto } from '@ilmora/shared'
import { Badge, Button, Card, EmptyState, Field, Icon, LinkButton, Notice, PageTitle, Select, Tabs, Textarea } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { isApiError } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import { useQuestionnaire } from '../../services/questionnaire'
import { useIndustries, useRegions } from '../../services/registry'
import { APPLICATION_NOTE_MAX, defaultVacancyFilters, studentApi, vacancyQuery, type VacancyFilters } from '../../services/studentOpportunities'
import { useStore } from '../../store/useStore'

const APP_TONE: Record<ApplicationStatus, 'champagne' | 'sage' | 'forest' | 'danger'> = { NEW: 'champagne', VIEWED: 'sage', INVITED: 'forest', REJECTED: 'danger' }

/**
 * «Вакансии» (ТЗ 5.4 after 11.11): practice, internships and jobs of approved companies. By default filtered by the student's
 * industry and region; applying shows the company the student's name, contacts and certificates (consent by action).
 */
export function StudentVacancies() {
  const { t } = useT()
  const [tab, setTab] = useState<'all' | 'mine'>('all')
  const [mineCount, setMineCount] = useState<number | null>(null)
  return (
    <div>
      <PageTitle eyebrow={t('dash.studentSpace')} title={t('st.v.title')} subtitle={t('st.v.hint')} />
      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={[{ id: 'all', label: t('st.v.all') }, { id: 'mine', label: t('st.v.mine'), count: mineCount ?? undefined }]} />
      {tab === 'all' ? <AllVacancies /> : <MyApplications onCount={setMineCount} />}
    </div>
  )
}

function AllVacancies() {
  const { t, tr, lang } = useT()
  const { data: q, status: qStatus } = useQuestionnaire()
  const industries = useIndustries()
  const regions = useRegions()
  const [filters, setFilters] = useState<VacancyFilters | null>(null)
  // The defaults come from the questionnaire once it is loaded (the student can change them).
  if (!filters && qStatus !== 'loading') setFilters(defaultVacancyFilters(q?.questionnaire))
  const key = filters ? vacancyQuery(filters) : null
  const [answer, setAnswer] = useState<{ key: string; list?: VacancyDto[]; error?: unknown } | null>(null)
  const [round, setRound] = useState(0)
  useEffect(() => {
    if (!filters || key == null) return
    let live = true
    studentApi.vacancies(filters).then((list) => { if (live) setAnswer({ key, list }) }, (error) => { if (live) setAnswer({ key, error }) })
    return () => { live = false }
  }, [filters, key, round])
  const current = answer && answer.key === key ? answer : null
  const set = (k: keyof VacancyFilters, v: string) => filters && setFilters({ ...filters, [k]: v })

  return (
    <div>
      {filters && (
        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select aria-label={t('st.v.industry')} value={filters.industry} onChange={(e) => set('industry', e.target.value)}>
            <option value="">{t('st.v.anyIndustry')}</option>
            {industries.list.map((i) => <option key={i.id} value={i.id}>{tr(i.name)}</option>)}
          </Select>
          <Select aria-label={t('min.filter.region')} value={filters.region} onChange={(e) => set('region', e.target.value)}>
            <option value="">{t('min.filter.allRegions')}</option>
            {regions.map((r) => <option key={r.id} value={r.slug ?? r.id}>{tr(r.name)}</option>)}
          </Select>
          <Select aria-label={t('co.v.kind')} value={filters.kind} onChange={(e) => set('kind', e.target.value)}>
            <option value="">{t('st.v.anyKind')}</option>
            {(['PRACTICE', 'INTERNSHIP', 'JOB'] as const).map((k) => <option key={k} value={k}>{t(`co.v.kind.${k}`)}</option>)}
          </Select>
          <Select aria-label={t('co.v.format')} value={filters.format} onChange={(e) => set('format', e.target.value)}>
            <option value="">{t('st.v.anyFormat')}</option>
            {(['ONSITE', 'REMOTE', 'HYBRID'] as const).map((k) => <option key={k} value={k}>{t(`co.v.format.${k}`)}</option>)}
          </Select>
        </div>
      )}
      {current?.error != null && <Notice tone="warn">{apiErrorText(current.error, lang)}</Notice>}
      {!current && <p className="text-sm text-charcoal/55" role="status">{t('common.loading')}</p>}
      {current?.list && current.list.length === 0 && <EmptyState icon={<Icon name="briefcase" className="h-6 w-6" />} title={t('st.v.empty')} body={t('st.v.emptyHint')} />}
      <ul className="space-y-3">
        {current?.list?.map((v) => <li key={v.id}><VacancyCard vacancy={v} onApplied={() => setRound((n) => n + 1)} /></li>)}
      </ul>
    </div>
  )
}

function VacancyCard({ vacancy: v, onApplied }: { vacancy: VacancyDto; onApplied: () => void }) {
  const { t, tr, lang } = useT()
  const notify = useStore((s) => s.notify)
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [consent, setConsent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<unknown>(null)
  const apply = async () => {
    setBusy(true); setFailure(null)
    try { await studentApi.apply(v.id, note); notify(t('st.v.applied')); setOpen(false); onApplied() } catch (e) { setFailure(e) } finally { setBusy(false) }
  }
  const incomplete = isApiError(failure) && failure.code === 'questionnaire_incomplete'
  const place = [tr(v.region.name), v.district ? tr(v.district.name) : null, v.address].filter(Boolean).join(', ')
  const som = (n: number) => formatSom(n, lang, false)
  // «Работа» has a salary from–to; practice and internships a stipend (or none).
  const payText = (x: VacancyDto) => x.kind === 'JOB'
    ? (x.salaryFrom != null && x.salaryTo != null ? t('st.v.salaryRange', { from: som(x.salaryFrom), to: som(x.salaryTo) }) : x.salaryFrom != null ? t('st.v.salary', { amount: som(x.salaryFrom) }) : t('st.v.paid'))
    : x.paid ? (x.stipend ? t('st.v.stipend', { amount: som(x.stipend) }) : t('st.v.paid')) : t('st.v.unpaid')
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="champagne">{t(`co.v.kind.${v.kind}`)}</Badge>
            <h3 className="font-display text-xl text-charcoal">{v.title}</h3>
          </div>
          <div className="mt-1 text-sm text-charcoal/75">{v.company.name}{v.company.industries.length > 0 && <span className="text-charcoal/50"> · {v.company.industries.map((i) => tr(i.name)).join(', ')}</span>}</div>
        </div>
        {v.myApplication && <Badge tone={APP_TONE[v.myApplication.status]}>{t(`st.v.status.${v.myApplication.status}`)}</Badge>}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-charcoal/70">
        <span className="inline-flex items-center gap-1"><Icon name="pin" className="h-3.5 w-3.5" />{place}</span>
        <span>{t(`co.v.format.${v.format}`)}</span>
        <span>{payText(v)}</span>
        {v.duration && <span>{v.duration}</span>}
        <span>{t('st.v.seats', { n: v.seats })}</span>
        {v.deadline && <span>{t('st.v.deadline', { date: formatDate(v.deadline, lang) })}</span>}
      </div>
      {v.directions.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{v.directions.map((d) => <Badge key={d.id} tone="sage">{d.name}</Badge>)}</div>}
      {v.requirements && <p className="mt-3 whitespace-pre-line text-sm text-charcoal/75"><span className="text-xs text-charcoal/50">{t('co.r.requirements')}:</span> {v.requirements}</p>}
      {!v.myApplication && (open ? (
        <div className="mt-4 grid gap-3 border-t border-charcoal/8 pt-4">
          <Field label={t('st.v.note')} hint={`${note.length} / ${APPLICATION_NOTE_MAX}`}>
            <Textarea rows={3} maxLength={APPLICATION_NOTE_MAX} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('st.v.notePlaceholder')} />
          </Field>
          <label className="flex cursor-pointer items-start gap-2.5 text-sm text-charcoal/80">
            <input type="checkbox" className="mt-0.5 h-4 w-4 accent-forest" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>{t('st.v.consent')}</span>
          </label>
          {incomplete && (
            <Notice tone="warn"><span className="flex flex-wrap items-center justify-between gap-3">{apiErrorText(failure, lang)}<LinkButton to="/student/questionnaire" size="sm" variant="secondary">{t('st.openQuestionnaire')}</LinkButton></span></Notice>
          )}
          {failure != null && !incomplete && <Notice tone="warn">{apiErrorText(failure, lang)}</Notice>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
            <Button disabled={!consent || busy} onClick={() => void apply()}>{busy ? <Icon name="refresh" className="h-4 w-4 animate-spin" /> : <Icon name="check" className="h-4 w-4" />}{t('st.v.send')}</Button>
          </div>
        </div>
      ) : (
        <div className="mt-4 flex justify-end"><Button size="sm" onClick={() => setOpen(true)}>{t('st.v.apply')}<Icon name="arrowRight" className="h-3.5 w-3.5" /></Button></div>
      ))}
    </Card>
  )
}

function MyApplications({ onCount }: { onCount: (n: number) => void }) {
  const { t, lang } = useT()
  const notify = useStore((s) => s.notify)
  const [answer, setAnswer] = useState<{ list?: StudentApplicationDto[]; error?: unknown } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    studentApi.applications().then((list) => { if (live) { setAnswer({ list }); onCount(list.length) } }, (error) => { if (live) setAnswer({ error }) })
    return () => { live = false }
  }, [onCount])
  const withdraw = async (a: StudentApplicationDto) => {
    if (!confirm(t('st.v.withdrawConfirm'))) return
    setBusy(a.id)
    try { const list = await studentApi.withdrawApplication(a.id); setAnswer({ list }); onCount(list.length); notify(t('st.v.withdrawn')) } catch (e) { notify(apiErrorText(e, lang), 'warn') } finally { setBusy(null) }
  }
  if (answer?.error != null) return <Notice tone="warn">{apiErrorText(answer.error, lang)}</Notice>
  if (!answer) return <p className="text-sm text-charcoal/55" role="status">{t('common.loading')}</p>
  if (!answer.list?.length) return <EmptyState icon={<Icon name="briefcase" className="h-6 w-6" />} title={t('st.v.noApplications')} />
  return (
    <ul className="space-y-2">
      {answer.list.map((a) => (
        <li key={a.id}>
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <div className="font-medium text-charcoal">{a.vacancy.title}</div>
              <div className="mt-0.5 text-xs text-charcoal/60">{a.vacancy.company.name} · {t(`co.v.kind.${a.vacancy.kind}`)} · {formatDate(a.createdAt, lang)}</div>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone={APP_TONE[a.status]}>{t(`st.v.status.${a.status}`)}</Badge>
              <Button size="sm" variant="ghost" className="text-red-800" disabled={busy !== null} onClick={() => void withdraw(a)}>{t('st.v.withdraw')}</Button>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  )
}
