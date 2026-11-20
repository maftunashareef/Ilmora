'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CENTER_STUDENT_STATUSES, IMPORT_MAX_ROWS, INVITE_SENDS_MAX, INVITE_TTL_DAYS, isMinorOn, studyLabel, type CenterStudentStatus, type ImportRowError,
} from '@ilmora/shared'
import { InstitutionPicker, type InstitutionValue } from '../../components/center/InstitutionPicker'
import { Badge, Button, EmptyState, Field, Icon, Input, Modal, Notice, PageTitle, Select, Tabs } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { isApiError } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import { centerStudentsApi, fileToBase64, type ImportCheck, type InviteLink, type Roster, type RosterFilter, type RosterRow, type StudentDraft } from '../../services/centerStudents'
import { saveBlob } from '../../services/ministry'
import { useStore } from '../../store/useStore'
import { useCenterScope } from './centerApi'

const today = () => new Date(Date.now() + 5 * 3_600_000).toISOString().slice(0, 10)
const ddmmyyyy = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '—')
type Tone = 'forest' | 'warn' | 'muted' | 'sage' | 'champagne' | 'danger'
const statusTone = (s: CenterStudentStatus): Tone => (s === 'STUDYING' ? 'forest' : s === 'PAUSED' ? 'warn' : 'muted')
const inviteTone = (s: RosterRow['invite']['state']): Tone => (s === 'accepted' ? 'sage' : s === 'invited' ? 'champagne' : s === 'expired' ? 'danger' : 'muted')

type Form = StudentDraft & { id?: string; source: 'CENTER' | 'ILMORA'; status: CenterStudentStatus; institution: InstitutionValue | null }
const blank = (): Form => ({ source: 'CENTER', status: 'STUDYING', fullName: '', phone: '', birthDate: '', institutionId: null, institutionText: null, institutionType: null, institution: null, studyYear: null, groupIds: [], parentName: '', parentPhone: '', startedOn: today() })
const fromRow = (r: RosterRow): Form => ({
  id: r.id, source: r.source, status: r.status, fullName: r.fullName, phone: r.source === 'CENTER' ? r.phone : null, birthDate: r.birthDate ?? '',
  institutionId: r.institution?.id ?? null, institutionText: r.institution && !r.institution.id ? r.institution.name : null, institutionType: r.institution?.type ?? null, institution: r.institution,
  studyYear: r.studyYear, groupIds: r.groups.filter((g) => g.via === 'center').map((g) => g.id), parentName: r.parentName, parentPhone: r.parentPhone, startedOn: r.startedOn,
})

/**
 * «Студенты» of the center (ТЗ 2026-11-18, 4): every student — added by the center or through ILMORA — with the place of
 * study, groups, attendance, the invitation and the parent's consent; search and filters, the archive, the form, Excel
 * both ways and «Скопировать приглашение». Phones are personal data: shown to the center only, never logged here.
 */
export function CenterStudents() {
  const scope = useCenterScope()
  const { t, tr, lang } = useT()
  const notify = useStore((s) => s.notify)
  const service = useMemo(() => centerStudentsApi(scope.base), [scope.base])
  const [tab, setTab] = useState<'active' | 'archive'>('active')
  const [filter, setFilter] = useState<RosterFilter>({})
  const [data, setData] = useState<Roster | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState<Form | null>(null)
  const [invite, setInvite] = useState<(InviteLink & { name: string }) | null>(null)
  const [importing, setImporting] = useState(false)

  const query = useMemo<RosterFilter>(() => ({ ...filter, archive: tab === 'archive' ? '1' : undefined, status: tab === 'archive' ? undefined : filter.status }), [filter, tab])
  const load = useCallback(() => {
    setFailed(false)
    return service.roster(query).then(setData, () => setFailed(true))
  }, [service, query])
  useEffect(() => {
    const timer = setTimeout(() => { void load() }, 250)
    return () => clearTimeout(timer)
  }, [load])

  const fail = (err: unknown) => notify(isApiError(err) ? apiErrorText(err, lang) : t('apiError.generic'), 'warn')
  const label = (r: { institution: RosterRow['institution']; studyYear: number | null }) => studyLabel(lang, { institutionType: r.institution?.type ?? null, institutionName: r.institution?.name ?? null, studyYear: r.studyYear, centerName: data?.center.name ?? '' })
  const groupName = (g: { name: string; courseTitle: RosterRow['groups'][number]['courseTitle'] }) => `${tr(g.courseTitle)} · ${g.name}`

  const download = async (template: boolean) => {
    setBusy(true)
    try {
      saveBlob(await service.exportFile({ ...query, lang, ...(template ? { template: '1' as const } : {}) }), template ? `ilmora-shablon.xlsx` : `ilmora-talabalar-${today()}.xlsx`)
    } catch (err) { fail(err) } finally { setBusy(false) }
  }
  const setStatus = async (r: RosterRow, status: CenterStudentStatus) => {
    setBusy(true)
    try { await service.update(r.id, { status }); notify(t('common.saved')); await load() } catch (err) { fail(err) } finally { setBusy(false) }
  }
  const sendInvite = async (r: RosterRow) => {
    setBusy(true)
    try { setInvite({ ...(await service.invite(r.id)), name: r.fullName }); await load() } catch (err) { fail(err) } finally { setBusy(false) }
  }

  const rows = data?.rows ?? []
  const set = <K extends keyof RosterFilter>(k: K, v: RosterFilter[K]) => setFilter((f) => ({ ...f, [k]: v }))

  return (
    <div>
      <PageTitle eyebrow={t('dash.center')} title={t('center.students')} subtitle={t('cs.subtitle')} action={
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setForm(blank())}><Icon name="plus" className="h-4 w-4" />{t('cs.add')}</Button>
          <Button size="sm" variant="secondary" onClick={() => setImporting(true)}><Icon name="upload" className="h-4 w-4" />{t('cs.import')}</Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void download(false)} title={t('cs.exportHint')}><Icon name="download" className="h-4 w-4" />{t('cs.export')}</Button>
        </div>
      } />
      <Tabs<'active' | 'archive'> value={tab} onChange={setTab} className="mb-4" tabs={[{ id: 'active', label: t('cs.tab.active') }, { id: 'archive', label: t('cs.tab.archive') }]} />
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <Input value={filter.q ?? ''} onChange={(e) => set('q', e.target.value)} placeholder={t('cs.search')} aria-label={t('cs.search')} className="lg:col-span-2" />
        <Select value={filter.groupId ?? ''} onChange={(e) => set('groupId', e.target.value || undefined)} aria-label={t('cs.col.groups')}>
          <option value="">{t('cs.col.groups')}: {t('common.all')}</option>
          {data?.groups.map((g) => <option key={g.id} value={g.id}>{groupName(g)}</option>)}
        </Select>
        {tab === 'active' && (
          <Select value={filter.status ?? ''} onChange={(e) => set('status', (e.target.value || undefined) as CenterStudentStatus | undefined)} aria-label={t('cs.col.status')}>
            <option value="">{t('cs.col.status')}: {t('common.all')}</option>
            {CENTER_STUDENT_STATUSES.filter((s) => s !== 'LEFT').map((s) => <option key={s} value={s}>{t(`cs.status.${s}`)}</option>)}
          </Select>
        )}
        <Input value={filter.institution ?? ''} onChange={(e) => set('institution', e.target.value || undefined)} placeholder={t('cs.col.institution')} aria-label={t('cs.col.institution')} title={t('cs.col.institution')} />
        <Input type="number" min={1} max={100} value={filter.below ?? ''} onChange={(e) => set('below', e.target.value ? Math.max(1, Math.min(100, Number(e.target.value))) : undefined)} placeholder={t('cs.filter.below')} aria-label={t('cs.filter.below')} title={t('cs.filter.below')} />
      </div>
      {failed && <Notice tone="warn">{t('apiError.generic')}</Notice>}
      {data && <p className="mb-2 text-xs text-charcoal/50">{t('cs.found', { n: rows.length })}</p>}
      {data && rows.length === 0 && <EmptyState title={t('center.noStudents')} />}
      {rows.length > 0 && (
        <>
          <div className="card hidden overflow-x-auto p-0 lg:block">
            <table className="w-full text-sm">
              <thead className="bg-ivory/70 text-left text-[11px] uppercase tracking-wider text-charcoal/50">
                <tr>
                  <th className="px-4 py-3">{t('cs.col.fullName')}</th><th className="px-3 py-3">{t('cs.col.phone')}</th><th className="px-3 py-3">{t('cs.col.institution')}</th>
                  <th className="px-3 py-3">{t('cs.col.groups')}</th><th className="px-3 py-3">{t('cs.col.parentPhone')}</th><th className="px-3 py-3">{t('cs.col.status')}</th>
                  <th className="px-3 py-3">{t('cs.col.startedOn')}</th><th className="px-3 py-3 text-right">{t('cs.col.attendance')}</th><th className="px-3 py-3">{t('cs.col.invite')}</th>
                  <th className="px-3 py-3">{t('cs.col.parentConsent')}</th><th className="px-3 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-charcoal/8">
                {rows.map((r) => (
                  <tr key={r.id} className="align-top hover:bg-ivory/40">
                    <td className="min-w-40 px-4 py-2.5"><div className="font-medium text-charcoal">{r.fullName}</div><div className="text-xs text-charcoal/50">{t(`cs.source.${r.source}`)}</div></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-charcoal/70">{r.phone ?? '—'}</td>
                    <td className="px-3 py-2.5 text-charcoal/70">{r.institution ? label(r) : '—'}</td>
                    <td className="min-w-44 px-3 py-2.5 text-charcoal/70">{r.groups.map(groupName).join(', ') || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-charcoal/70">{r.minor ? (r.parentPhone ?? '—') : '—'}</td>
                    <td className="px-3 py-2.5"><Badge tone={statusTone(r.status)}>{t(`cs.status.${r.status}`)}</Badge></td>
                    <td className="whitespace-nowrap px-3 py-2.5 text-charcoal/70">{ddmmyyyy(r.startedOn)}</td>
                    <td className="px-3 py-2.5 text-right"><Badge tone={r.attendance.percent === null ? 'muted' : r.attendance.percent >= 75 ? 'sage' : 'warn'}>{r.attendance.percent === null ? '—' : `${r.attendance.percent}%`}</Badge></td>
                    <td className="px-3 py-2.5">{r.source === 'CENTER' ? <Badge tone={inviteTone(r.invite.state)}>{t(`cs.invite.${r.invite.state}`)}</Badge> : <span className="text-xs text-charcoal/45">—</span>}</td>
                    <td className="px-3 py-2.5"><ConsentMark row={r} /></td>
                    <td className="whitespace-nowrap px-3 py-2.5"><RowActions row={r} busy={busy} nowrap onEdit={() => setForm(fromRow(r))} onInvite={() => void sendInvite(r)} onStatus={(s) => void setStatus(r, s)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2 lg:hidden">
            {rows.map((r) => (
              <li key={r.id} className="card p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0"><div className="font-medium text-charcoal">{r.fullName}</div>{r.institution && <div className="text-xs text-charcoal/55">{label(r)}</div>}</div>
                  <Badge tone={statusTone(r.status)}>{t(`cs.status.${r.status}`)}</Badge>
                </div>
                <div className="mt-2 space-y-0.5 text-xs text-charcoal/60">
                  <div>{[r.phone, t(`cs.source.${r.source}`)].filter(Boolean).join(' · ')}</div>
                  {r.groups.length > 0 && <div>{r.groups.map(groupName).join(', ')}</div>}
                  <div>{t('journal.percent')}: {r.attendance.percent === null ? '—' : `${r.attendance.percent}%`}{r.source === 'CENTER' && <> · {t(`cs.invite.${r.invite.state}`)}</>}</div>
                  {r.minor && <div className="flex items-center gap-2">{t('cs.col.parentConsent')}: <ConsentMark row={r} /></div>}
                </div>
                <div className="mt-3"><RowActions row={r} busy={busy} onEdit={() => setForm(fromRow(r))} onInvite={() => void sendInvite(r)} onStatus={(s) => void setStatus(r, s)} /></div>
              </li>
            ))}
          </ul>
        </>
      )}

      {form && <StudentForm form={form} groups={data?.groups ?? []} onClose={() => setForm(null)} onSaved={async () => { setForm(null); notify(t('common.saved')); await load() }} save={async (f) => {
        const body: StudentDraft = {
          fullName: f.fullName, phone: f.phone?.trim() || null, birthDate: f.birthDate, studyYear: f.studyYear, groupIds: f.groupIds, parentName: f.parentName?.trim() || null, parentPhone: f.parentPhone?.trim() || null, startedOn: f.startedOn || null,
          institutionId: f.institution?.id ?? null, institutionText: f.institution && !f.institution.id ? f.institution.name : null, institutionType: f.institution?.type ?? null,
        }
        if (f.id && f.source === 'ILMORA') await service.update(f.id, { status: f.status })
        else if (f.id) await service.update(f.id, { ...body, status: f.status })
        else await service.create(body)
      }} />}
      {invite && <InviteModal invite={invite} onClose={() => setInvite(null)} />}
      {importing && <ImportModal service={service} onClose={() => setImporting(false)} onDone={async (n) => { setImporting(false); notify(t('cs.import.done', { n })); await load() }} onTemplate={() => void download(true)} />}
    </div>
  )
}

/** A minor's parent gives the consent by an SMS code (second stage): the mark stays grey, the center cannot tick it. */
function ConsentMark({ row }: { row: RosterRow }) {
  const { t } = useT()
  if (row.parentConsent === 'adult') return <span className="text-xs text-charcoal/45">{t('cs.consent.adult')}</span>
  return (
    <label className="inline-flex cursor-not-allowed items-center gap-1.5 text-xs text-charcoal/45" title={t('cs.consent.hint')}>
      <input type="checkbox" disabled checked={false} readOnly className="h-4 w-4 accent-forest" aria-describedby={`consent-${row.id}`} />
      <span id={`consent-${row.id}`}>{t('cs.consent.waiting')}</span>
    </label>
  )
}

function RowActions({ row, busy, nowrap, onEdit, onInvite, onStatus }: { row: RosterRow; busy: boolean; nowrap?: boolean; onEdit: () => void; onInvite: () => void; onStatus: (s: CenterStudentStatus) => void }) {
  const { t } = useT()
  const canInvite = row.source === 'CENTER' && row.invite.state !== 'accepted' && row.invite.sendsLeft > 0 && row.status !== 'LEFT'
  return (
    <div className={`flex justify-end gap-1.5 ${nowrap ? 'flex-nowrap' : 'flex-wrap'}`}>
      {row.status === 'LEFT' ? (
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => onStatus('STUDYING')}>{t('cs.restore')}</Button>
      ) : (
        <>
          <Button size="sm" variant="ghost" onClick={onEdit} aria-label={t('cs.edit')}><Icon name="edit" className="h-3.5 w-3.5" /></Button>
          {canInvite && <Button size="sm" variant="secondary" disabled={busy} onClick={onInvite}><Icon name="external" className="h-3.5 w-3.5" />{row.invite.state === 'none' ? t('cs.invite.copy') : t('cs.invite.newLink')}</Button>}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onStatus('LEFT')}>{t('cs.toArchive')}</Button>
        </>
      )}
    </div>
  )
}

function StudentForm({ form, groups, onClose, onSaved, save }: { form: Form; groups: Roster['groups']; onClose: () => void; onSaved: () => Promise<void>; save: (f: Form) => Promise<void> }) {
  const { t, tr, lang } = useT()
  const [f, setF] = useState<Form>(form)
  const [errors, setErrors] = useState<ImportRowError[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ilmora = f.source === 'ILMORA'
  const minor = isMinorOn(f.birthDate || null, today())
  const upd = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }))
  const err = (k: ImportRowError) => errors.includes(k) && <p className="mt-1 text-xs text-red-700">{t(`cs.err.${k}`)}</p>
  const submit = async () => {
    setBusy(true); setErrors([]); setMessage(null)
    try { await save(f); await onSaved() } catch (e) {
      const list = isApiError(e) ? ((e.details as { errors?: ImportRowError[] } | undefined)?.errors ?? []) : []
      setErrors(list)
      setMessage(list.length ? null : isApiError(e) && e.code === 'student_phone_taken' ? t('cs.err.phoneTaken') : apiErrorText(e, lang))
    } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={f.id ? t('cs.edit') : t('cs.add')} wide footer={<><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button disabled={busy} onClick={() => void submit()}>{t('common.save')}</Button></>}>
      {ilmora && <Notice tone="info" className="mb-4 text-xs">{t('cs.form.ilmoraNote')}</Notice>}
      {message && <Notice tone="warn" className="mb-4">{message}</Notice>}
      <fieldset disabled={ilmora} className="grid gap-4 sm:grid-cols-2">
        <Field label={t('cs.col.fullName')} required><Input value={f.fullName} maxLength={120} onChange={(e) => upd('fullName', e.target.value)} />{err('fullName')}</Field>
        <Field label={t('cs.col.birthDate')} required><Input type="date" value={f.birthDate} max={today()} onChange={(e) => upd('birthDate', e.target.value)} />{err('birthDate')}</Field>
        <Field label={t('cs.col.phone')} required={!minor}><Input type="tel" inputMode="tel" value={f.phone ?? ''} placeholder="+998 90 123 45 67" onChange={(e) => upd('phone', e.target.value)} />{err('phone')}{err('phoneRequired')}{err('phoneTaken')}</Field>
        <Field label={t('cs.col.studyYear')}><Input type="number" min={1} max={11} value={f.studyYear ?? ''} onChange={(e) => upd('studyYear', e.target.value ? Number(e.target.value) : null)} />{err('studyYear')}</Field>
        <div className="sm:col-span-2"><InstitutionPicker value={f.institution} onChange={(v) => upd('institution', v)} />{err('institution')}</div>
        {minor && <Notice tone="info" className="text-xs sm:col-span-2">{t('cs.form.minorNote')}</Notice>}
        <Field label={t('cs.col.parentName')} required={minor}><Input value={f.parentName ?? ''} maxLength={120} onChange={(e) => upd('parentName', e.target.value)} />{err('parentName')}</Field>
        <Field label={t('cs.col.parentPhone')} required={minor}><Input type="tel" inputMode="tel" value={f.parentPhone ?? ''} placeholder="+998 90 123 45 67" onChange={(e) => upd('parentPhone', e.target.value)} />{err('parentPhone')}</Field>
        <Field label={t('cs.col.startedOn')}><Input type="date" value={f.startedOn ?? ''} onChange={(e) => upd('startedOn', e.target.value || null)} />{err('startedOn')}</Field>
        <Field label={t('cs.col.groups')} className="sm:col-span-2">
          {groups.length === 0 ? <p className="text-xs text-charcoal/50">{t('cs.form.noGroups')}</p> : (
            <div className="grid gap-1.5 sm:grid-cols-2">
              {groups.map((g) => (
                <label key={g.id} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-forest" checked={f.groupIds.includes(g.id)} onChange={(e) => upd('groupIds', e.target.checked ? [...f.groupIds, g.id] : f.groupIds.filter((x) => x !== g.id))} />
                  {tr(g.courseTitle)} · {g.name}
                </label>
              ))}
            </div>
          )}
          {err('group')}
        </Field>
      </fieldset>
      {f.id && (
        <div className="mt-4">
          <Field label={t('cs.col.status')}>
            <Select value={f.status} onChange={(e) => upd('status', e.target.value as CenterStudentStatus)}>
              {CENTER_STUDENT_STATUSES.map((s) => <option key={s} value={s}>{t(`cs.status.${s}`)}</option>)}
            </Select>
          </Field>
        </div>
      )}
    </Modal>
  )
}

/** The link is shown once (only its hash is kept): copy it with a ready message and send it in Telegram or WhatsApp. */
function InviteModal({ invite, onClose }: { invite: InviteLink & { name: string }; onClose: () => void }) {
  const { t } = useT()
  const [copied, setCopied] = useState(false)
  const message = t('cs.invite.message', { center: invite.centerName, days: INVITE_TTL_DAYS, url: invite.url })
  const copy = async () => {
    try { await navigator.clipboard.writeText(message); setCopied(true) } catch { setCopied(false) }
  }
  return (
    <Modal open onClose={onClose} title={`${t('cs.invite.create')} · ${invite.name}`} footer={<><Button variant="ghost" onClick={onClose}>{t('common.close')}</Button><Button onClick={() => void copy()}><Icon name={copied ? 'check' : 'file'} className="h-4 w-4" />{copied ? t('common.copied') : t('cs.invite.copy')}</Button></>}>
      <Notice tone="info" className="mb-4 text-xs">{t('cs.invite.once', { days: INVITE_TTL_DAYS })}</Notice>
      <p className="mb-2 text-sm text-charcoal/70">{invite.to === 'parent' ? t('cs.invite.toParent', { phone: invite.phone }) : t('cs.invite.toStudent', { phone: invite.phone })}</p>
      <textarea readOnly value={message} rows={4} className="w-full rounded-control border border-charcoal/15 bg-ivory/60 p-3 text-sm" onFocus={(e) => e.currentTarget.select()} />
      <p className="mt-2 text-xs text-charcoal/50">{invite.sendsLeft > 0 ? t('cs.invite.sendsLeft', { n: invite.sendsLeft }) : t('cs.invite.limit', { max: INVITE_SENDS_MAX })}</p>
    </Modal>
  )
}

/** Check first (row by row), write only a file without errors — all of it or nothing (4.2). */
function ImportModal({ service, onClose, onDone, onTemplate }: { service: ReturnType<typeof centerStudentsApi>; onClose: () => void; onDone: (n: number) => Promise<void>; onTemplate: () => void }) {
  const { t, lang } = useT()
  const [file, setFile] = useState<string | null>(null)
  const [check, setCheck] = useState<ImportCheck | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const explain = (e: unknown) => isApiError(e) && e.code === 'import_bad_file' ? t('cs.import.badFile') : isApiError(e) && e.code === 'import_too_many_rows' ? t('cs.import.tooMany', { max: IMPORT_MAX_ROWS }) : apiErrorText(e, lang)
  const pick = async (f: File | undefined) => {
    setCheck(null); setMessage(null); setFile(null)
    if (!f) return
    if (!/\.xlsx$/i.test(f.name) || f.size > 512 * 1024) { setMessage(t('cs.import.badFile')); return }
    setBusy(true)
    try {
      const data = await fileToBase64(f)
      setFile(data)
      setCheck(await service.importCheck(data))
    } catch (e) { setMessage(explain(e)) } finally { setBusy(false) }
  }
  const write = async () => {
    if (!file) return
    setBusy(true)
    try { await onDone((await service.importCommit(file)).created) } catch (e) { setMessage(explain(e)) } finally { setBusy(false) }
  }
  return (
    <Modal open onClose={onClose} title={t('cs.import')} wide footer={<><Button variant="ghost" onClick={onTemplate}><Icon name="download" className="h-4 w-4" />{t('cs.template')}</Button><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button disabled={busy || !check || check.errors.length > 0} onClick={() => void write()}>{t('cs.import.commit')}</Button></>}>
      <Notice tone="info" className="mb-4 text-xs">{t('cs.import.hint', { max: IMPORT_MAX_ROWS })}</Notice>
      <Field label={t('cs.import.file')}><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={(e) => void pick(e.target.files?.[0])} className="block w-full text-sm" /></Field>
      {busy && <p className="mt-3 text-sm text-charcoal/55">{t('common.loading')}</p>}
      {message && <Notice tone="warn" className="mt-4">{message}</Notice>}
      {check && check.errors.length === 0 && <Notice tone="ok" className="mt-4">{t('cs.import.ready', { n: check.ready })}</Notice>}
      {check && check.errors.length > 0 && (
        <div className="mt-4">
          <Notice tone="warn">{t('cs.import.errors', { n: check.errors.length })}</Notice>
          <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto text-sm">
            {check.errors.map((e) => (
              <li key={e.row} className="rounded-control border border-red-200 bg-red-50/60 p-3">
                <div className="font-medium text-charcoal">{t('cs.import.row', { n: e.row })}{e.fullName && <> · {e.fullName}</>}</div>
                <ul className="mt-1 list-disc pl-5 text-xs text-red-800">{e.errors.map((x) => <li key={x}>{t(`cs.err.${x}`)}</li>)}</ul>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  )
}
