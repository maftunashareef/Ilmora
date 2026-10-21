'use client'
import { useEffect, useState } from 'react'
import { Button, Card, Eyebrow, Icon, LinkButton, Notice } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { api } from '../../lib/api'
import { formatDate, formatSom } from '../../lib/format'
import { useNavigate, useParams } from '../../lib/router'
import { useStore } from '../../store/useStore'

interface PaymentStatus { id: string; state: 'PENDING' | 'PAID' | 'CANCELLED' | 'EXPIRED' | 'REFUNDED'; provider: string | null; amountMinor: string; currency: string; paidAt: string | null; periodStart: string; periodEnd: string; receiptNumber: string | null }

/** Landing page after the provider redirect. Polls the payment until the provider callback settles it. */
export function PaymentReturnPage() {
  const { id = '' } = useParams<{ id: string }>()
  const { t, lang } = useT()
  const nav = useNavigate()
  const auth = useStore((s) => s.auth)
  const loadStudentOverview = useStore((s) => s.loadStudentOverview)
  const [status, setStatus] = useState<PaymentStatus | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (auth.status !== 'authenticated' || !id) return
    let stop = false
    let attempts = 0
    const tick = async () => {
      try {
        const s = await api<PaymentStatus>(`/payments/${id}`)
        if (stop) return
        setStatus(s)
        if (s.state === 'PAID') { await loadStudentOverview().catch(() => undefined); return }
        if (s.state === 'PENDING' && attempts++ < 60) setTimeout(tick, 3000)
      } catch {
        if (!stop) setError(true)
      }
    }
    void tick()
    return () => { stop = true }
  }, [auth.status, id, loadStudentOverview])

  if (auth.status === 'anonymous') {
    return (
      <div className="container-x py-16">
        <Card className="mx-auto max-w-lg px-8 py-10 text-center">
          <p className="text-sm text-charcoal/65">{t('checkout.signInFirst')}</p>
          <Button className="mt-5" onClick={() => nav(`/login?next=${encodeURIComponent(`/payments/${id}/return`)}`)}>{t('auth.signIn')}</Button>
        </Card>
      </div>
    )
  }

  const paid = status?.state === 'PAID'
  const failed = status && status.state !== 'PAID' && status.state !== 'PENDING'

  return (
    <div className="container-x py-16">
      <Card className="mx-auto max-w-xl px-8 py-12 text-center">
        <Eyebrow className="mb-3">{t('checkout.statusTitle')}</Eyebrow>
        <div className={`mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full ${paid ? 'bg-forest text-ivory' : failed || error ? 'bg-amber-100 text-amber-900' : 'bg-sage text-forest'}`}>
          <Icon name={paid ? 'check' : failed || error ? 'warn' : 'refresh'} className={`h-6 w-6 ${!status && !error ? 'animate-spin' : ''}`} />
        </div>
        <h1 className="font-display text-3xl text-charcoal">{paid ? t('checkout.paid') : failed ? t('checkout.failed') : t('checkout.pending')}</h1>
        {status && (
          <dl className="mx-auto mt-5 grid max-w-sm grid-cols-2 gap-3 text-left text-xs">
            <div><dt className="text-charcoal/50">{t('builder.monthlyTotal')}</dt><dd className="font-medium text-charcoal">{formatSom(Number(status.amountMinor) / 100, lang)}</dd></div>
            <div><dt className="text-charcoal/50">{t('checkout.provider')}</dt><dd className="font-medium text-charcoal">{status.provider ?? '—'}</dd></div>
            <div><dt className="text-charcoal/50">{t('student.sub.renews')}</dt><dd className="font-medium text-charcoal">{formatDate(status.periodEnd, lang)}</dd></div>
            {status.receiptNumber && <div><dt className="text-charcoal/50">{t('checkout.receipt')}</dt><dd className="font-medium text-charcoal">{status.receiptNumber}</dd></div>}
          </dl>
        )}
        {error && <Notice tone="warn" className="mt-5">{t('checkout.failed')}</Notice>}
        <div className="mt-8 flex flex-wrap justify-center gap-2">
          {paid ? <Button size="lg" onClick={() => nav('/student')}>{t('preview.goToDashboard')} <Icon name="arrowRight" className="h-4 w-4" /></Button> : failed ? <LinkButton to="/preview">{t('checkout.title')}</LinkButton> : null}
          <LinkButton to="/student/subscription" variant="secondary">{t('student.subscription')}</LinkButton>
        </div>
      </Card>
    </div>
  )
}
