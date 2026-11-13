'use client'
import { useEffect, useState } from 'react'
import { formatDate, type AnnouncementDto, type AnnouncementResponseDto, type AnnouncementStatus, type MatchStatus } from '@ilmora/shared'
import { Badge, Button, Card, EmptyState, Field, FieldGroup, Icon, Input, Notice, PageTitle, Select } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { apiErrorText } from '../../lib/apiErrors'
import { useSearchParams } from '../../lib/routerHooks'
import { announcementLines, announcementYears, institutionApi } from '../../services/institutionCabinet'
import { useStore } from '../../store/useStore'
import { ClosedNotice, CompanyLine, Contacts } from './common'
import { usePassport } from './passportStore'

const STATUS_TONE: Record<AnnouncementStatus, 'champagne' | 'forest' | 'muted'> = { DRAFT: 'champagne', PUBLISHED: 'forest', CLOSED: 'muted' }
const MATCH_TONE: Record<MatchStatus, 'champagne' | 'forest' | 'danger' | 'muted'> = { PENDING: 'champagne', ACCEPTED: 'forest', DECLINED: 'danger', WITHDRAWN: 'muted' }
type LineRow = { directionId: string; count: string }

/**
 * Graduation announcements (ТЗ 5.1): a year and, per field of study, how many graduate. Published, companies of those
 * industries see it with the cards of confirmed students who agreed; the institution can hide a card and answers the
 * companies' responses (contacts open once accepted). `?a=<id>` opens one announcement.
 */
export function InstitutionGraduates() {
  const { t, lang } = useT()
  const { passport } = usePassport()
  const open = !!passport?.workspaceOpen
  const [sp, setSp] = useSearchParams()
  const selected = sp.get('a')
  const [answer, setAnswer] = useState<{ round: number; list?: AnnouncementDto[]; error?: unknown } | null>(null)
  const [round, setRound] = useState(0)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (!open || selected) return
    let live = true
    institutionApi.announcements().then((list) => { if (live) setAnswer({ round, list }) }, (error) => { if (live) setAnswer({ round, error }) })
    return () => { live = false }
  }, [open, selected, round])

  if (passport && !open) return <div><PageTitle eyebrow={t('dash.institution')} title={t('inst.g.title')} /><ClosedNotice /></div>
  if (selected) return <AnnouncementView id={selected} onBack={() => { setSp({}); setRound((n) => n + 1) }} />
  const current = answer?.round === round ? answer : null
  const noDirections = !!passport && passport.directions.length === 0

  return (
    <div>
      <PageTitle eyebrow={t('dash.institution')} title={t('inst.g.title')} subtitle={t('inst.g.hint')}
        action={!creating && !noDirections ? <Button onClick={() => setCreating(true)}><Icon name="plus" className="h-4 w-4" />{t('inst.g.new')}</Button> : undefined} />
      {noDirections && <Notice className="mb-4">{t('inst.g.noDirections')}</Notice>}
      {creating && <CreateForm onCancel={() => setCreating(false)} onCreated={(a) => { setCreating(false); setSp({ a: a.id }, { replace: false }) }} />}
      {current?.error != null && <Notice tone="warn">{apiErrorText(current.error, lang)}</Notice>}
      {!current && <p className="text-sm text-charcoal/55" role="status">{t('common.loading')}</p>}
      {current?.list && current.list.length === 0 && !creating && <EmptyState icon={<Icon name="cap" className="h-6 w-6" />} title={t('inst.g.empty')} />}
      {current?.list && current.list.length > 0 && (
        <ul className="space-y-2">
          {current.list.map((a) => (
            <li key={a.id}>
              <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-charcoal">{t('inst.g.headline', { year: a.year })}</span>
                    <Badge tone={STATUS_TONE[a.status]}>{t(`inst.g.status.${a.status}`)}</Badge>
                  </div>
                  <div className="mt-1 text-xs text-charcoal/60">
                    {t('inst.g.total', { n: a.total })} · {a.lines.map((l) => l.direction.name).join(', ')}
                    {a.status !== 'DRAFT' && <> · {t('inst.g.responsesSummary', { pending: a.responses.pending, accepted: a.responses.accepted })}</>}
                  </div>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setSp({ a: a.id }, { replace: false })}>{t('inst.g.open')}<Icon name="arrowRight" className="h-3.5 w-3.5" /></Button>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Rows of «direction — how many graduate», the directions taken from the institution's passport. */
function LinesEditor({ rows, onChange }: { rows: LineRow[]; onChange: (rows: LineRow[]) => void }) {
  const { t } = useT()
  const { passport } = usePassport()
  const directions = passport?.directions ?? []
  return (
    <div className="space-y-2">
      {rows.map((r, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_auto]">
          <Select aria-label={t('inst.p.direction')} value={r.directionId} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, directionId: e.target.value } : x)))}>
            <option value="" disabled>{t('inst.p.direction')}</option>
            {directions.map((d) => <option key={d.direction.id} value={d.direction.id} disabled={rows.some((x, j) => j !== i && x.directionId === d.direction.id)}>{d.direction.name}</option>)}
          </Select>
          <Input aria-label={t('inst.g.count')} placeholder={t('inst.g.count')} inputMode="numeric" value={r.count} onChange={(e) => onChange(rows.map((x, j) => (j === i ? { ...x, count: e.target.value.replace(/\D/g, '').slice(0, 5) } : x)))} />
          <Button size="sm" variant="ghost" aria-label={t('inst.p.removeDirection')} disabled={rows.length === 1} onClick={() => onChange(rows.filter((_, j) => j !== i))}><Icon name="trash" className="h-4 w-4" /></Button>
        </div>
      ))}
      {rows.length < directions.length && <Button size="sm" variant="ghost" onClick={() => onChange([...rows, { directionId: '', count: '' }])}><Icon name="plus" className="h-4 w-4" />{t('inst.g.addLine')}</Button>}
    </div>
  )
}

function CreateForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: (a: AnnouncementDto) => void }) {
  const { t, lang } = useT()
  const notify = useStore((s) => s.notify)
  const years = announcementYears()
  const [year, setYear] = useState(String(years[2]))
  const [rows, setRows] = useState<LineRow[]>([{ directionId: '', count: '' }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const lines = announcementLines(rows)
  const create = async () => {
    setBusy(true); setError(null)
    try { const a = await institutionApi.createAnnouncement(Number(year), lines); notify(t('inst.g.created')); onCreated(a) } catch (e) { setError(e); setBusy(false) }
  }
  return (
    <Card className="mb-5">
      <div className="grid gap-4 md:grid-cols-[10rem_minmax(0,1fr)]">
        <Field label={t('inst.g.year')} required><Select value={year} onChange={(e) => setYear(e.target.value)}>{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select></Field>
        <FieldGroup label={t('inst.g.lines')} required><LinesEditor rows={rows} onChange={setRows} /></FieldGroup>
      </div>
      {error != null && <Notice tone="warn" className="mt-3">{apiErrorText(error, lang)}</Notice>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>{t('common.cancel')}</Button>
        <Button disabled={busy || lines.length === 0} onClick={() => void create()}>{busy ? <Icon name="refresh" className="h-4 w-4 animate-spin" /> : <Icon name="check" className="h-4 w-4" />}{t('inst.g.create')}</Button>
      </div>
    </Card>
  )
}

function AnnouncementView({ id, onBack }: { id: string; onBack: () => void }) {
  const { t, tr, lang } = useT()
  const notify = useStore((s) => s.notify)
  const [ann, setAnn] = useState<{ id: string; data?: AnnouncementDto; error?: unknown } | null>(null)
  const [responses, setResponses] = useState<{ round: number; list: AnnouncementResponseDto[] } | null>(null)
  const [round, setRound] = useState(0)
  const [editing, setEditing] = useState<LineRow[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    institutionApi.announcement(id).then((data) => { if (live) setAnn({ id, data }) }, (error) => { if (live) setAnn({ id, error }) })
    return () => { live = false }
  }, [id, round])
  const a = ann?.id === id ? ann.data : undefined
  const published = !!a && a.status !== 'DRAFT'
  useEffect(() => {
    if (!published) return
    let live = true
    institutionApi.responses(id).then((list) => { if (live) setResponses({ round, list }) }, () => { if (live) setResponses({ round, list: [] }) })
    return () => { live = false }
  }, [id, published, round])

  const act = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key)
    try { await fn(); if (done) notify(done); setRound((n) => n + 1) } catch (e) { notify(apiErrorText(e, lang), 'warn') } finally { setBusy(null) }
  }
  const back = <button type="button" onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-sm text-charcoal/60 hover:text-forest"><Icon name="arrowLeft" className="h-4 w-4" />{t('inst.g.back')}</button>
  if (ann?.id === id && ann.error != null) return <div>{back}<Notice tone="warn">{apiErrorText(ann.error, lang)}</Notice></div>
  if (!a) return <div>{back}<p className="text-sm text-charcoal/55" role="status">{t('common.loading')}</p></div>

  const closed = a.status === 'CLOSED'
  const saveLines = editing ? announcementLines(editing) : []
  return (
    <div>
      {back}
      <PageTitle eyebrow={t('inst.g.title')} title={t('inst.g.headline', { year: a.year })}
        subtitle={`${t('inst.g.total', { n: a.total })}${published ? ` · ${t('inst.g.responsesSummary', { pending: a.responses.pending, accepted: a.responses.accepted })}` : ''}`}
        action={<div className="flex flex-wrap items-center gap-2">
          <Badge tone={STATUS_TONE[a.status]}>{t(`inst.g.status.${a.status}`)}</Badge>
          {a.status === 'DRAFT' && <Button disabled={busy !== null} onClick={() => { if (confirm(t('inst.g.publishConfirm'))) void act('publish', () => institutionApi.publish(a.id), t('inst.g.published')) }}><Icon name="megaphone" className="h-4 w-4" />{t('inst.g.publish')}</Button>}
          {a.status === 'PUBLISHED' && <Button variant="ghost" className="text-red-800" disabled={busy !== null} onClick={() => { if (confirm(t('inst.g.closeConfirm'))) void act('close', () => institutionApi.close(a.id), t('inst.g.closed')) }}>{t('inst.g.close')}</Button>}
        </div>} />

      <Card className="mb-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-display text-xl text-charcoal">{t('inst.g.lines')}</h2>
          {!closed && !editing && <Button size="sm" variant="secondary" onClick={() => setEditing(a.lines.map((l) => ({ directionId: l.direction.id, count: String(l.count) })))}><Icon name="edit" className="h-3.5 w-3.5" />{t('inst.g.editLines')}</Button>}
        </div>
        {editing ? (
          <div>
            <LinesEditor rows={editing} onChange={setEditing} />
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>{t('common.cancel')}</Button>
              <Button disabled={busy !== null || saveLines.length === 0} onClick={() => void act('lines', async () => { await institutionApi.updateLines(a.id, saveLines); setEditing(null) }, t('common.saved'))}>{t('inst.g.saveLines')}</Button>
            </div>
          </div>
        ) : (
          <ul className="space-y-4">
            {a.lines.map((l) => (
              <li key={l.id}>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium text-charcoal">{l.direction.name} <span className="text-sm font-normal text-charcoal/55">· {tr(l.direction.industry.name)}</span></span>
                  <span className="text-sm tabular-nums text-charcoal/75">{l.count}</span>
                </div>
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-xs text-forest">{t('inst.g.students', { n: l.students.length })}</summary>
                  <p className="mt-1 text-xs text-charcoal/55">{t('inst.g.studentsHint')}</p>
                  {l.students.length === 0 ? <p className="mt-2 text-xs text-charcoal/55">{t('inst.g.noStudents')}</p> : (
                    <ul className="mt-2 divide-y divide-charcoal/8 rounded-control border border-charcoal/10">
                      {l.students.map((s) => (
                        <li key={s.studentId} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                          <span className={s.excluded ? 'text-charcoal/45 line-through' : 'text-charcoal'}>{s.name}{s.course != null && <span className="ml-2 text-xs text-charcoal/50">{t('inst.s.course', { n: s.course })}</span>}</span>
                          <span className="flex items-center gap-2">
                            {s.excluded && <Badge tone="muted">{t('inst.g.hidden')}</Badge>}
                            {!closed && <Button size="sm" variant="ghost" disabled={busy !== null}
                              onClick={() => void act(`x-${s.studentId}`, () => (s.excluded ? institutionApi.include(a.id, s.studentId) : institutionApi.exclude(a.id, s.studentId)))}>
                              {s.excluded ? t('inst.g.show') : t('inst.g.hide')}
                            </Button>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </details>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {published && (
        <section>
          <h2 className="mb-3 font-display text-xl text-charcoal">{t('inst.g.responses')}</h2>
          {!responses && <p className="text-sm text-charcoal/55" role="status">{t('common.loading')}</p>}
          {responses && responses.list.length === 0 && <p className="text-sm text-charcoal/55">{t('inst.g.noResponses')}</p>}
          <ul className="space-y-3">
            {responses?.list.map((r) => (
              <li key={r.id}>
                <Card>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <CompanyLine company={r.company} />
                    <div className="text-right">
                      <Badge tone={MATCH_TONE[r.status]}>{t(`inst.r.status.${r.status}`)}</Badge>
                      <div className="mt-1 text-xs text-charcoal/50">{formatDate(r.createdAt, lang)}</div>
                    </div>
                  </div>
                  <ul className="mt-2 text-sm text-charcoal/75">{r.lines.map((l) => <li key={l.lineId}>{t('inst.g.wanted', { direction: l.direction.name, n: l.wantedCount })}</li>)}</ul>
                  {r.comment && <p className="mt-1 text-xs text-charcoal/60">«{r.comment}»</p>}
                  {r.status === 'PENDING' && (
                    <div className="mt-3 flex justify-end gap-2">
                      <Button size="sm" variant="ghost" className="text-red-800" disabled={busy !== null} onClick={() => void act(`d-${r.id}`, () => institutionApi.declineResponse(r.id), t('inst.g.declined'))}>{t('inst.g.decline')}</Button>
                      <Button size="sm" disabled={busy !== null} onClick={() => void act(`a-${r.id}`, () => institutionApi.acceptResponse(r.id), t('inst.g.accepted'))}><Icon name="check" className="h-3.5 w-3.5" />{t('inst.g.accept')}</Button>
                    </div>
                  )}
                  {r.contacts && <Contacts contacts={r.contacts} title={t('inst.r.contacts')} />}
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
