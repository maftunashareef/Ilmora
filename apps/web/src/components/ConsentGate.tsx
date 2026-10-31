'use client'
import { useState } from 'react'
import { OFFER_VERSION } from '@ilmora/shared'
import { useT } from '@/i18n/useT'
import { apiErrorText } from '@/lib/apiErrors'
import { Link } from '@/lib/router'
import { useStore, type AuthUser } from '@/store/useStore'
import { Button, Card, Icon, Notice } from './ui'

export interface ConsentState {
  acceptOffer: boolean
  consentPersonalData: boolean
}
export const EMPTY_CONSENT: ConsentState = { acceptOffer: false, consentPersonalData: false }
export const consentComplete = (c: ConsentState) => c.acceptOffer && c.consentPersonalData

/** An account must have accepted the current offer edition and given personal-data consent before using a workspace. */
export const needsConsent = (u: AuthUser | null | undefined) => !!u && (!u.offerAcceptedAt || u.offerVersion !== OFFER_VERSION || !u.consentAt)

/** Two required marks: the offer and personal-data consent (section 9.1 of the offer keeps them separate). */
export function ConsentFields({ value, onChange, invalid }: { value: ConsentState; onChange: (v: ConsentState) => void; invalid?: boolean }) {
  const { t } = useT()
  const row = (key: keyof ConsentState, label: React.ReactNode, required: boolean) => (
    <label className="flex cursor-pointer items-start gap-3 text-[13px] leading-relaxed text-charcoal/80">
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 shrink-0 accent-forest"
        checked={value[key]}
        onChange={(e) => onChange({ ...value, [key]: e.target.checked })}
        aria-invalid={invalid && required && !value[key] ? true : undefined}
        aria-required={required || undefined}
      />
      <span>{label}{required && <span className="text-red-700"> *</span>}</span>
    </label>
  )
  return (
    <fieldset className="space-y-2.5">
      <legend className="sr-only">{t('auth.consent.title')}</legend>
      {row('acceptOffer', <>{t('auth.consent.offerBefore')} <Link to="/oferta" target="_blank" rel="noopener noreferrer" className="font-medium text-forest underline">{t('auth.consent.offerLink')}</Link> {t('auth.consent.offerAfter')}</>, true)}
      {row('consentPersonalData', <>{t('auth.consent.pd')} <Link to="/privacy" target="_blank" rel="noopener noreferrer" className="font-medium text-forest underline">{t('legal.privacy')}</Link></>, true)}
      {invalid && !consentComplete(value) && <p className="text-xs text-red-700" role="alert">{t('auth.consent.required')}</p>}
    </fieldset>
  )
}

/** Shown instead of a workspace until the signed-in account has accepted the current offer edition. */
export function ConsentGate() {
  const { t, lang } = useT()
  const giveConsent = useStore((s) => s.giveConsent)
  const [value, setValue] = useState<ConsentState>(EMPTY_CONSENT)
  const [invalid, setInvalid] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async () => {
    if (!consentComplete(value)) { setInvalid(true); return }
    setBusy(true); setError(null)
    try {
      await giveConsent({ acceptOffer: true, consentPersonalData: true })
    } catch (err) {
      setError(apiErrorText(err, lang))
    } finally { setBusy(false) }
  }
  return (
    <div className="container-x py-16">
      <Card className="mx-auto max-w-xl px-7 py-9">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-sage text-forest"><Icon name="lock" className="h-5 w-5" /></div>
        <h1 className="font-display text-3xl text-charcoal">{t('auth.consent.title')}</h1>
        <p className="mt-2 text-sm text-charcoal/65">{t('auth.consent.body')}</p>
        <div className="mt-6"><ConsentFields value={value} onChange={setValue} invalid={invalid} /></div>
        {error && <div role="alert" className="mt-4"><Notice tone="warn">{error}</Notice></div>}
        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={() => void submit()} disabled={busy}>{busy ? <Icon name="refresh" className="h-4 w-4 animate-spin" /> : <Icon name="check" className="h-4 w-4" />}{t('auth.consent.confirm')}</Button>
          <Link to="/oferta" target="_blank" rel="noopener noreferrer" className="inline-flex items-center px-3 text-sm font-medium text-forest underline">{t('auth.consent.read')}</Link>
        </div>
      </Card>
    </div>
  )
}
