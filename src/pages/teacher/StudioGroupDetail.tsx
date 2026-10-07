import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { NotFound } from '../../components/AccessGate'
import { ScheduleChips } from '../../components/course/CourseCard'
import { QrCode } from '../../components/QrCode'
import { Badge, Button, Card, cx, EmptyState, Eyebrow, Icon, LinkButton, Modal, Notice, PageTitle, Tabs } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { enrolledStudents } from '../../lib/enrollment'
import { formatDate, formatDayMonth, formatTime } from '../../lib/format'
import { attendanceUrl, isPastSession, sortSessions } from '../../lib/sessions'
import { localAttendanceService } from '../../services/attendance'
import { useCurrentTeacher } from '../../store/selectors'
import { useStore } from '../../store/useStore'
import type { Course, Group, LessonSession, Student } from '../../types'

export function StudioGroupDetail() {
  const { groupId } = useParams()
  const { t, tr, lang } = useT()
  const teacher = useCurrentTeacher()
  const s = useStore()
  const course = s.courses.find((c) => c.groups.some((g) => g.id === groupId))
  const group = course?.groups.find((g) => g.id === groupId)
  const [tab, setTab] = useState<'upcoming' | 'previous'>('upcoming')
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)

  const sessions = useMemo(() => sortSessions(s.sessions.filter((x) => x.groupId === groupId)), [s.sessions, groupId])
  if (!course || !group || !teacher) return <NotFound />
  // Teachers only manage their own groups (ownership = the course's teacher).
  if (course.teacherId !== teacher.id) {
    return (
      <div>
        <PageTitle eyebrow={t('dash.teacherStudio')} title={t('group.details')} />
        <Notice tone="warn">{t('group.notYours')}</Notice>
        <LinkButton to="/teacher/groups" variant="secondary" className="mt-4"><Icon name="arrowLeft" className="h-4 w-4" />{t('studio.groups')}</LinkButton>
      </div>
    )
  }

  const center = s.centers.find((c) => c.id === course.centerId)
  const roster = enrolledStudents(s.students, group.id)
  const now = new Date()
  const upcoming = sessions.filter((x) => !isPastSession(x, now))
  const previous = [...sessions.filter((x) => isPastSession(x, now))].reverse()
  const completed = previous.filter((x) => x.status === 'completed')
  const recordsBySession = new Map<string, number>()
  for (const r of s.attendance) recordsBySession.set(r.sessionId, (recordsBySession.get(r.sessionId) ?? 0) + 1)
  const presentCount = (studentId: string) => completed.filter((x) => s.attendance.some((r) => r.sessionId === x.id && r.studentId === studentId)).length
  const activeSession = sessions.find((x) => x.id === activeSessionId) ?? null
  const list = tab === 'upcoming' ? upcoming : previous

  return (
    <div>
      <Link to="/teacher/groups" className="mb-3 inline-flex items-center gap-1 text-xs text-charcoal/55 hover:text-forest"><Icon name="arrowLeft" className="h-3.5 w-3.5" />{t('studio.groups')}</Link>
      <PageTitle
        eyebrow={t('group.details')}
        title={group.name}
        subtitle={<>{tr(course.title)} · {teacher.name}{center && <> · {center.name}</>}</>}
        action={<Badge tone={roster.length >= group.capacity ? 'warn' : 'sage'} className="text-sm">{t('capacity.students', { n: roster.length, max: group.capacity })}</Badge>}
      />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-5"><div className="text-xs text-charcoal/55">{t('common.schedule')}</div><div className="mt-2"><ScheduleChips group={group} /></div><div className="mt-1 text-xs text-charcoal/50">{t('common.room')} {group.room}</div></Card>
        <Card className="p-5"><div className="text-xs text-charcoal/55">{t('capacity.enrolled')}</div><div className="mt-2 font-display text-3xl text-charcoal">{roster.length} <span className="text-lg text-charcoal/40">/ {group.capacity}</span></div>{roster.length >= group.capacity ? <div className="mt-1 text-xs text-amber-800">{t('capacity.full')}</div> : <div className="mt-1 text-xs text-charcoal/50">{t('capacity.left', { n: group.capacity - roster.length })}</div>}</Card>
        <Card className="p-5"><div className="text-xs text-charcoal/55">{t('group.sessions')}</div><div className="mt-2 font-display text-3xl text-charcoal">{sessions.length}</div><div className="mt-1 text-xs text-charcoal/50">{upcoming.length} {t('group.upcoming').toLowerCase()} · {completed.length} {t('session.status.completed').toLowerCase()}</div></Card>
        <Card className="p-5"><div className="text-xs text-charcoal/55">{t('group.attendanceRate')}</div><div className="mt-2 font-display text-3xl text-charcoal">{completed.length && roster.length ? Math.round((completed.reduce((n, x) => n + (recordsBySession.get(x.id) ?? 0), 0) / (completed.length * roster.length)) * 100) : 0}%</div><div className="mt-1 text-xs text-charcoal/50">{t('student.attendance.rate')}</div></Card>
      </div>

      <div className="mt-10 grid gap-8 lg:grid-cols-[1fr_1fr]">
        {/* Roster */}
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

        {/* Sessions */}
        <section>
          <div className="mb-3 flex items-center justify-between gap-3">
            <Eyebrow>{t('group.sessions')}</Eyebrow>
            <Button size="sm" variant="secondary" onClick={() => { const n = s.generateGroupSessions(group.id, 28); s.notify(t('group.generated', { n })) }}><Icon name="plus" className="h-3.5 w-3.5" />{t('group.generate')}</Button>
          </div>
          <Tabs<'upcoming' | 'previous'> value={tab} onChange={setTab} className="mb-3" tabs={[{ id: 'upcoming', label: t('group.upcoming'), count: upcoming.length }, { id: 'previous', label: t('group.previous'), count: previous.length }]} />
          {list.length === 0 ? <EmptyState title={t('group.noSessions')} /> : (
            <ul className="space-y-2">
              {list.map((ses) => {
                const n = recordsBySession.get(ses.id) ?? 0
                return (
                  <li key={ses.id}>
                    <button type="button" onClick={() => setActiveSessionId(ses.id)} className={cx('card flex w-full items-center gap-4 p-3 text-left transition hover:shadow-lift', ses.status === 'cancelled' && 'opacity-60')}>
                      <div className="w-20 shrink-0 text-center"><div className="text-[10px] uppercase tracking-wider text-charcoal/45">{formatDayMonth(ses.date, lang)}</div><div className="font-display text-xl text-charcoal">{ses.start}</div></div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5"><SessionStatus session={ses} /></div>
                        <div className="mt-1 text-xs text-charcoal/55">{ses.start}–{ses.end} · {t('session.checkedIn')}: {n}/{roster.length}</div>
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

      <Modal open={!!activeSession} onClose={() => setActiveSessionId(null)} title={activeSession ? `${formatDayMonth(activeSession.date, lang)} · ${activeSession.start}–${activeSession.end}` : ''} wide>
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

function SessionPanel({ session, course, group, roster }: { session: LessonSession; course: Course; group: Group; roster: Student[] }) {
  const { t, tr, lang } = useT()
  const records = useStore((s) => s.attendance.filter((r) => r.sessionId === session.id))
  const setSessionStatus = useStore((s) => s.setSessionStatus)
  const notify = useStore((s) => s.notify)
  const url = attendanceUrl(session)
  const checked = roster.filter((st) => records.some((r) => r.studentId === st.id))
  const missing = roster.filter((st) => !records.some((r) => r.studentId === st.id))
  const copy = async () => { try { await navigator.clipboard.writeText(url); notify(t('common.copied')) } catch { notify(url) } }
  return (
    <div className="grid gap-6 md:grid-cols-[auto_1fr]">
      <div className="flex flex-col items-center gap-3">
        <Eyebrow>{t('session.qrTitle')}</Eyebrow>
        <div className={cx('rounded-card border border-charcoal/10 bg-paper p-3', (!session.attendanceOpen || session.status === 'cancelled') && 'opacity-60')}>
          <QrCode value={url} size={240} label={t('session.link')} />
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          {session.status !== 'cancelled' && (session.attendanceOpen
            ? <Button size="sm" variant="secondary" onClick={() => localAttendanceService.closeSession(session.id)}><Icon name="lock" className="h-3.5 w-3.5" />{t('session.close')}</Button>
            : <Button size="sm" onClick={() => localAttendanceService.openSession(session.id)}><Icon name="play" className="h-3.5 w-3.5" />{t('session.open')}</Button>)}
          <Button size="sm" variant="ghost" onClick={copy}><Icon name="external" className="h-3.5 w-3.5" />{t('common.copyLink')}</Button>
        </div>
        <a href={url} target="_blank" rel="noreferrer" className="text-[11px] text-forest underline">{t('session.testScan')}</a>
      </div>
      <div className="min-w-0 space-y-4">
        <div>
          <div className="font-display text-2xl text-charcoal">{tr(course.title)} · {group.name}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-charcoal/55"><SessionStatus session={session} /><span>{formatDayMonth(session.date, lang)} · {session.start}–{session.end} · {t('common.room')} {group.room}</span></div>
          <div className="mt-2 break-all text-[11px] text-charcoal/45">{t('session.link')}: {url}</div>
        </div>
        <p className="text-xs text-charcoal/60">{t('session.qrHint')}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center justify-between"><Eyebrow>{t('session.checkedIn')}</Eyebrow><Badge tone="sage">{checked.length}/{roster.length}</Badge></div>
            {checked.length === 0 ? <p className="text-xs text-charcoal/50">{t('session.noCheckins')}</p> : (
              <ul className="space-y-1.5">
                {checked.map((st) => { const r = records.find((x) => x.studentId === st.id)!; return (
                  <li key={st.id} className="flex items-center justify-between rounded-control border border-charcoal/10 bg-paper px-3 py-2 text-sm"><span className="flex items-center gap-2"><Icon name="check" className="h-3.5 w-3.5 text-forest" />{st.profile.displayName}</span><span className="text-[11px] text-charcoal/50">{formatTime(r.checkedInAt, lang)}</span></li>
                ) })}
              </ul>
            )}
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between"><Eyebrow>{t('session.notCheckedIn')}</Eyebrow><Badge tone="muted">{missing.length}</Badge></div>
            {missing.length === 0 ? <p className="text-xs text-charcoal/50">—</p> : (
              <ul className="space-y-1.5">{missing.map((st) => <li key={st.id} className="rounded-control border border-dashed border-charcoal/15 px-3 py-2 text-sm text-charcoal/60">{st.profile.displayName}</li>)}</ul>
            )}
          </div>
        </div>
        <Notice tone="info" className="text-[12px]">{t('session.demoNote')}</Notice>
        <div className="flex justify-end">
          {session.status === 'cancelled'
            ? <Button size="sm" variant="secondary" onClick={() => setSessionStatus(session.id, isPastSession(session) ? 'completed' : 'scheduled')}>{t('session.restore')}</Button>
            : <Button size="sm" variant="danger" onClick={() => setSessionStatus(session.id, 'cancelled')}>{t('session.cancel')}</Button>}
        </div>
      </div>
    </div>
  )
}
