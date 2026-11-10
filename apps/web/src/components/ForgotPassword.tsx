'use client'
import { useEffect, useState } from 'react'
import { formatUzPhone, normalizeUzPhone } from '@ilmora/shared'
import { useT } from '@/i18n/useT'
import { isApiError } from '@/lib/api'
import { apiErrorText } from '@/lib/apiErrors'
import { PASSWORD_MAX, PASSWORD_MIN } from '@/lib/passwordChange'
import { useStore, type AuthUser } from '@/store/useStore'
import { Button, Field, Icon, Input } from './ui'

/** A new code may be asked for after this long (the API limits codes per number too). */
const RESEND_SECONDS = 60

/**
 * «Забыли пароль?» (security review 10.11 №4, PR #54): the phone linked to the account → an SMS code → the code and a
 * new password. The answer is a sign-in: every other session ends and this browser is signed in. The ministry, Super
 * Admins and finance cannot reset by SMS — the Super Admin resets their password.
 */
export function ForgotPassword({ onBack, onDone }: { onBack: () => void; onDone: (user: AuthUser) => void }) {
  const { t, lang } = useT()
  const requestCode = useStore((s) => s.requestPasswordCode)
  const reset = useStore((s) => s.resetPasswordBySms)
  const notify = useStore((s) => s.notify)
  const [phone, setPhone] = useState('')
  const [sentTo, setSentTo] = useState<{ e164: string; minutes: number; devCode?: string } | null>(null)
  const [code, setCode] = useState('')
  const [next, setNext] = useState('')
  const [repeat, setRepeat] = useState('')
  const [shown, setShown] = useState(false)
  const [wait, setWait] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (wait <= 0) return
    const timer = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(timer)
  }, [wait])

  const describe = (err: unknown) => {
    if (isApiError(err)) {
      if (err.code === 'mfa_password_login') return t('forgot.adminOnly')
      if (err.code === 'not_found') return t('forgot.noAccount')
      if (err.code === 'unavailable' || err.status === 503) return t('forgot.smsUnavailable')
    }
    return apiErrorText(err, lang)
  }

  const send = async () => {
    setError(null)
    const parsed = normalizeUzPhone(phone)
    if (!parsed.ok) { setError(t('auth.err.phone')); return }
    setBusy(true)
    try {
      const r = await requestCode(parsed.e164)
      setSentTo({ e164: parsed.e164, minutes: Math.max(1, Math.round(r.expiresInSeconds / 60)), devCode: r.devCode })
      setWait(RESEND_SECONDS)
    } catch (err) {
      setError(describe(err))
    } finally {
      setBusy(false)
    }
  }

  const problem = !/^\d{4,8}$/.test(code.trim()) ? t('forgot.err.code')
    : next.length < PASSWORD_MIN || next.length > PASSWORD_MAX ? t('auth.err.password')
    : next !== repeat ? t('auth.err.mismatch') : null

  const save = async () => {
    setError(null)
    if (!sentTo) return
    if (problem) { setError(problem); return }
    setBusy(true)
    try {
      const user = await reset(sentTo.e164, code.trim(), next)
      notify(t('forgot.done'))
      onDone(user)
    } catch (err) {
      setError(describe(err))
      setBusy(false)
    }
  }

  const pwType = shown ? 'text' : 'password'
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-body text-lg font-semibold text-charcoal">{t('forgot.title')}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-charcoal/70">{t('forgot.intro')}</p>
      </div>
      {!sentTo ? (
        <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void send() }}>
          <Field label={t('auth.phone')} required>
            <Input id="forgot-phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+998 90 123 45 67" maxLength={20} value={phone} onChange={(e) => { setPhone(e.target.value); setError(null) }} aria-invalid={!!error} />
          </Field>
          {error && <p className="text-xs text-red-700" role="alert">{error}</p>}
          <Button type="submit" className="w-full" size="lg" disabled={busy}>{busy ? <Icon name="refresh" className="h-4 w-4 animate-spin" /> : <Icon name="chat" className="h-4 w-4" />}{t('forgot.sendCode')}</Button>
        </form>
      ) : (
        <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void save() }}>
          <p className="rounded-control bg-sage/50 px-3 py-2 text-xs leading-relaxed text-forest">{t('forgot.codeSent', { phone: formatUzPhone(sentTo.e164), min: sentTo.minutes })}</p>
          {sentTo.devCode && <p className="text-[11px] text-charcoal/50">{t('forgot.devCode', { code: sentTo.devCode })}</p>}
          <Field label={t('auth.code')} required>
            <Input id="forgot-code" inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={code} onChange={(e) => { setCode(e.target.value.replace(/\D/g, '')); setError(null) }} className="font-mono tracking-[0.3em]" />
          </Field>
          <Field label={t('pwd.new')} hint={t('auth.passwordHint')} required>
            <Input id="forgot-new" type={pwType} autoComplete="new-password" maxLength={PASSWORD_MAX} value={next} onChange={(e) => { setNext(e.target.value); setError(null) }} />
          </Field>
          <Field label={t('auth.confirmPassword')} required>
            <Input id="forgot-repeat" type={pwType} autoComplete="new-password" maxLength={PASSWORD_MAX} value={repeat} onChange={(e) => { setRepeat(e.target.value); setError(null) }} />
          </Field>
          <label className="flex cursor-pointer items-center gap-2 text-xs text-charcoal/70">
            <input type="checkbox" className="h-4 w-4 accent-forest" checked={shown} onChange={(e) => setShown(e.target.checked)} />{t('pwd.show')}
          </label>
          {error && <p className="text-xs text-red-700" role="alert">{error}</p>}
          <Button type="submit" className="w-full" size="lg" disabled={busy}>{busy ? <Icon name="refresh" className="h-4 w-4 animate-spin" /> : <Icon name="lock" className="h-4 w-4" />}{t('forgot.submit')}</Button>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <button type="button" className="text-forest underline disabled:text-charcoal/40 disabled:no-underline" disabled={wait > 0 || busy} onClick={() => void send()}>{wait > 0 ? t('forgot.resendIn', { s: wait }) : t('forgot.resend')}</button>
            <button type="button" className="text-charcoal/60 underline hover:text-charcoal" onClick={() => { setSentTo(null); setCode(''); setError(null) }}>{t('forgot.changePhone')}</button>
          </div>
        </form>
      )}
      <button type="button" className="block w-full text-center text-xs text-charcoal/60 underline hover:text-charcoal" onClick={onBack}>{t('forgot.back')}</button>
    </div>
  )
}
