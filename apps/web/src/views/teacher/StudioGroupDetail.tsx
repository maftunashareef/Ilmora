'use client'
import { useEffect, useMemo, useState } from 'react'
import { NotFound } from '../../components/AccessGate'
import { ExtraLessonForm, SessionPanel, SessionStatus } from '../../components/attendance/SessionPanel'
import { ScheduleChips } from '../../components/course/CourseCard'
import { Badge, Button, Card, cx, EmptyState, Eyebrow, Icon, LinkButton, Modal, Notice, PageTitle, Tabs } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { enrolledStudents } from '../../lib/enrollment'
import { formatDate, formatDayMonth, formatTime } from '../../lib/format'
import { Link, useParams } from '../../lib/router'
import { isPastSession, sortSessions } from '../../lib/sessions'
import { useCurrentTeacher } from '../../store/selectors'
import { useStore } from '../../store/useStore'
import type { Student } from '../../types'

export { SessionStatus }

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
  const [adding, setAdding] = useState(false)

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
        <Card className="p-5"><div className="text-xs text-charcoal/55">{t('group.sessions')}</div><div className="mt-2 font-display text-3xl text-charcoal">{sessions.length}</div><div className="mt-1 text-xs text-charcoal/50">{t('group.upcoming')}: {upcoming.length} · {t('session.status.completed')}: {completed.length}</div></Card>
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
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <Eyebrow>{t('group.sessions')}</Eyebrow>
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setAdding(true)}><Icon name="plus" className="h-3.5 w-3.5" />{t('session.extra')}</Button>
              <Button size="sm" variant="secondary" onClick={async () => { const n = await s.generateGroupSessions(group.id, 28); s.notify(t('group.generated', { n })) }}><Icon name="plus" className="h-3.5 w-3.5" />{t('group.generate')}</Button>
            </div>
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
      <Modal open={adding} onClose={() => setAdding(false)} title={t('session.extraAdd')}>
        {adding && <ExtraLessonForm groupId={group.id} onDone={() => setAdding(false)} />}
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
