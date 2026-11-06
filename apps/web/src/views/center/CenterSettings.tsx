'use client'
import { useEffect, useState } from 'react'
import { QrCode } from '../../components/QrCode'
import { Button, Card, Eyebrow, Field, Icon, Input, LField, Notice, PageTitle } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { api, isApiError } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import { formatDate } from '../../lib/format'
import { useStore } from '../../store/useStore'
import { useCenterScope, type CenterOverview, type CenterProfile, type CenterQr } from './centerApi'
import { CenterStatusNotice } from './CenterOverview'

type Draft = { name: string; district: CenterProfile['district']; description: CenterProfile['description']; address: string; phone: string; lat: string; lng: string; geoRadiusM: string; checkInBeforeMin: string; absenceAfterMin: string }
const toDraft = (c: CenterProfile): Draft => ({
  name: c.name, district: c.district, description: c.description, address: c.address ?? '', phone: c.phone ?? '',
  lat: c.checkIn.lat == null ? '' : String(c.checkIn.lat), lng: c.checkIn.lng == null ? '' : String(c.checkIn.lng), geoRadiusM: c.checkIn.geoRadiusM == null ? '' : String(c.checkIn.geoRadiusM),
  checkInBeforeMin: String(c.checkIn.checkInBeforeMin), absenceAfterMin: String(c.checkIn.absenceAfterMin),
})
const num = (s: string) => (s.trim() === '' ? null : Number(s))

/** The center's own details, the check-in window and location rule, and the standing QR code. */
export function CenterSettings() {
  const scope = useCenterScope()
  const { t, lang } = useT()
  const notify = useStore((s) => s.notify)
  const [center, setCenter] = useState<CenterProfile | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [qr, setQr] = useState<CenterQr | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    api<CenterOverview>(`${scope.base}/overview`).then((o) => { setCenter(o.center); setDraft(toDraft(o.center)) }).catch(() => { setFailed(true); notify(t('center.loadError'), 'warn') })
    api<CenterQr>(`${scope.base}/qr`).then(setQr).catch(() => undefined)
  }, [notify, t])

  const fail = (err: unknown) => notify(isApiError(err) ? apiErrorText(err, lang) : t('center.loadError'), 'warn')
  const save = async () => {
    if (!draft) return
    const lat = num(draft.lat), lng = num(draft.lng), geoRadiusM = num(draft.geoRadiusM)
    if ([lat, lng, geoRadiusM].some((v) => v != null && Number.isNaN(v))) { notify(t('apiError.validation'), 'warn'); return }
    setBusy(true)
    try {
      const saved = await api<CenterProfile>(`${scope.base}/profile`, {
        method: 'PATCH',
        body: { name: draft.name.trim(), district: draft.district, description: draft.description, address: draft.address.trim() || null, phone: draft.phone.trim() || null, lat, lng, geoRadiusM, checkInBeforeMin: Number(draft.checkInBeforeMin), absenceAfterMin: Number(draft.absenceAfterMin) },
      })
      setCenter(saved)
      setDraft(toDraft(saved))
      notify(t('common.saved'))
    } catch (err) { fail(err) } finally { setBusy(false) }
  }
  const rotate = async () => {
    if (!confirm(t('center.qrConfirm'))) return
    setBusy(true)
    try { setQr(await api<CenterQr>(`${scope.base}/qr/rotate`, { method: 'POST', body: {} })); notify(t('center.qrRotated')) } catch (err) { fail(err) } finally { setBusy(false) }
  }

  if (failed) return <Notice tone="warn">{t('center.loadError')}</Notice>
  if (!center || !draft) return <div className="py-16 text-center text-sm text-charcoal/55">{t('common.loading')}</div>
  const locked = center.status === 'BLOCKED'

  return (
    <div>
      <PageTitle eyebrow={t('dash.center')} title={t('center.settings')} />
      <CenterStatusNotice status={center.status} />
      <div className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
        <div className="space-y-6">
          <Card className="space-y-4 p-6">
            <Eyebrow>{t('center.profile')}</Eyebrow>
            <Field label={t('common.name')} required><Input disabled={locked} maxLength={120} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            <LField label={t('admin.centers.district')} value={draft.district} onChange={(v) => setDraft({ ...draft, district: v })} />
            <LField label={t('common.description')} multiline value={draft.description} onChange={(v) => setDraft({ ...draft, description: v })} />
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('center.address')}><Input disabled={locked} maxLength={300} value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} /></Field>
              <Field label={t('center.phone')}><Input disabled={locked} type="tel" placeholder="+998 90 123 45 67" maxLength={20} value={draft.phone} onChange={(e) => setDraft({ ...draft, phone: e.target.value })} /></Field>
            </div>
          </Card>
          <Card className="space-y-4 p-6">
            <Eyebrow>{t('center.checkInWindow')}</Eyebrow>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('center.beforeMin')}><Input disabled={locked} type="number" min={0} max={180} value={draft.checkInBeforeMin} onChange={(e) => setDraft({ ...draft, checkInBeforeMin: e.target.value })} /></Field>
              <Field label={t('center.afterMin')} hint={t('center.afterMinHint')}><Input disabled={locked} type="number" min={0} max={240} value={draft.absenceAfterMin} onChange={(e) => setDraft({ ...draft, absenceAfterMin: e.target.value })} /></Field>
            </div>
            <Eyebrow>{t('center.location')}</Eyebrow>
            <p className="text-xs text-charcoal/60">{t('center.locationHint')}</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label={t('center.lat')}><Input disabled={locked} inputMode="decimal" placeholder="41.3111" value={draft.lat} onChange={(e) => setDraft({ ...draft, lat: e.target.value })} /></Field>
              <Field label={t('center.lng')}><Input disabled={locked} inputMode="decimal" placeholder="69.2797" value={draft.lng} onChange={(e) => setDraft({ ...draft, lng: e.target.value })} /></Field>
              <Field label={t('center.radius')}><Input disabled={locked} type="number" min={20} max={5000} placeholder="300" value={draft.geoRadiusM} onChange={(e) => setDraft({ ...draft, geoRadiusM: e.target.value })} /></Field>
            </div>
            <Notice tone="info" className="text-[12px]">{t('attend.honest')}</Notice>
            <div className="flex justify-end"><Button disabled={busy || locked} onClick={() => void save()}><Icon name="check" className="h-4 w-4" />{t('common.save')}</Button></div>
          </Card>
        </div>
        <Card className="flex flex-col items-center gap-4 p-6 text-center">
          <Eyebrow>{t('center.qrTitle')}</Eyebrow>
          {qr ? <QrCode value={qr.url} size={260} label={t('center.qrTitle')} /> : <div className="h-[260px] w-[260px] animate-pulse rounded-card bg-sage/60" />}
          {qr && <a href={qr.url} target="_blank" rel="noopener noreferrer" className="break-all text-[11px] text-forest underline">{qr.url}</a>}
          <p className="text-xs leading-relaxed text-charcoal/60">{t('center.qrHint')}</p>
          {qr?.rotatedAt && <p className="text-[11px] text-charcoal/45">{t('common.updated')}: {formatDate(qr.rotatedAt, lang)}</p>}
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => window.print()}><Icon name="external" className="h-3.5 w-3.5" />{t('center.print')}</Button>
            <Button variant="danger" size="sm" disabled={busy || locked} onClick={() => void rotate()}><Icon name="refresh" className="h-3.5 w-3.5" />{t('center.qrRotate')}</Button>
          </div>
        </Card>
      </div>
    </div>
  )
}
