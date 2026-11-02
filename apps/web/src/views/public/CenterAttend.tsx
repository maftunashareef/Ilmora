'use client'
import { useCallback, useEffect, useState } from 'react'
import type { CenterCheckInFailure, L } from '@ilmora/shared'
import { Badge, Button, Card, Eyebrow, Icon, LinkButton, Notice } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { api } from '../../lib/api'
import { formatTime } from '../../lib/format'
import { Link, useNavigate, useParams } from '../../lib/router'
import { type CenterCheckInOutcome, useStore } from '../../store/useStore'

interface CenterInfo { center: { id: string; name: string; address: string | null }; requiresLocation: boolean; window: { beforeMin: number; afterMin: number } }
interface Lesson { session: { id: string; date: string; start: string; end: string; startsAt: string; status: string }; courseTitle: L; groupName: string; window: { state: 'early' | 'open' | 'late'; opensAt: string; closesAt: string }; record: { checkedInAt: string; status: string } | null }
interface Options { center: CenterInfo['center']; requiresLocation: boolean; access: { blocked: boolean; reason: string | null }; lessons: Lesson[] }
type Geo = { lat: number; lng: number; accuracyM?: number }

/**
 * Opened from the center's standing QR code: /attend/c/<code>. Shows the signed-in student's lessons at this center
 * today and checks them in to the current one. The check-in itself is an authenticated POST made by this page.
 */
export function CenterAttendPage() {
  const { code = '' } = useParams<{ code: string }>()
  const { t, tr, lang } = useT()
  const nav = useNavigate()
  const auth = useStore((s) => s.auth)
  const centerCheckIn = useStore((s) => s.centerCheckIn)
  const [info, setInfo] = useState<CenterInfo | null | undefined>(undefined)
  const [options, setOptions] = useState<Options | null>(null)
  const [result, setResult] = useState<CenterCheckInOutcome | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  const [locationDenied, setLocationDenied] = useState(false)

  useEffect(() => {
    if (!code) return
    api<CenterInfo | null>(`/attendance/centers/${encodeURIComponent(code)}`, { auth: false }).then(setInfo).catch(() => setInfo(null))
  }, [code])

  const loadOptions = useCallback(() => api<Options>(`/attendance/centers/${encodeURIComponent(code)}/options`).then(setOptions).catch(() => setOptions(null)), [code])
  useEffect(() => {
    if (auth.status === 'authenticated' && info) void loadOptions()
  }, [auth.status, info, loadOptions])

  const locate = (): Promise<Geo | null> =>
    new Promise((resolve) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve(null)
      setLocating(true)
      navigator.geolocation.getCurrentPosition(
        (p) => { setLocating(false); resolve({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy) }) },
        () => { setLocating(false); setLocationDenied(true); resolve(null) },
        { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
      )
    })

  const checkIn = async (lesson: Lesson) => {
    setBusy(lesson.session.id)
    setResult(null)
    try {
      const geo = options?.requiresLocation ? await locate() : null
      const r = await centerCheckIn(code, { sessionId: lesson.session.id, ...(geo ?? {}) })
      setResult(r)
      await loadOptions()
    } catch {
      setResult({ ok: false, reason: 'invalid-code' })
    } finally { setBusy(null) }
  }

  const failureText = (reason: CenterCheckInFailure, r?: CenterCheckInOutcome) => {
    switch (reason) {
      case 'early': return t('attend.center.early', { time: r?.window ? formatTime(r.window.opensAt, lang) : '' })
      case 'late': return t('attend.center.late', { time: r?.window ? formatTime(r.window.closesAt, lang) : '' })
      case 'blocked': return t('attend.center.blocked')
      case 'location-required': return t('attend.center.locationRequired')
      case 'too-far': return t('attend.center.tooFar', { distance: r?.distanceM ?? '?' })
      case 'not-enrolled': return t('attend.notEnrolledBody')
      case 'wrong-center': return t('attend.center.wrongCenter')
      case 'cancelled': return t('attend.center.cancelled')
      case 'center-blocked': return t('attend.center.centerBlocked')
      default: return t('attend.center.invalid')
    }
  }
  const returnTo = `/attend/c/${encodeURIComponent(code)}`

  return (
    <div className="container-x py-14 lg:py-20">
      <div className="mx-auto max-w-lg">
        <Eyebrow className="mb-2">{t('attend.center.title')}</Eyebrow>
        {info === undefined && <div className="card px-7 py-8 text-center text-sm text-charcoal/60" role="status"><Icon name="refresh" className="mr-2 inline h-4 w-4 animate-spin" /> {t('attend.checking')}</div>}
        {info === null && (
          <Card className="px-8 py-10 text-center">
            <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100 text-amber-900"><Icon name="warn" className="h-6 w-6" /></div>
            <h1 className="font-display text-3xl text-charcoal">{t('attend.center.invalid')}</h1>
            <div className="mt-7"><LinkButton to="/">{t('common.goHome')}</LinkButton></div>
          </Card>
        )}
        {info && (
          <>
            <h1 className="font-display text-3xl text-charcoal">{t('attend.center.at', { name: info.center.name })}</h1>
            {info.center.address && <p className="mt-1 text-sm text-charcoal/60">{info.center.address}</p>}
            {auth.status === 'anonymous' && (
              <Card className="mt-6 px-7 py-8">
                <p className="text-sm leading-relaxed text-charcoal/65">{t('attend.signInToCheckIn')}</p>
                <Button className="mt-6 w-full" size="lg" onClick={() => nav(`/login?next=${encodeURIComponent(returnTo)}`)}>{t('auth.signIn')} <Icon name="arrowRight" className="h-4 w-4" /></Button>
              </Card>
            )}
            {auth.status === 'authenticated' && (
              <div className="mt-6 space-y-4">
                {options?.requiresLocation && <Notice tone="info" className="text-xs">{t('attend.center.locationAsk')}</Notice>}
                {options?.access.blocked && <Notice tone="warn">{t('attend.center.blocked')} <Link to="/student/subscription" className="underline">{t('student.subscription')}</Link></Notice>}
                {result && (
                  <div role="alert">
                    {result.ok
                      ? <Notice tone="ok">{result.alreadyRecorded ? t('attend.already') : t('attend.success')} · {t('attend.center.recorded', { time: formatTime(result.record?.checkedInAt ?? new Date().toISOString(), lang) })}</Notice>
                      : <Notice tone="warn">{failureText(result.reason ?? 'invalid-code', result)}</Notice>}
                  </div>
                )}
                {locationDenied && !result && <Notice tone="warn">{t('attend.center.locationRequired')}</Notice>}
                <Eyebrow>{t('attend.center.choose')}</Eyebrow>
                {!options && <div className="text-sm text-charcoal/55">{t('common.loading')}</div>}
                {options && options.lessons.length === 0 && <Card className="px-6 py-8 text-center text-sm text-charcoal/60">{t('attend.center.none')}</Card>}
                {options && options.lessons.map((l) => {
                  const recorded = l.record && (l.record.status ?? 'present') === 'present'
                  const canCheckIn = !recorded && l.window.state === 'open' && !options.access.blocked && l.session.status !== 'cancelled'
                  return (
                    <Card key={l.session.id} className="flex flex-wrap items-center gap-4 p-4">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-charcoal">{tr(l.courseTitle)} · {l.groupName}</div>
                        <div className="mt-1 text-xs text-charcoal/55">{l.session.start}–{l.session.end}</div>
                        <div className="mt-1.5 text-xs text-charcoal/60">
                          {recorded ? <Badge tone="forest"><Icon name="check" className="h-3 w-3" />{t('attend.center.recorded', { time: formatTime(l.record!.checkedInAt, lang) })}</Badge>
                            : l.session.status === 'cancelled' ? <Badge tone="danger">{t('session.status.cancelled')}</Badge>
                            : l.window.state === 'open' ? t('attend.center.open', { until: formatTime(l.window.closesAt, lang) })
                            : l.window.state === 'early' ? t('attend.center.early', { time: formatTime(l.window.opensAt, lang) })
                            : t('attend.center.late', { time: formatTime(l.window.closesAt, lang) })}
                        </div>
                      </div>
                      {canCheckIn && (
                        <Button disabled={!!busy} onClick={() => void checkIn(l)}>
                          {busy === l.session.id ? <Icon name="refresh" className="h-4 w-4 animate-spin" /> : <Icon name="check" className="h-4 w-4" />}
                          {busy === l.session.id && locating ? t('attend.center.locating') : t('attend.center.checkIn')}
                        </Button>
                      )}
                    </Card>
                  )
                })}
                <div className="flex flex-wrap gap-2"><LinkButton to="/student/attendance" variant="secondary">{t('attend.viewMine')}</LinkButton><LinkButton to="/" variant="ghost">{t('common.goHome')}</LinkButton></div>
              </div>
            )}
            {(auth.status === 'idle' || auth.status === 'loading') && <div className="card mt-6 px-7 py-8 text-center text-sm text-charcoal/60" role="status"><Icon name="refresh" className="mr-2 inline h-4 w-4 animate-spin" /> {t('attend.checking')}</div>}
          </>
        )}
        <Notice tone="info" className="mt-5 text-[12px]">{t('attend.honest')}</Notice>
      </div>
    </div>
  )
}
