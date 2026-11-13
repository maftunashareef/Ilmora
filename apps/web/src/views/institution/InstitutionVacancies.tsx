'use client'
import { useEffect, useState } from 'react'
import { formatDate, formatSom, type InstitutionVacancyDto, type VacancyBroadcastDto, type VacancyBroadcastPreviewDto, type VacancyKind } from '@ilmora/shared'
import { Badge, Button, Card, EmptyState, Icon, LinkButton, Notice, PageTitle, Select, Tabs } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { apiErrorText } from '../../lib/apiErrors'
import { broadcastCourses, broadcastDirections, emptyInstVacancyFilters, instVacancyQuery, institutionApi, type InstVacancyFilters } from '../../services/institutionCabinet'
import { useRegions } from '../../services/registry'
import { useStore } from '../../store/useStore'
import { ClosedNotice } from './common'
import { usePassport } from './passportStore'

type Tab = VacancyKind | 'journal'

/**
 * «Вакансии компаний» (ТЗ «Студенты у компании, Вакансии у учреждения», 3): open vacancies of approved companies in the
 * industries of the institution's directions — a tab per kind, filters; «Разослать студентам» sends a vacancy to the
 * institution's confirmed students on chosen directions and years (no consent needed: the institution writes to its own
 * students), with the number of recipients before sending; the journal of broadcasts, with the number delivered when it
 * differs from the number at sending.
 */
export function InstitutionVacancies() {
  const { t } = useT()
  const { passport } = usePassport()
  const open = !!passport?.workspaceOpen
  const [tab, setTab] = useState<Tab>('PRACTICE')
  if (passport && !open) return <div><PageTitle eyebrow={t('dash.institution')} title={t('inst.v.title')} /><ClosedNotice /></div>
  return (
    <div>
      <PageTitle eyebrow={t('dash.institution')} title={t('inst.v.title')} subtitle={t('inst.v.hint')} />
      <Tabs className="mb-5" value={tab} onChange={setTab} tabs={[
        { id: 'PRACTICE', label: t('co.v.kind.PRACTICE') }, { id: 'INTERNSHIP', label: t('co.v.kind.INTERNSHIP') }, { id: 'JOB', label: t('co.v.kind.JOB') },
        { id: 'journal', label: t('inst.v.journal') },
      ]} />
      {tab === 'journal' ? <Journal /> : <VacancyList key={tab} kind={tab} />}
    </div>
  )
}

function VacancyList({ kind }: { kind: VacancyKind }) {
  const { t, tr, lang } = useT()
  const { passport } = usePassport()
  const regions = useRegions()
  const [filters, setFilters] = useState<InstVacancyFilters>(() => emptyInstVacancyFilters(kind))
  const key = instVacancyQuery(filters)
  const [answer, setAnswer] = useState<{ key: string; data?: Awaited<ReturnType<typeof institutionApi.vacancies>>; error?: unknown } | null>(null)
  const [round, setRound] = useState(0)
  useEffect(() => {
    let live = true
    institutionApi.vacancies(filters).then((data) => { if (live) setAnswer({ key, data }) }, (error) => { if (live) setAnswer({ key, error }) })
    return () => { live = false }
  }, [filters, key, round])
  const current = answer?.key === key ? answer : null
  const set = (k: keyof InstVacancyFilters, v: string) => setFilters({ ...filters, [k]: v })
  const job = kind === 'JOB'

  return (
    <div>
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select aria-label={t('inst.p.direction')} value={filters.direction} onChange={(e) => set('direction', e.target.value)}>
          <option value="">{t('inst.v.anyDirection')}</option>
          {passport?.directions.map((d) => <option key={d.direction.id} value={d.direction.id}>{d.direction.name}</option>)}
        </Select>
        <Select aria-label={t('min.filter.region')} value={filters.region} onChange={(e) => set('region', e.target.value)}>
          <option value="">{t('min.filter.allRegions')}</option>
          {regions.map((r) => <option key={r.id} value={r.slug ?? r.id}>{tr(r.name)}</option>)}
        </Select>
        <Select aria-label={t('co.v.format')} value={filters.format} onChange={(e) => set('format', e.target.value)}>
          <option value="">{t('st.v.anyFormat')}</option>
          {(['ONSITE', 'REMOTE', 'HYBRID'] as const).map((k) => <option key={k} value={k}>{t(`co.v.format.${k}`)}</option>)}
        </Select>
        {job ? (
          <div className="grid grid-cols-2 gap-3">
            <Select aria-label={t('co.v.scheduleField')} value={filters.schedule} onChange={(e) => set('schedule', e.target.value)}>
              <option value="">{t('co.v.scheduleField')}</option>
              {(['FULL_TIME', 'PART_TIME', 'SHIFT', 'FLEXIBLE'] as const).map((k) => <option key={k} value={k}>{t(`co.v.schedule.${k}`)}</option>)}
            </Select>
            <Select aria-label={t('co.v.experienceField')} value={filters.experience} onChange={(e) => set('experience', e.target.value)}>
              <option value="">{t('co.v.experienceField')}</option>
              {(['NONE', 'UP_TO_1', 'ONE_TO_3', 'OVER_3'] as const).map((k) => <option key={k} value={k}>{t(`co.v.experience.${k}`)}</option>)}
            </Select>
          </div>
        ) : (
          <Select aria-label={t('co.v.paid')} value={filters.paid} onChange={(e) => set('paid', e.target.value)}>
            <option value="">{t('inst.v.anyPay')}</option>
            <option value="true">{t('st.v.paid')}</option>
            <option value="false">{t('st.v.unpaid')}</option>
          </Select>
        )}
      </div>
      {current?.error != null && <Notice tone="warn">{apiErrorText(current.error, lang)}</Notice>}
      {!current && <p className="text-sm text-charcoal/55" role="status">{t('common.loading')}</p>}
      {current?.data && !current.data.hasDirections && (
        <Notice tone="warn"><span className="flex flex-wrap items-center justify-between gap-3">{t('inst.v.noDirections')}<LinkButton to="/institution" size="sm" variant="secondary">{t('inst.openPassport')}</LinkButton></span></Notice>
      )}
      {current?.data?.hasDirections && current.data.items.length === 0 && <EmptyState icon={<Icon name="briefcase" className="h-6 w-6" />} title={t('inst.v.empty')} />}
      <ul className="space-y-3">
        {current?.data?.items.map((v) => <li key={v.id}><VacancyCard vacancy={v} onSent={() => setRound((n) => n + 1)} /></li>)}
      </ul>
    </div>
  )
}

function VacancyCard({ vacancy: v, onSent }: { vacancy: InstitutionVacancyDto; onSent: () => void }) {
  const { t, tr, lang } = useT()
  const [open, setOpen] = useState(false)
  const som = (n: number) => formatSom(n, lang, false)
  const pay = v.kind === 'JOB'
    ? (v.salaryFrom != null && v.salaryTo != null ? t('st.v.salaryRange', { from: som(v.salaryFrom), to: som(v.salaryTo) }) : v.salaryFrom != null ? t('st.v.salary', { amount: som(v.salaryFrom) }) : t('st.v.paid'))
    : v.paid ? (v.stipend ? t('st.v.stipend', { amount: som(v.stipend) }) : t('st.v.paid')) : t('st.v.unpaid')
  const place = [tr(v.region.name), v.district ? tr(v.district.name) : null, v.address].filter(Boolean).join(', ')
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><Badge tone="champagne">{t(`co.v.kind.${v.kind}`)}</Badge><h3 className="font-display text-xl text-charcoal">{v.title}</h3></div>
          <div className="mt-1 text-sm text-charcoal/75">{v.company.name}{v.company.industries.length > 0 && <span className="text-charcoal/50"> · {v.company.industries.map((i) => tr(i.name)).join(', ')}</span>}</div>
        </div>
        {v.sentTo > 0 && <Badge tone="sage">{t('inst.v.sentTo', { n: v.sentTo })}</Badge>}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-charcoal/70">
        <span className="inline-flex items-center gap-1"><Icon name="pin" className="h-3.5 w-3.5" />{place}</span>
        <span>{t(`co.v.format.${v.format}`)}</span>
        <span>{pay}</span>
        {v.schedule && <span>{t(`co.v.schedule.${v.schedule}`)}</span>}
        {v.experience && <span>{t(`co.v.experience.${v.experience}`)}</span>}
        <span>{t('st.v.seats', { n: v.seats })}</span>
        {v.deadline && <span>{t('st.v.deadline', { date: formatDate(v.deadline, lang) })}</span>}
      </div>
      {v.directions.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{v.directions.map((d) => <Badge key={d.id} tone="sage">{d.name}</Badge>)}</div>}
      {v.requirements && <p className="mt-3 whitespace-pre-line text-sm text-charcoal/75"><span className="text-xs text-charcoal/50">{t('co.r.requirements')}:</span> {v.requirements}</p>}
      {open ? <BroadcastForm vacancy={v} onClose={() => setOpen(false)} onSent={() => { setOpen(false); onSent() }} />
        : <div className="mt-4 flex justify-end"><Button size="sm" onClick={() => setOpen(true)}><Icon name="megaphone" className="h-3.5 w-3.5" />{t('inst.v.broadcast')}</Button></div>}
    </Card>
  )
}

function BroadcastForm({ vacancy, onClose, onSent }: { vacancy: InstitutionVacancyDto; onClose: () => void; onSent: () => void }) {
  const { t, lang } = useT()
  const notify = useStore((s) => s.notify)
  const { passport } = usePassport()
  const directions = passport ? broadcastDirections(passport, vacancy) : []
  const courses = passport ? broadcastCourses(passport.type) : []
  const [dirs, setDirs] = useState<string[]>([])
  const [years, setYears] = useState<number[]>([])
  const body = { directionIds: dirs, courses: years }
  const ready = dirs.length > 0 && years.length > 0
  const key = ready ? JSON.stringify(body) : ''
  const [preview, setPreview] = useState<{ key: string; data?: VacancyBroadcastPreviewDto; error?: unknown } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!key) return
    let live = true
    institutionApi.broadcastPreview(vacancy.id, JSON.parse(key)).then((data) => { if (live) setPreview({ key, data }) }, (error) => { if (live) setPreview({ key, error }) })
    return () => { live = false }
  }, [vacancy.id, key])
  const current = preview?.key === key ? preview : null
  const toggle = <T,>(list: T[], x: T) => (list.includes(x) ? list.filter((y) => y !== x) : [...list, x])
  const send = async () => {
    setBusy(true)
    try { const b = await institutionApi.broadcast(vacancy.id, body); notify(t('inst.v.sent', { n: b.recipientsCount })); onSent() } catch (e) { notify(apiErrorText(e, lang), 'warn') } finally { setBusy(false) }
  }
  return (
    <div className="mt-4 border-t border-charcoal/8 pt-4">
      <p className="text-sm text-charcoal/70">{t('inst.v.broadcastHint')}</p>
      {directions.length === 0 ? <Notice tone="warn" className="mt-3">{t('inst.v.noMatchingDirections')}</Notice> : (
        <>
          <div className="mt-3 text-xs font-medium text-charcoal/70">{t('inst.v.directions')}</div>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {directions.map((d) => {
              const on = dirs.includes(d.direction.id)
              return <button key={d.direction.id} type="button" aria-pressed={on} onClick={() => setDirs(toggle(dirs, d.direction.id))}
                className={`rounded-full border px-3 py-1.5 text-xs transition ${on ? 'border-forest bg-forest text-ivory' : 'border-charcoal/15 text-charcoal/70 hover:border-forest/50'}`}>{d.direction.name}</button>
            })}
          </div>
          <div className="mt-3 text-xs font-medium text-charcoal/70">{t('inst.v.courses')}</div>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {courses.map((n) => {
              const on = years.includes(n)
              return <button key={n} type="button" aria-pressed={on} onClick={() => setYears(toggle(years, n))}
                className={`min-w-[2.5rem] rounded-full border px-3 py-1.5 text-xs transition ${on ? 'border-forest bg-forest text-ivory' : 'border-charcoal/15 text-charcoal/70 hover:border-forest/50'}`}>{t('co.st.courseN', { n })}</button>
            })}
          </div>
        </>
      )}
      {ready && !current && <p className="mt-3 text-sm text-charcoal/55" role="status">{t('common.loading')}</p>}
      {current?.error != null && <Notice tone="warn" className="mt-3">{apiErrorText(current.error, lang)}</Notice>}
      {current?.data && (
        <Notice tone={current.data.recipients > 0 ? 'info' : 'warn'} className="mt-3">
          {t('inst.v.preview', { n: current.data.recipients, already: current.data.alreadySent, left: current.data.leftToday })}
        </Notice>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
        <Button disabled={busy || !current?.data || current.data.recipients === 0 || current.data.leftToday === 0} onClick={() => void send()}>
          {busy ? <Icon name="refresh" className="h-4 w-4 animate-spin" /> : <Icon name="megaphone" className="h-4 w-4" />}{t('inst.v.send', { n: current?.data?.recipients ?? 0 })}
        </Button>
      </div>
    </div>
  )
}

function Journal() {
  const { t, lang } = useT()
  const [answer, setAnswer] = useState<{ list?: VacancyBroadcastDto[]; error?: unknown } | null>(null)
  useEffect(() => {
    let live = true
    institutionApi.broadcasts().then((list) => { if (live) setAnswer({ list }) }, (error) => { if (live) setAnswer({ error }) })
    return () => { live = false }
  }, [])
  if (answer?.error != null) return <Notice tone="warn">{apiErrorText(answer.error, lang)}</Notice>
  if (!answer) return <p className="text-sm text-charcoal/55" role="status">{t('common.loading')}</p>
  if (!answer.list?.length) return <EmptyState icon={<Icon name="megaphone" className="h-6 w-6" />} title={t('inst.v.journalEmpty')} />
  return (
    <ul className="space-y-2">
      {answer.list.map((b) => (
        <li key={b.id}>
          <Card className="p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium text-charcoal">{b.vacancyTitle} <span className="text-charcoal/55">· {b.companyName}</span></div>
                <div className="mt-1 text-xs text-charcoal/60">
                  {formatDate(b.createdAt, lang)} · {b.sentBy?.name ?? t('inst.v.sentByGone')} · {b.directions.map((d) => d.name).join(', ')} · {b.courses.map((n) => t('co.st.courseN', { n })).join(', ')}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone="sage">{t('inst.v.recipients', { n: b.recipientsCount })}</Badge>
                {/* The number at sending and, once the queue is done, the number that actually got it — when they differ. */}
                {b.finishedAt && b.deliveredCount !== b.recipientsCount && <Badge tone="champagne">{t('inst.v.delivered', { n: b.deliveredCount })}</Badge>}
                <Badge tone={b.finishedAt ? 'forest' : 'champagne'}>{t(b.finishedAt ? 'inst.v.finished' : 'inst.v.sending')}</Badge>
              </div>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  )
}
