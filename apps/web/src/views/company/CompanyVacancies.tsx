'use client'
import { useEffect, useId, useState } from 'react'
import { formatDate, type ApplicationStatus, type CompanyVacancyDto, type VacancyApplicationDto } from '@ilmora/shared'
import { DirectionField } from '../../components/DirectionField'
import { Badge, Button, Card, EmptyState, Field, FieldGroup, Icon, Input, Notice, PageTitle, Select, Textarea } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { apiErrorText } from '../../lib/apiErrors'
import { companyApi, emptyVacancy, tashkentToday, vacancyForm, vacancyProblems, type VacancyForm } from '../../services/companyCabinet'
import { useRegions } from '../../services/registry'
import { useStore } from '../../store/useStore'
import { CompanyClosed, StudentCard } from './common'
import { useCompany } from './companyStore'

const APP_TONE: Record<ApplicationStatus, 'champagne' | 'sage' | 'forest' | 'danger'> = { NEW: 'champagne', VIEWED: 'sage', INVITED: 'forest', REJECTED: 'danger' }

/**
 * Practice and internships (ТЗ 5.4): published at once; the applications show the student's full card (the student
 * agreed by applying) — invite or reject.
 */
export function CompanyVacancies() {
  const { t, lang } = useT()
  const { profile } = useCompany()
  const open = !!profile?.workspaceOpen
  const [answer, setAnswer] = useState<{ round: number; list?: CompanyVacancyDto[]; error?: unknown } | null>(null)
  const [round, setRound] = useState(0)
  const [editing, setEditing] = useState<CompanyVacancyDto | 'new' | null>(null)
  useEffect(() => {
    if (!open) return
    let live = true
    companyApi.vacancies().then((list) => { if (live) setAnswer({ round, list }) }, (error) => { if (live) setAnswer({ round, error }) })
    return () => { live = false }
  }, [open, round])

  if (profile && !open) return <div><PageTitle eyebrow={t('dash.company')} title={t('co.v.title')} /><CompanyClosed /></div>
  const current = answer?.round === round ? answer : null
  const done = () => { setEditing(null); setRound((n) => n + 1) }
  return (
    <div>
      <PageTitle eyebrow={t('dash.company')} title={t('co.v.title')} subtitle={t('co.v.hint')}
        action={!editing ? <Button onClick={() => setEditing('new')}><Icon name="plus" className="h-4 w-4" />{t('co.v.new')}</Button> : undefined} />
      {editing && <VacancyEditor initial={editing === 'new' ? null : editing} onCancel={() => setEditing(null)} onSaved={done} />}
      {current?.error != null && <Notice tone="warn">{apiErrorText(current.error, lang)}</Notice>}
      {!current && <p className="text-sm text-charcoal/55" role="status">{t('common.loading')}</p>}
      {current?.list && current.list.length === 0 && !editing && <EmptyState icon={<Icon name="briefcase" className="h-6 w-6" />} title={t('co.v.empty')} />}
      <ul className="space-y-3">{current?.list?.map((v) => <li key={v.id}><VacancyCard vacancy={v} onEdit={() => setEditing(v)} onChanged={() => setRound((n) => n + 1)} /></li>)}</ul>
    </div>
  )
}

function VacancyEditor({ initial, onCancel, onSaved }: { initial: CompanyVacancyDto | null; onCancel: () => void; onSaved: () => void }) {
  const { t, tr, lang } = useT()
  const directionId = useId()
  const notify = useStore((s) => s.notify)
  const regions = useRegions()
  const [f, setF] = useState<VacancyForm>(() => (initial ? vacancyForm(initial) : emptyVacancy()))
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const problems = vacancyProblems(f, tashkentToday())
  const set = <K extends keyof VacancyForm>(k: K, v: VacancyForm[K]) => setF({ ...f, [k]: v })
  const save = async () => {
    setTouched(true)
    if (problems.length) return
    setBusy(true); setError(null)
    try {
      if (initial) { await companyApi.updateVacancy(initial.id, f); notify(t('common.saved')) } else { await companyApi.createVacancy(f); notify(t('co.v.published')) }
      onSaved()
    } catch (e) { setError(e); setBusy(false) }
  }
  const bad = (k: (typeof problems)[number]) => touched && problems.includes(k)
  return (
    <Card className="mb-5">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t('co.v.kind')} required>
          <Select value={f.kind} onChange={(e) => set('kind', e.target.value as VacancyForm['kind'])}>{(['PRACTICE', 'INTERNSHIP', 'JOB'] as const).map((k) => <option key={k} value={k}>{t(`co.v.kind.${k}`)}</option>)}</Select>
        </Field>
        <Field label={t('co.v.titleField')} required><Input maxLength={200} value={f.title} aria-invalid={bad('title')} onChange={(e) => set('title', e.target.value)} /></Field>
        <FieldGroup label={t('co.v.directions')} required className="md:col-span-2" htmlFor={directionId}>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {f.directions.map((d) => <Badge key={d.id} tone="sage">{d.name}<button type="button" aria-label={t('inst.p.removeDirection')} className="ml-1" onClick={() => set('directions', f.directions.filter((x) => x.id !== d.id))}><Icon name="x" className="h-3 w-3" /></button></Badge>)}
          </div>
          {f.directions.length < 10 && <DirectionField id={directionId} value={null} invalid={bad('directions')} onChange={(v) => { if (v?.id && !f.directions.some((x) => x.id === v.id)) set('directions', [...f.directions, { id: v.id, name: v.name }]) }} />}
          {bad('directions') && <p className="mt-1 text-xs text-red-700" role="alert">{t('co.v.problem.directions')}</p>}
        </FieldGroup>
        <Field label={t('min.filter.region')} required>
          <Select value={f.region} aria-invalid={bad('region')} onChange={(e) => set('region', e.target.value)}>
            <option value="" disabled>—</option>
            {regions.map((r) => <option key={r.id} value={r.id}>{tr(r.name)}</option>)}
          </Select>
        </Field>
        <Field label={t('co.v.address')}><Input maxLength={300} value={f.address} onChange={(e) => set('address', e.target.value)} /></Field>
        <Field label={t('co.v.format')} required>
          <Select value={f.format} onChange={(e) => set('format', e.target.value as VacancyForm['format'])}>{(['ONSITE', 'REMOTE', 'HYBRID'] as const).map((k) => <option key={k} value={k}>{t(`co.v.format.${k}`)}</option>)}</Select>
        </Field>
        <Field label={t('co.v.seats')} required><Input inputMode="numeric" value={f.seats} aria-invalid={bad('seats')} onChange={(e) => set('seats', e.target.value.replace(/\D/g, '').slice(0, 4))} /></Field>
        {f.kind === 'JOB' ? (
          // «Работа» is always paid: a salary from–to (one amount — «от» alone), the schedule and the experience asked for.
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('co.v.salaryFrom')}><Input inputMode="numeric" value={f.salaryFrom} aria-invalid={bad('salary')} onChange={(e) => set('salaryFrom', e.target.value.replace(/\D/g, '').slice(0, 10))} /></Field>
              <Field label={t('co.v.salaryTo')}><Input inputMode="numeric" value={f.salaryTo} aria-invalid={bad('salary')} onChange={(e) => set('salaryTo', e.target.value.replace(/\D/g, '').slice(0, 10))} /></Field>
            </div>
            <Field label={t('co.v.scheduleField')} required>
              <Select value={f.schedule} aria-invalid={bad('schedule')} onChange={(e) => set('schedule', e.target.value as VacancyForm['schedule'])} className={f.schedule ? undefined : 'text-charcoal/40'}>
                <option value="" disabled>{t('q.choose')}</option>
                {(['FULL_TIME', 'PART_TIME', 'SHIFT', 'FLEXIBLE'] as const).map((k) => <option key={k} value={k} className="text-charcoal">{t(`co.v.schedule.${k}`)}</option>)}
              </Select>
            </Field>
            <Field label={t('co.v.experienceField')} required>
              <Select value={f.experience} aria-invalid={bad('experience')} onChange={(e) => set('experience', e.target.value as VacancyForm['experience'])} className={f.experience ? undefined : 'text-charcoal/40'}>
                <option value="" disabled>{t('q.choose')}</option>
                {(['NONE', 'UP_TO_1', 'ONE_TO_3', 'OVER_3'] as const).map((k) => <option key={k} value={k} className="text-charcoal">{t(`co.v.experience.${k}`)}</option>)}
              </Select>
            </Field>
          </>
        ) : (
          <>
            <label className="flex items-center gap-2 text-sm text-charcoal/80"><input type="checkbox" className="h-4 w-4 accent-forest" checked={f.paid} onChange={(e) => set('paid', e.target.checked)} />{t('co.v.paid')}</label>
            {f.paid ? <Field label={t('co.v.stipend')}><Input inputMode="numeric" value={f.stipend} onChange={(e) => set('stipend', e.target.value.replace(/\D/g, '').slice(0, 10))} /></Field> : <div />}
          </>
        )}
        <Field label={t('co.v.duration')}><Input maxLength={100} value={f.duration} onChange={(e) => set('duration', e.target.value)} /></Field>
        <Field label={t('co.v.deadline')}><Input type="date" min={tashkentToday()} value={f.deadline} aria-invalid={bad('deadline')} onChange={(e) => set('deadline', e.target.value)} /></Field>
        <Field label={t('co.r.requirements')} className="md:col-span-2"><Textarea rows={3} maxLength={2000} value={f.requirements} onChange={(e) => set('requirements', e.target.value)} /></Field>
      </div>
      {touched && problems.length > 0 && <Notice tone="warn" className="mt-3">{problems.map((p) => t(`co.v.problem.${p}`)).join(' · ')}</Notice>}
      {error != null && <Notice tone="warn" className="mt-3">{apiErrorText(error, lang)}</Notice>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>{t('common.cancel')}</Button>
        <Button disabled={busy} onClick={() => void save()}>{busy ? <Icon name="refresh" className="h-4 w-4 animate-spin" /> : <Icon name="check" className="h-4 w-4" />}{t(initial ? 'co.r.save' : 'co.v.publish')}</Button>
      </div>
    </Card>
  )
}

function VacancyCard({ vacancy: v, onEdit, onChanged }: { vacancy: CompanyVacancyDto; onEdit: () => void; onChanged: () => void }) {
  const { t, tr, lang } = useT()
  const som = (n: number) => `${n.toLocaleString('ru-RU')} ${t('common.som')}`
  // «Работа»: the salary from–to; practice and internships: the stipend, if any.
  const payLine = (x: CompanyVacancyDto) => x.kind === 'JOB'
    ? (x.salaryFrom != null && x.salaryTo != null ? `${som(x.salaryFrom)} – ${som(x.salaryTo)}` : x.salaryFrom != null ? `${t('co.v.salaryFromShort')} ${som(x.salaryFrom)}` : t('co.v.paid'))
    : x.paid ? (x.stipend ? som(x.stipend) : t('co.v.paid')) : t('co.v.unpaid')
  const notify = useStore((s) => s.notify)
  const [apps, setApps] = useState<VacancyApplicationDto[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const total = Object.values(v.applications).reduce((n, x) => n + x, 0)
  const showApps = async () => {
    if (apps) { setApps(null); return }
    try { setApps(await companyApi.applications(v.id)) } catch (e) { notify(apiErrorText(e, lang), 'warn') }
  }
  const decide = async (a: VacancyApplicationDto, status: 'INVITED' | 'REJECTED') => {
    setBusy(a.id)
    try { setApps(await companyApi.setApplication(a.id, status)); notify(t(status === 'INVITED' ? 'co.v.invitedToast' : 'co.v.rejectedToast')); onChanged() } catch (e) { notify(apiErrorText(e, lang), 'warn') } finally { setBusy(null) }
  }
  const close = async () => {
    if (!confirm(t('co.v.closeConfirm'))) return
    setBusy('close')
    try { await companyApi.closeVacancy(v.id); notify(t('co.v.closedToast')); onChanged() } catch (e) { notify(apiErrorText(e, lang), 'warn') } finally { setBusy(null) }
  }
  const isOpen = v.status === 'OPEN'
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2"><Badge tone="champagne">{t(`co.v.kind.${v.kind}`)}</Badge><span className="font-medium text-charcoal">{v.title}</span></div>
          <div className="mt-1 text-xs text-charcoal/60">
            {v.directions.map((d) => d.name).join(', ')} · {tr(v.region.name)} · {t(`co.v.format.${v.format}`)} · {payLine(v)}{v.schedule && <> · {t(`co.v.schedule.${v.schedule}`)}</>}{v.experience && <> · {t(`co.v.experience.${v.experience}`)}</>} · {t('co.v.seats')}: {v.seats}
            {v.deadline && <> · {t('co.v.deadline').replace(/\s*\(.*\)/, '')}: {formatDate(v.deadline, lang)}</>}
          </div>
        </div>
        <Badge tone={isOpen ? 'forest' : 'muted'}>{t(`co.r.status.${v.status}`)}</Badge>
      </div>
      <p className="mt-2 text-xs text-charcoal/60">{t('co.v.apps', { new: v.applications.NEW, viewed: v.applications.VIEWED, invited: v.applications.INVITED, rejected: v.applications.REJECTED })}</p>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        {isOpen && <Button size="sm" variant="ghost" className="text-red-800" disabled={busy !== null} onClick={() => void close()}>{t('co.v.close')}</Button>}
        {isOpen && <Button size="sm" variant="secondary" onClick={onEdit}><Icon name="edit" className="h-3.5 w-3.5" />{t('co.r.edit')}</Button>}
        <Button size="sm" variant={apps ? 'ghost' : 'secondary'} onClick={() => void showApps()}>{t('co.v.showApps', { n: total })}</Button>
      </div>
      {apps && (
        <div className="mt-3 border-t border-charcoal/10 pt-3">
          {apps.length === 0 ? <p className="text-sm text-charcoal/55">{t('co.v.noApps')}</p> : (
            <ul className="space-y-3">
              {apps.map((a) => (
                <li key={a.id}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs text-charcoal/55">{formatDate(a.createdAt, lang)}</span>
                    <Badge tone={APP_TONE[a.status]}>{t(`co.v.app.${a.status}`)}</Badge>
                  </div>
                  <StudentCard card={a.student} openFile={(certId) => companyApi.applicationFile(a.id, certId)} />
                  {a.note && <p className="mt-2 text-sm text-charcoal/75"><span className="text-xs text-charcoal/50">{t('co.v.note')}:</span> {a.note}</p>}
                  {(a.status === 'NEW' || a.status === 'VIEWED') && (
                    <div className="mt-2 flex justify-end gap-2">
                      <Button size="sm" variant="ghost" className="text-red-800" disabled={busy !== null} onClick={() => void decide(a, 'REJECTED')}>{t('co.v.reject')}</Button>
                      <Button size="sm" disabled={busy !== null} onClick={() => void decide(a, 'INVITED')}><Icon name="check" className="h-3.5 w-3.5" />{t('co.v.invite')}</Button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}
