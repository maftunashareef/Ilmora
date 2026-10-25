'use client'
import { useEffect, useMemo, useState } from 'react'
import { NotFound } from '../../components/AccessGate'
import { ScheduleChips } from '../../components/course/CourseCard'
import { QrCode } from '../../components/QrCode'
import { Badge, Button, Card, cx, EmptyState, Eyebrow, Icon, Input, LinkButton, Modal, Notice, PageTitle, Select, Tabs } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { enrolledStudents } from '../../lib/enrollment'
import { formatDate, formatDayMonth, formatTime } from '../../lib/format'
import { Link, useParams } from '../../lib/router'
import { isPastSession, sortSessions } from '../../lib/sessions'
import { subscribeToSession } from '../../services/attendance'
import { useCurrentTeacher } from '../../store/selectors'
import { useStore } from '../../store/useStore'
import type { Course, Group, LessonSession, Student } from '../../types'

type Record_ = { studentId: string; status?: string; method: string; checkedInAt: string }

export function StudioGroupDetail() {
  const { groupId = '' } = useParams<{ groupId: string }>()
  const { t, tr, lang } = useT()
  const teacher = useCurrentTeacher()
  const role = useStore((s) => s.role)
  const s = useStore()
  const loadGroupDetail = useStore((x) => x.loadGroupDetail)
  const [loaded, setLoaded] = useState(false)
  const [tab, setTab] = useState<'upcoming' | 'previous'>('upcoming')
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  useEffect(() => {
    if (!groupId) return
    setLoaded(false)
    loadGroupDetail(groupId).finally(() => setLoaded(true))
  }, [groupId, loadGroupDetail])

  const course = s.courses.find((c) => c.groups.some((g) => g.id === groupId))
  const group = course?.groups.find((g) => g.id === groupId)
  const sessions = useMemo(() => sortSessions(s.sessions.filter((x) => x.groupId === groupId)), [s.sessions, groupId])
  if (!loaded && (!course || !group)) return <div className="py-16 text-center text-sm text-charcoal/55">{t('common.loading')}</div>
  if (!course || !group) return <NotFound />
  const canManage = role === 'admin' || (teacher && course.teacherId === teacher.id)
  if (!canManage) {
    return (
      <div>
        <PageTitle eyebrow={t('dash.teacherStudio')} title={t('group.details')} />
        <Notice tone="warn">{t('group.notYours')}</Notice>
        <LinkButton to="/teacher/groups" variant="secondary" className="mt-4"><Icon name="arrowLeft" className="h-4 w-4" />{t('studio.groups')}</LinkButton>
      </div>
    )
  }

  const center = s.centers.find((c) => c.id === course.centerId)
  const owner = s.teachers.find((x) => x.id === course.teacherId)
  const roster = enrolledStudents(s.students, group.id)
  const now = new Date()
  const upcoming = sessions.filter((x) => !isPastSession(x, now))
  const previous = [...sessions.filter((x) => isPastSession(x, now))].reverse()
  const completed = previous.filter((x) => x.status === 'completed')
  const present = (sessionId: string, studentId: string) => s.attendance.some((r) => r.sessionId === sessionId && r.studentId === studentId && (r.status ?? 'present') === 'present')
  const recordsBySession = new Map<string, number>()
  for (const r of s.attendance) if ((r.status ?? 'present') === 'present') recordsBySession.set(r.sessionId, (recordsBySession.get(r.sessionId) ?? 0) + 1)
  const presentCount = (studentId: string) => completed.filter((x) => present(x.id, studentId)).length
  const activeSession = sessions.find((x) => x.id === activeSessionId) ?? null
  const list = tab === 'upcoming' ? upcoming : previous

  return (
    <div>
      <Link to="/teacher/groups" className="mb-3 inline-flex items-center gap-1 text-xs text-charcoal/55 hover:text-forest"><Icon name="arrowLeft" className="h-3.5 w-3.5" />{t('studio.groups')}</Link>
      <PageTitle
        eyebrow={t('group.details')}
        title={group.name}
        subtitle={<>{tr(course.title)} · {owner?.name}{center && <> · {center.name}</>}</>}
        action={<Badge tone={roster.length >= group.capacity ? 'warn' : 'sage'} className="text-sm">{t('capacity.students', { n: roster.length, max: group.capacity })}</Badge>}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-5"><div className="text-xs text-charcoal/55">{t('common.schedule')}</div><div className="mt-2"><ScheduleChips group={group} /></div><div className="mt-1 text-xs text-charcoal/50">{t('common.room')} {group.room}</div></Card>
        <Card className="p-5"><div className="text-xs text-charcoal/55">{t('capacity.enrolled')}</div><div className="mt-2 font-display text-3xl text-charcoal">{roster.length} <span className="text-lg text-charcoal/40">/ {group.capacity}</span></div>{roster.length >= group.capacity ? <div className="mt-1 text-xs text-amber-800">{t('capacity.full')}</div> : <div className="mt-1 text-xs text-charcoal/50">{t('capacity.left', { n: group.capacity - roster.length })}</div>}</Card>
        <Card className="p-5"><div className="text-xs text-charcoal/55">{t('group.sessions')}</div><div className="mt-2 font-display text-3xl text-charcoal">{sessions.length}</div><div className="mt-1 text-xs text-charcoal/50">{upcoming.length} {t('group.upcoming').toLowerCase()} · {completed.length} {t('session.status.completed').toLowerCase()}</div></Card>
        <Card className="p-5"><div className="text-xs text-charcoal/55">{t('group.attendanceRate')}</div><div className="mt-2 font-display text-3xl text-charcoal">{completed.length && roster.length ? Math.round((completed.reduce((n, x) => n + (recordsBySession.get(x.id) ?? 0), 0) / (completed.length * roster.length)) * 100) : 0}%</div><div className="mt-1 text-xs text-charcoal/50">{t('student.attendance.rate')}</div></Card>
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_1fr]">
        <section>
          <Eyebrow className="mb-3">{t('group.roster')} · {roster.length}</Eyebrow>
          {roster.length === 0 ? <EmptyState title={t('group.noStudents')} /> : (
            <>
              <div className="card hidden overflow-hidden p-0 md:block">
                <table className="w-full text-sm">
                  <thead className="bg-ivory/70 text-left text-[11px] uppercase tracking-wider text-charcoal/50"><tr><th className="px-4 py-3">{t('common.student')}</th><th className="px-3 py-3">{t('student.profile.district')}</th><th className="px-3 py-3">{t('student.sub.package')}</th><th className="px-3 py-3">{t('group.since')}</th><th className="px-3 py-3 text-right">{t('group.attendanceRate')}</th></tr></thead>
                  <tbody className="divide-y divide-charcoal/8">
                    {roster.map((st) => <RosterRow key={st.id} st={st} present={presentCount(st.id)} total={completed.length} />)}
                  </tbody>
                </table>
              </div>
              <ul className="space-y-2 md:hidden">
                {roster.map((st) => (
                  <li key={st.id} className="card flex items-center justify-between gap-3 p-4">
                    <div><div className="font-medium text-charcoal">{st.profile.displayName}</div><div className="text-xs text-charcoal/55">{st.profile.district} · {tr(s.site.packages.find((p) => p.id === st.subscription.packageId)?.name)}</div></div>
                    <Badge tone="sage">{presentCount(st.id)}/{completed.length}</Badge>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <Eyebrow>{t('group.sessions')}</Eyebrow>
            <Button size="sm" variant="secondary" onClick={async () => { const n = await s.generateGroupSessions(group.id, 28); s.notify(t('group.generated', { n })) }}><Icon name="plus" className="h-3.5 w-3.5" />{t('group.generate')}</Button>
          </div>
          <Tabs<'upcoming' | 'previous'> value={tab} onChange={setTab} className="mb-3" tabs={[{ id: 'upcoming', label: t('group.upcoming'), count: upcoming.length }, { id: 'previous', label: t('group.previous'), count: previous.length }]} />
          {list.length === 0 ? <EmptyState title={t('group.noSessions')} /> : (
            <ul className="space-y-2">
              {list.map((ses) => {
                const n = recordsBySession.get(ses.id) ?? 0
                return (
                  <li key={ses.id}>
                    <button type="button" onClick={() => setActiveSessionId(ses.id)} className={cx('card flex w-full items-center gap-4 p-3 text-left transition hover:shadow-lift', ses.status === 'cancelled' && 'opacity-60')}>
                      <div className="w-20 shrink-0 text-center"><div className="text-[10px] uppercase tracking-wider text-charcoal/45">{formatDayMonth(ses.date, lang)}</div><div className="font-display text-xl text-charcoal">{formatTime(ses.startsAt ?? `${ses.date}T${ses.start}:00`, lang)}</div></div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5"><SessionStatus session={ses} /></div>
                        <div className="mt-1 text-xs text-charcoal/55">{t('session.checkedIn')}: {n}/{roster.length}</div>
                      </div>
                      <Icon name="arrowRight" className="h-4 w-4 shrink-0 text-charcoal/40" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      <Modal open={!!activeSession} onClose={() => setActiveSessionId(null)} title={activeSession ? `${formatDayMonth(activeSession.date, lang)} · ${formatTime(activeSession.startsAt ?? `${activeSession.date}T${activeSession.start}:00`, lang)}` : ''} wide>
        {activeSession && <SessionPanel session={activeSession} course={course} group={group} roster={roster} />}
      </Modal>
    </div>
  )
}

function RosterRow({ st, present, total }: { st: Student; present: number; total: number }) {
  const { tr, lang } = useT()
  const pkg = useStore((s) => s.site.packages.find((p) => p.id === st.subscription.packageId))
  return (
    <tr className="hover:bg-ivory/40">
      <td className="px-4 py-2.5 font-medium text-charcoal">{st.profile.displayName}</td>
      <td className="px-3 py-2.5 text-charcoal/70">{st.profile.district}</td>
      <td className="px-3 py-2.5 text-charcoal/70">{tr(pkg?.name)}</td>
      <td className="px-3 py-2.5 text-charcoal/70">{formatDate(st.subscription.startedAt, lang)}</td>
      <td className="px-3 py-2.5 text-right"><Badge tone={total && present / total >= 0.75 ? 'sage' : 'muted'}>{present}/{total}</Badge></td>
    </tr>
  )
}

export function SessionStatus({ session }: { session: LessonSession }) {
  const { t } = useT()
  return (
    <>
      <Badge tone={session.status === 'completed' ? 'muted' : session.status === 'cancelled' ? 'danger' : 'sage'}>{t(`session.status.${session.status}`)}</Badge>
      {session.status !== 'cancelled' && (session.attendanceOpen ? <Badge tone="forest"><Icon name="check" className="h-3 w-3" />{t('session.isOpen')}</Badge> : <Badge tone="neutral"><Icon name="lock" className="h-3 w-3" />{t('session.isClosed')}</Badge>)}
    </>
  )
}

/** QR + live roster for one session. Live updates arrive over SSE while the panel is open. */
function SessionPanel({ session, course, group, roster }: { session: LessonSession; course: Course; group: Group; roster: Student[] }) {
  const { t, tr, lang } = useT()
  const records = useStore((s) => s.attendance.filter((r) => r.sessionId === session.id)) as Record_[]
  const qr = useStore((s) => s.sessionQr[session.id])
  const setSessionAttendance = useStore((s) => s.setSessionAttendance)
  const refreshSessionQr = useStore((s) => s.refreshSessionQr)
  const setSessionStatus = useStore((s) => s.setSessionStatus)
  const correctAttendance = useStore((s) => s.correctAttendance)
  const notify = useStore((s) => s.notify)
  const [live, setLive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [correcting, setCorrecting] = useState<{ studentId: string; status: 'PRESENT' | 'ABSENT' | 'EXCUSED'; reason: string } | null>(null)

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
        {url && <a href={url} target="_blank" rel="noreferrer" className="text-[11px] text-forest hover:underline font-medium">{t('session.testScan')}</a>}
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
            <span>{formatDayMonth(session.date, lang)} · {t('common.room')} {group.room}</span>
          </div>
        </div>
        <p className="text-xs text-charcoal/60">{t('session.qrHint')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center justify-between"><Eyebrow>{t('session.checkedIn')}</Eyebrow><Badge tone="sage">{checked.length}/{roster.length}</Badge></div>
            {checked.length === 0 ? <p className="text-xs text-charcoal/50">{t('session.noCheckins')}</p> : (
              <ul className="space-y-1.5">
                {checked.map((st) => { const r = statusOf(st.id)!; return (
                  <li key={st.id} className="flex items-center justify-between rounded-control border border-charcoal/10 bg-paper px-3 py-2 text-sm"><span className="flex items-center gap-2"><Icon name="check" className="h-3.5 w-3.5 text-forest" />{st.profile.displayName}{r.method === 'manual' && <Badge tone="muted">{t('session.correct')}</Badge>}</span><span className="flex items-center gap-2 text-[11px] text-charcoal/50">{formatTime(r.checkedInAt, lang)}<button type="button" className="underline" onClick={() => setCorrecting({ studentId: st.id, status: 'ABSENT', reason: '' })}>{t('session.correct')}</button></span></li>
                ) })}
              </ul>
            )}
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between"><Eyebrow>{t('session.notCheckedIn')}</Eyebrow><Badge tone="muted">{missing.length}</Badge></div>
            {missing.length === 0 ? <p className="text-xs text-charcoal/50">—</p> : (
              <ul className="space-y-1.5">{missing.map((st) => { const r = statusOf(st.id); return (
                <li key={st.id} className="flex items-center justify-between rounded-control border border-dashed border-charcoal/15 px-3 py-2 text-sm text-charcoal/60"><span>{st.profile.displayName}{r?.status === 'excused' && <Badge tone="champagne" className="ml-2">{t('session.statusExcused')}</Badge>}{r?.status === 'absent' && <Badge tone="danger" className="ml-2">{t('session.statusAbsent')}</Badge>}</span><button type="button" className="text-[11px] underline" onClick={() => setCorrecting({ studentId: st.id, status: 'PRESENT', reason: '' })}>{t('session.correct')}</button></li>
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
        <Notice tone="info" className="text-[12px]">{t('attend.honest')}</Notice>
        <div className="flex justify-end">
          {session.status === 'cancelled'
            ? <Button size="sm" variant="secondary" onClick={() => setSessionStatus(session.id, isPastSession(session) ? 'completed' : 'scheduled')}>{t('session.restore')}</Button>
            : <Button size="sm" variant="danger" onClick={() => setSessionStatus(session.id, 'cancelled')}>{t('session.cancel')}</Button>}
        </div>
      </div>
    </div>
  )
}
