'use client'
import { useEffect, useState } from 'react'
import { useT } from '../../i18n/useT'
import { api, isApiError } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import { formatDayMonth, formatTime } from '../../lib/format'
import { isPastSession } from '../../lib/sessions'
import { subscribeToSession } from '../../services/attendance'
import { useStore } from '../../store/useStore'
import type { Course, Group, LessonSession, Student } from '../../types'
import { QrCode } from '../QrCode'
import { Badge, Button, cx, Eyebrow, Field, Icon, Input, Notice, Select } from '../ui'

type Record_ = { studentId: string; status?: string; method: string; checkedInAt: string }

export function SessionStatus({ session }: { session: LessonSession }) {
  const { t } = useT()
  return (
    <>
      <Badge tone={session.status === 'completed' ? 'muted' : session.status === 'cancelled' ? 'danger' : 'sage'}>{t(`session.status.${session.status}`)}</Badge>
      {session.status !== 'cancelled' && (session.attendanceOpen ? <Badge tone="forest"><Icon name="check" className="h-3 w-3" />{t('session.isOpen')}</Badge> : <Badge tone="neutral"><Icon name="lock" className="h-3 w-3" />{t('session.isClosed')}</Badge>)}
      {session.isExtra && !session.rescheduledFromId && <Badge tone="champagne">{t('session.isExtra')}</Badge>}
      {session.rescheduledFromId && <Badge tone="champagne">{t('session.movedFrom')}</Badge>}
    </>
  )
}

/** How a record was made, when it was not the teacher's own QR: the center's standing code, a correction, or the worker. */
function MethodBadge({ method }: { method: string }) {
  const { t } = useT()
  if (method === 'manual') return <Badge tone="muted">{t('session.correct')}</Badge>
  if (method === 'center_qr') return <Badge tone="muted">{t('session.centerQr')}</Badge>
  if (method === 'auto') return <Badge tone="muted">{t('session.autoAbsent')}</Badge>
  return null
}

/**
 * QR + live roster for one lesson, used by the Teacher Studio and the center workspace. Live updates arrive over SSE
 * while the panel is open. Also moves the lesson (same date: new times; another date: a new lesson replaces it).
 */
export function SessionPanel({ session, course, group, roster }: { session: LessonSession; course: Course; group: Group; roster: Student[] }) {
  const { t, tr, lang } = useT()
  const records = useStore((s) => s.attendance.filter((r) => r.sessionId === session.id)) as Record_[]
  // A lesson moved to another date is cancelled and replaced; the replacement points back at it.
  const movedTo = useStore((s) => (session.status === 'cancelled' ? s.sessions.find((x) => x.rescheduledFromId === session.id) : undefined))
  const qr = useStore((s) => s.sessionQr[session.id])
  const setSessionAttendance = useStore((s) => s.setSessionAttendance)
  const refreshSessionQr = useStore((s) => s.refreshSessionQr)
  const setSessionStatus = useStore((s) => s.setSessionStatus)
  const correctAttendance = useStore((s) => s.correctAttendance)
  const loadGroupDetail = useStore((s) => s.loadGroupDetail)
  const notify = useStore((s) => s.notify)
  const [live, setLive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [correcting, setCorrecting] = useState<{ studentId: string; status: 'PRESENT' | 'ABSENT' | 'EXCUSED'; reason: string } | null>(null)
  const [moving, setMoving] = useState<{ date: string; start: string; end: string; note: string } | null>(null)

  useEffect(() => {
    const stop = subscribeToSession(session.id, () => setLive(true))
    return () => { stop(); setLive(false) }
  }, [session.id])

  useEffect(() => {
    if (session.attendanceOpen && !qr && session.status !== 'cancelled') {
      refreshSessionQr(session.id).catch(() => undefined)
    }
  }, [session.id, session.attendanceOpen, qr, session.status, refreshSessionQr])

  const statusOf = (studentId: string) => records.find((r) => r.studentId === studentId)
  const checked = roster.filter((st) => (statusOf(st.id)?.status ?? (statusOf(st.id) ? 'present' : undefined)) === 'present')
  const missing = roster.filter((st) => !checked.some((c) => c.id === st.id))
  const url = qr?.url ?? ''
  const copy = async () => { try { await navigator.clipboard.writeText(url); notify(t('common.copied')) } catch { notify(url) } }
  const toggle = async (open: boolean) => { setBusy(true); try { await setSessionAttendance(session.id, open) } finally { setBusy(false) } }
  const rotate = async () => { setBusy(true); try { await refreshSessionQr(session.id); notify(t('common.saved')) } finally { setBusy(false) } }
  const submitCorrection = async () => {
    if (!correcting || correcting.reason.trim().length < 3) return
    setBusy(true)
    try { await correctAttendance(session.id, correcting.studentId, correcting.status, correcting.reason.trim()); notify(t('common.saved')); setCorrecting(null) } finally { setBusy(false) }
  }
  const submitMove = async () => {
    if (!moving) return
    setBusy(true)
    try {
      await api(`/teacher/sessions/${session.id}/time`, { method: 'PATCH', body: { date: moving.date, start: moving.start, end: moving.end, note: moving.note.trim() || undefined } })
      notify(t('session.moved'))
      setMoving(null)
      await loadGroupDetail(group.id)
    } catch (err) {
      notify(isApiError(err) ? apiErrorText(err, lang) : String(err), 'warn')
    } finally { setBusy(false) }
  }

  return (
    <div className="grid gap-6 md:grid-cols-[auto_1fr]">
      <div className="flex flex-col items-center gap-3">
        <Eyebrow>{t('session.qrTitle')}</Eyebrow>
        <div className={cx('rounded-card border bg-paper p-4 transition-all duration-300', session.attendanceOpen && url ? 'border-champagne/60 shadow-md ring-1 ring-champagne/30' : 'border-charcoal/10 opacity-70')}>
          {session.attendanceOpen && url ? <QrCode value={url} size={240} label={t('session.link')} /> : <div className="flex h-[240px] w-[240px] items-center justify-center rounded-card bg-sage/60 text-center text-xs text-charcoal/55">{t('session.isClosed')}</div>}
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {session.status !== 'cancelled' && (session.attendanceOpen
            ? (
              <>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => toggle(false)}><Icon name="lock" className="h-3.5 w-3.5" />{t('session.close')}</Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={rotate} title={t('common.refresh')}><Icon name="refresh" className={cx('h-3.5 w-3.5', busy && 'animate-spin')} /></Button>
              </>
            )
            : <Button size="sm" disabled={busy} onClick={() => toggle(true)}><Icon name="play" className="h-3.5 w-3.5" />{t('session.open')}</Button>)}
          {url && <Button size="sm" variant="ghost" onClick={copy}><Icon name="external" className="h-3.5 w-3.5" />{t('common.copyLink')}</Button>}
        </div>
        {url && <a href={url} target="_blank" rel="noopener noreferrer" className="text-[11px] text-forest hover:underline font-medium">{t('session.testScan')}</a>}
      </div>
      <div className="min-w-0 space-y-4">
        <div>
          <div className="font-display text-2xl text-charcoal">{tr(course.title)} · {group.name}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-charcoal/60">
            <SessionStatus session={session} />
            {live && (
              <Badge tone="forest" className="shadow-xs flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                {t('session.live')}
              </Badge>
            )}
            <span>{formatDayMonth(session.date, lang)} · {session.start}–{session.end} · {t('common.room')} {group.room}</span>
          </div>
          {movedTo && <p className="mt-1 text-xs text-charcoal/55">{t('session.movedTo', { date: formatDayMonth(movedTo.date, lang), time: movedTo.start })}</p>}
          {session.note && <p className="mt-1 text-xs text-charcoal/55">{session.note}</p>}
        </div>
        <p className="text-xs text-charcoal/60">{t('session.qrHint')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center justify-between"><Eyebrow>{t('session.checkedIn')}</Eyebrow><Badge tone="sage">{checked.length}/{roster.length}</Badge></div>
            {checked.length === 0 ? <p className="text-xs text-charcoal/50">{t('session.noCheckins')}</p> : (
              <ul className="space-y-1.5">
                {checked.map((st) => { const r = statusOf(st.id)!; return (
                  <li key={st.id} className="flex items-center justify-between rounded-control border border-charcoal/10 bg-paper px-3 py-2 text-sm"><span className="flex items-center gap-2"><Icon name="check" className="h-3.5 w-3.5 text-forest" />{st.profile.displayName}<MethodBadge method={r.method} /></span><span className="flex items-center gap-2 text-[11px] text-charcoal/50">{formatTime(r.checkedInAt, lang)}<button type="button" className="underline" onClick={() => setCorrecting({ studentId: st.id, status: 'ABSENT', reason: '' })}>{t('session.correct')}</button></span></li>
                ) })}
              </ul>
            )}
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between"><Eyebrow>{t('session.notCheckedIn')}</Eyebrow><Badge tone="muted">{missing.length}</Badge></div>
            {missing.length === 0 ? <p className="text-xs text-charcoal/50">—</p> : (
              <ul className="space-y-1.5">{missing.map((st) => { const r = statusOf(st.id); return (
                <li key={st.id} className="flex items-center justify-between rounded-control border border-dashed border-charcoal/15 px-3 py-2 text-sm text-charcoal/60"><span>{st.profile.displayName}{r?.status === 'excused' && <Badge tone="champagne" className="ml-2">{t('session.statusExcused')}</Badge>}{r?.status === 'absent' && <Badge tone="danger" className="ml-2">{t('session.statusAbsent')}</Badge>}{r && <span className="ml-2"><MethodBadge method={r.method} /></span>}</span><button type="button" className="text-[11px] underline" onClick={() => setCorrecting({ studentId: st.id, status: 'PRESENT', reason: '' })}>{t('session.correct')}</button></li>
              ) })}</ul>
            )}
          </div>
        </div>
        {correcting && (
          <div className="rounded-card border border-champagne/70 bg-champagne/10 p-4">
            <div className="text-sm font-medium text-charcoal">{t('session.correct')}: {roster.find((x) => x.id === correcting.studentId)?.profile.displayName}</div>
            <div className="mt-3 grid gap-2 sm:grid-cols-[10rem_1fr_auto]">
              <Select value={correcting.status} onChange={(e) => setCorrecting({ ...correcting, status: e.target.value as 'PRESENT' | 'ABSENT' | 'EXCUSED' })}>
                <option value="PRESENT">{t('session.markPresent')}</option><option value="ABSENT">{t('session.markAbsent')}</option><option value="EXCUSED">{t('session.markExcused')}</option>
              </Select>
              <Input placeholder={t('session.correctReason')} value={correcting.reason} onChange={(e) => setCorrecting({ ...correcting, reason: e.target.value })} />
              <div className="flex gap-2"><Button size="sm" disabled={busy || correcting.reason.trim().length < 3} onClick={submitCorrection}>{t('common.save')}</Button><Button size="sm" variant="ghost" onClick={() => setCorrecting(null)}>{t('common.cancel')}</Button></div>
            </div>
          </div>
        )}
        {moving && (
          <div className="rounded-card border border-forest/30 bg-sage/20 p-4">
            <div className="text-sm font-medium text-charcoal">{t('session.moveTitle')}</div>
            <p className="mt-1 text-xs text-charcoal/60">{t('session.moveHint')}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-4">
              <Field label={t('session.date')}><Input type="date" value={moving.date} onChange={(e) => setMoving({ ...moving, date: e.target.value })} /></Field>
              <Field label={t('admin.groups.start')}><Input type="time" value={moving.start} onChange={(e) => setMoving({ ...moving, start: e.target.value })} /></Field>
              <Field label={t('admin.groups.end')}><Input type="time" value={moving.end} onChange={(e) => setMoving({ ...moving, end: e.target.value })} /></Field>
              <Field label={t('session.note')}><Input maxLength={300} value={moving.note} onChange={(e) => setMoving({ ...moving, note: e.target.value })} /></Field>
            </div>
            <div className="mt-3 flex gap-2"><Button size="sm" disabled={busy || !moving.date || moving.start >= moving.end} onClick={submitMove}>{t('session.move')}</Button><Button size="sm" variant="ghost" onClick={() => setMoving(null)}>{t('common.cancel')}</Button></div>
          </div>
        )}
        <Notice tone="info" className="text-[12px]">{t('attend.honest')}</Notice>
        <div className="flex flex-wrap justify-end gap-2">
          {session.status !== 'cancelled' && records.length === 0 && !moving && <Button size="sm" variant="secondary" onClick={() => setMoving({ date: session.date, start: session.start, end: session.end, note: session.note ?? '' })}><Icon name="calendar" className="h-3.5 w-3.5" />{t('session.move')}</Button>}
          {session.status === 'cancelled'
            ? <Button size="sm" variant="secondary" onClick={() => setSessionStatus(session.id, isPastSession(session) ? 'completed' : 'scheduled')}>{t('session.restore')}</Button>
            : <Button size="sm" variant="danger" onClick={() => setSessionStatus(session.id, 'cancelled')}>{t('session.cancel')}</Button>}
        </div>
      </div>
    </div>
  )
}

/** Form for a one-off lesson of a group (teacher studio and center workspace). */
export function ExtraLessonForm({ groupId, onDone }: { groupId: string; onDone: () => void }) {
  const { t, lang } = useT()
  const notify = useStore((s) => s.notify)
  const loadGroupDetail = useStore((s) => s.loadGroupDetail)
  const [draft, setDraft] = useState({ date: '', start: '18:00', end: '19:30', note: '' })
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      await api(`/teacher/groups/${groupId}/sessions`, { method: 'POST', body: { date: draft.date, start: draft.start, end: draft.end, note: draft.note.trim() || undefined } })
      notify(t('session.extraAdded'))
      await loadGroupDetail(groupId).catch(() => undefined)
      onDone()
    } catch (err) {
      notify(isApiError(err) ? apiErrorText(err, lang) : String(err), 'warn')
    } finally { setBusy(false) }
  }
  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <Field label={t('session.date')}><Input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></Field>
        <Field label={t('admin.groups.start')}><Input type="time" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} /></Field>
        <Field label={t('admin.groups.end')}><Input type="time" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} /></Field>
      </div>
      <Field label={t('session.note')}><Input maxLength={300} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} /></Field>
      <div className="flex justify-end gap-2"><Button variant="ghost" onClick={onDone}>{t('common.cancel')}</Button><Button disabled={busy || !draft.date || draft.start >= draft.end} onClick={submit}><Icon name="plus" className="h-3.5 w-3.5" />{t('session.extraAdd')}</Button></div>
    </div>
  )
}
