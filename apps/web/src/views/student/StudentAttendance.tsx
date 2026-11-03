import { useEffect } from 'react'
import { Badge, Card, EmptyState, Eyebrow, Icon, LinkButton, Notice, PageTitle, Stat } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { formatDayMonth, formatTime } from '../../lib/format'
import { isPastSession, sortSessions } from '../../lib/sessions'
import { useCurrentStudent } from '../../store/selectors'
import { useStore } from '../../store/useStore'

export function StudentAttendance() {
  const { t, tr, lang } = useT()
  const student = useCurrentStudent()
  const courses = useStore((s) => s.courses)
  const sessions = useStore((s) => s.sessions)
  const attendance = useStore((s) => s.attendance)
  const loadMyAttendance = useStore((s) => s.loadMyAttendance)
  const studentId = student?.id
  useEffect(() => {
    if (studentId) void loadMyAttendance().catch(() => undefined)
  }, [studentId, loadMyAttendance])
  if (!student) return null
  const groupIds = student.subscription.status === 'active' ? student.subscription.groupIds : []
  const mine = sortSessions(sessions.filter((x) => groupIds.includes(x.groupId) && x.status !== 'cancelled'))
  const now = new Date()
  const past = [...mine.filter((x) => isPastSession(x, now))].reverse()
  const upcoming = mine.filter((x) => !isPastSession(x, now))
  const records = attendance.filter((r) => r.studentId === student.id)
  // Only PRESENT records count; ABSENT (also the worker's automatic ones) and EXCUSED are shown as such.
  const presentIds = new Set(records.filter((r) => (r.status ?? 'present') === 'present').map((r) => r.sessionId))
  const presentCount = past.filter((x) => presentIds.has(x.id)).length
  const courseOf = (courseId: string) => courses.find((c) => c.id === courseId)
  const groupOf = (groupId: string) => courses.flatMap((c) => c.groups).find((g) => g.id === groupId)

  return (
    <div>
      <PageTitle eyebrow={t('dash.studentSpace')} title={t('student.attendance')} subtitle={t('student.attendance.note')} />
      {groupIds.length === 0 ? (
        <EmptyState title={t('student.overview.noSub')} action={<LinkButton to="/builder">{t('student.overview.buildOne')}</LinkButton>} />
      ) : (
        <>
          <div className="reveal-stagger grid gap-4 sm:grid-cols-3">
            <Stat label={t('student.attendance.rate')} value={`${presentCount} / ${past.length}`} hint={past.length ? `${Math.round((presentCount / past.length) * 100)}%` : undefined} />
            <Stat label={t('group.upcoming')} value={upcoming.length} hint={t('group.sessionsCount')} />
            <Stat label={t('common.groups')} value={groupIds.length} />
          </div>
          <div className="mt-10 grid gap-8 lg:grid-cols-2">
            <section>
              <Eyebrow className="mb-3">{t('group.previous')}</Eyebrow>
              {past.length === 0 ? <EmptyState title={t('student.attendance.empty')} /> : (
                <ul className="space-y-2">
                  {past.map((ses) => {
                    const r = records.find((x) => x.sessionId === ses.id)
                    return (
                      <li key={ses.id} className="card flex items-center gap-4 p-3">
                        <div className="w-20 shrink-0 text-center"><div className="text-[10px] uppercase tracking-wider text-charcoal/45">{formatDayMonth(ses.date, lang)}</div><div className="font-display text-xl text-charcoal">{ses.start}</div></div>
                        <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-charcoal">{tr(courseOf(ses.courseId)?.title)}</div><div className="text-xs text-charcoal/55">{groupOf(ses.groupId)?.name} · {ses.start}–{ses.end}</div></div>
                        {r && (r.status ?? 'present') === 'present'
                          ? <Badge tone="sage"><Icon name="check" className="h-3 w-3" />{t('group.present')} · {formatTime(r.checkedInAt, lang)}</Badge>
                          : r?.status === 'excused' ? <Badge tone="champagne">{t('session.statusExcused')}</Badge>
                          : <Badge tone={r ? 'danger' : 'muted'}>{t('group.absent')}</Badge>}
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
            <section>
              <Eyebrow className="mb-3">{t('group.upcoming')}</Eyebrow>
              {upcoming.length === 0 ? <EmptyState title={t('group.noSessions')} /> : (
                <ul className="space-y-2">
                  {upcoming.map((ses) => (
                    <li key={ses.id} className="card flex items-center gap-4 p-3">
                      <div className="w-20 shrink-0 text-center"><div className="text-[10px] uppercase tracking-wider text-charcoal/45">{formatDayMonth(ses.date, lang)}</div><div className="font-display text-xl text-charcoal">{ses.start}</div></div>
                      <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-charcoal">{tr(courseOf(ses.courseId)?.title)}</div><div className="text-xs text-charcoal/55">{groupOf(ses.groupId)?.name} · {ses.start}–{ses.end}</div></div>
                      {ses.attendanceOpen ? <Badge tone="forest">{t('session.isOpen')}</Badge> : <Badge tone="neutral">{t('session.status.scheduled')}</Badge>}
                    </li>
                  ))}
                </ul>
              )}
              <Card className="mt-4 p-4 text-xs text-charcoal/60">{t('session.qrHint')}</Card>
            </section>
          </div>
          <Notice tone="info" className="mt-6 text-xs">{t('session.demoNote')}</Notice>
        </>
      )}
    </div>
  )
}
