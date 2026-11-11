'use client'
import { useEffect, useState } from 'react'
import { Button, Card, Eyebrow, Icon, LinkButton, Notice } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { api } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import { formatDayMonth, formatTime } from '../../lib/format'
import { Link, useNavigate, useParams, useSearchParams } from '../../lib/router'
import { type CheckInOutcome, useStore } from '../../store/useStore'

interface LinkInfo { session: { id: string; date: string; startsAt: string; endsAt: string; status: string; attendanceOpen: boolean }; courseTitle: Record<string, string>; groupName: string }

/**
 * Opened from a session QR code: /attend/:sessionId?t=<token>.
 * The check-in itself is an authenticated POST made by this page after sign-in — link previews never record anything.
 */
export function AttendPage() {
  const { sessionId = '' } = useParams<{ sessionId: string }>()
  const [params] = useSearchParams()
  const token = params.get('t') ?? ''
  const { t, tr, lang } = useT()
  const nav = useNavigate()
  const auth = useStore((s) => s.auth)
  const checkIn = useStore((s) => s.checkIn)
  const [info, setInfo] = useState<LinkInfo | null | undefined>(undefined)
  const [result, setResult] = useState<CheckInOutcome | null>(null)
  // A failed request (no connection, server error, too many attempts) is not «invalid link»: it is shown as is, with a retry (М13).
  const [failure, setFailure] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!sessionId) return
    // An empty answer means there is no such session (М13: it used to count as a working link). A failed request says
    // nothing about the link: the check-in itself answers then.
    api<LinkInfo | null>(`/attendance/links/${sessionId}`, { auth: false }).then((r) => setInfo(r ?? null), () => undefined)
  }, [sessionId])

  useEffect(() => {
    if (auth.status !== 'authenticated' || !token || !sessionId || result || busy || failure != null) return
    setBusy(true)
    checkIn({ sessionId, token })
      .then(setResult, setFailure)
      .finally(() => setBusy(false))
  }, [auth.status, token, sessionId, result, busy, failure, checkIn])

  const sessionLine = info ? `${tr(info.courseTitle as never)} · ${info.groupName} · ${formatDayMonth(info.session.date, lang)} · ${formatTime(info.session.startsAt, lang)}–${formatTime(info.session.endsAt, lang)}` : ''
  const linkValid = !!token && info !== null

  const state = !linkValid
    ? { icon: 'warn', tone: 'warn' as const, title: t('attend.invalid'), body: t('attend.invalidBody') }
    : result?.ok && !result.alreadyRecorded
      ? { icon: 'check', tone: 'ok' as const, title: t('attend.success'), body: t('attend.successBody', { time: formatTime(result.record?.checkedInAt ?? new Date().toISOString(), lang) }) }
      : result?.ok && result.alreadyRecorded
        ? { icon: 'info', tone: 'info' as const, title: t('attend.already'), body: t('attend.alreadyBody', { time: formatTime(result.record?.checkedInAt ?? new Date().toISOString(), lang) }) }
        : result && !result.ok && result.reason === 'closed'
          ? { icon: 'lock', tone: 'warn' as const, title: t('attend.closed'), body: t('attend.closedBody') }
          : result && !result.ok && result.reason === 'expired'
            ? { icon: 'lock', tone: 'warn' as const, title: t('attend.expired'), body: t('attend.expiredBody') }
            : result && !result.ok && result.reason === 'not-enrolled'
              ? { icon: 'warn', tone: 'warn' as const, title: t('attend.notEnrolled'), body: t('attend.notEnrolledBody') }
              : result && !result.ok && result.reason === 'blocked'
                ? { icon: 'lock', tone: 'warn' as const, title: t('attend.blocked'), body: t('attend.blockedBody') }
                : result && !result.ok
                  ? { icon: 'warn', tone: 'warn' as const, title: t('attend.invalid'), body: t('attend.invalidBody') }
                  : failure != null
                    ? { icon: 'warn', tone: 'warn' as const, title: t('attend.failed'), body: apiErrorText(failure, lang) }
                    : null

  const returnTo = `/attend/${sessionId}?t=${encodeURIComponent(token)}`

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
            {result?.ok && auth.user && <p className="mt-2 text-xs text-charcoal/45">{auth.user.displayName}</p>}
            <div className="mt-7 flex flex-wrap justify-center gap-2">
              {failure != null && <Button onClick={() => setFailure(null)}><Icon name="refresh" className="h-4 w-4" />{t('q.retry')}</Button>}
              {result?.reason === 'blocked' && <LinkButton to="/student/subscription">{t('student.subscription')}</LinkButton>}
              {auth.status === 'authenticated' && <LinkButton to="/student/attendance" variant="secondary">{t('attend.viewMine')}</LinkButton>}
              <LinkButton to="/">{t('common.goHome')}</LinkButton>
            </div>
          </Card>
        ) : auth.status === 'anonymous' ? (
          <Card className="px-7 py-8">
            <h1 className="font-display text-3xl text-charcoal">{t('attend.identity')}</h1>
            <p className="mt-3 text-sm leading-relaxed text-charcoal/65">{t('attend.signInToCheckIn')}</p>
            <Button className="mt-6 w-full" size="lg" onClick={() => nav(`/login?next=${encodeURIComponent(returnTo)}`)}>{t('auth.signIn')} <Icon name="arrowRight" className="h-4 w-4" /></Button>
          </Card>
        ) : (
          <div className="card px-7 py-8 text-center text-sm text-charcoal/60" role="status" aria-live="polite">
            <Icon name="refresh" className="mr-2 inline h-4 w-4 animate-spin" /> {t('attend.checking')}
          </div>
        )}
        <Notice tone="info" className="mt-5 text-[12px]">{t('attend.honest')}</Notice>
        <p className="mt-4 text-center text-[11px] text-charcoal/45"><Link to="/" className="underline">ILMORA</Link> · {t('access.securityNote')}</p>
      </div>
    </div>
  )
}
