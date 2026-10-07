import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Button, Card, Eyebrow, Field, Icon, LinkButton, Notice, Select } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { formatDayMonth, formatTime } from '../../lib/format'
import { localAttendanceService, type CheckInResult } from '../../services/attendance'
import { useStore } from '../../store/useStore'

/**
 * Attendance link opened from a session QR code: /attend/:sessionId?t=<token>
 * Demo identity = the student role active in this browser (an explicit prerequisite).
 */
export function AttendPage() {
  const { sessionId = '' } = useParams()
  const [params] = useSearchParams()
  const token = params.get('t') ?? ''
  const { t, tr, lang } = useT()
  const role = useStore((s) => s.role)
  const currentStudentId = useStore((s) => s.currentStudentId)
  const students = useStore((s) => s.students)
  const setRole = useStore((s) => s.setRole)
  const setCurrentStudent = useStore((s) => s.setCurrentStudent)
  const session = useStore((s) => s.sessions.find((x) => x.id === sessionId))
  const course = useStore((s) => s.courses.find((c) => c.id === session?.courseId))
  const group = course?.groups.find((g) => g.id === session?.groupId)
  const [pick, setPick] = useState(currentStudentId)
  const [result, setResult] = useState<CheckInResult | null>(null)

  const linkValid = !!session && !!token && session.token === token
  const identityReady = role === 'student' && !!currentStudentId

  // Once the link is valid and the identity is established, the check-in runs automatically (idempotent).
  useEffect(() => {
    if (!linkValid || !identityReady) return
    setResult(localAttendanceService.checkIn({ sessionId, token, studentId: currentStudentId }))
  }, [linkValid, identityReady, sessionId, token, currentStudentId])

  const sessionLine = session && course && group ? `${tr(course.title)} · ${group.name} · ${formatDayMonth(session.date, lang)} · ${session.start}–${session.end}` : ''

  const state = !linkValid
    ? { icon: 'warn', tone: 'warn' as const, title: t('attend.invalid'), body: t('attend.invalidBody') }
    : result && result.ok && !result.alreadyRecorded
      ? { icon: 'check', tone: 'ok' as const, title: t('attend.success'), body: t('attend.successBody', { time: formatTime(result.record.checkedInAt, lang) }) }
      : result && result.ok && result.alreadyRecorded
        ? { icon: 'info', tone: 'info' as const, title: t('attend.already'), body: t('attend.alreadyBody', { time: formatTime(result.record.checkedInAt, lang) }) }
        : result && !result.ok && result.reason === 'closed'
          ? { icon: 'lock', tone: 'warn' as const, title: t('attend.closed'), body: t('attend.closedBody') }
          : result && !result.ok && result.reason === 'not-enrolled'
            ? { icon: 'warn', tone: 'warn' as const, title: t('attend.notEnrolled'), body: t('attend.notEnrolledBody') }
            : null

  return (
    <div className="container-x py-14 lg:py-20">
      <div className="mx-auto max-w-lg">
        <Eyebrow className="mb-2">{t('attend.title')}</Eyebrow>
        {sessionLine && <p className="mb-5 text-sm text-charcoal/60">{sessionLine}</p>}
        {state ? (
          <Card className="px-8 py-10 text-center">
            <div className={`mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full ${state.tone === 'ok' ? 'bg-forest text-ivory' : state.tone === 'info' ? 'bg-sage text-forest' : 'bg-amber-100 text-amber-900'}`}><Icon name={state.icon} className="h-6 w-6" /></div>
            <h1 className="font-display text-3xl text-charcoal">{state.title}</h1>
            <p className="mt-3 text-sm leading-relaxed text-charcoal/65">{state.body}</p>
            {result && result.ok && <p className="mt-2 text-xs text-charcoal/45">{students.find((s) => s.id === currentStudentId)?.profile.displayName}</p>}
            <div className="mt-7 flex flex-wrap justify-center gap-2">
              {role === 'student' && <LinkButton to="/student/attendance" variant="secondary">{t('attend.viewMine')}</LinkButton>}
              <LinkButton to="/">{t('common.goHome')}</LinkButton>
            </div>
          </Card>
        ) : (
          <Card className="px-7 py-8">
            <h1 className="font-display text-3xl text-charcoal">{t('attend.identity')}</h1>
            <p className="mt-3 text-sm leading-relaxed text-charcoal/65">{t('attend.identityBody')}</p>
            <Field label={t('common.student')} className="mt-6">
              <Select value={pick} onChange={(e) => setPick(e.target.value)}>
                {students.map((st) => <option key={st.id} value={st.id}>{st.profile.displayName}</option>)}
              </Select>
            </Field>
            <Button className="mt-5 w-full" size="lg" onClick={() => { setCurrentStudent(pick); setRole('student') }}>{t('attend.continue')} <Icon name="arrowRight" className="h-4 w-4" /></Button>
          </Card>
        )}
        <Notice tone="info" className="mt-5 text-[12px]">{t('session.demoNote')}</Notice>
        <p className="mt-4 text-center text-[11px] text-charcoal/45"><Link to="/" className="underline">ILMORA</Link> · {t('access.securityNote')}</p>
      </div>
    </div>
  )
}
