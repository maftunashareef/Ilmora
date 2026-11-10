'use client'
import { useEffect, useRef, useState } from 'react'
import type { MfaChallengeDto, MfaSetupDto } from '@ilmora/shared'
import { useT } from '@/i18n/useT'
import { isApiError } from '../lib/api'
import { apiErrorText } from '../lib/apiErrors'
import { useStore, type AuthUser } from '../store/useStore'
import { QrCode } from './QrCode'
import { Button, Field, Icon, Input, Notice } from './ui'

const APP_CODE_RE = /^\d{6}$/
/** Recovery codes look like "xxxx-xxxx"; the API ignores case, spaces and the dash. */
const recoveryOk = (s: string) => s.replace(/[\s-]/g, '').length >= 8

/**
 * The second sign-in step for the ministry and the Super Admins (the API decides who): after the password, a code from
 * an authenticator app (TOTP).
 * - `verify`: a 6-digit code from the app, or a one-time recovery code when the phone is lost.
 * - `setup` (first sign-in): link the app by its QR code (or the key typed by hand), confirm with its first code, then
 *   the 10 recovery codes are shown — once; the representative confirms they saved them before moving on.
 * An expired or refused step sends back to the login and password (`onRestart`).
 */
export function MfaSignIn({ challenge, onSignedIn, onRestart }: {
  challenge: MfaChallengeDto
  onSignedIn: (user: AuthUser) => void
  onRestart: () => void
}) {
  const { t, lang } = useT()
  const mfaSetup = useStore((s) => s.mfaSetup)
  const mfaConfirm = useStore((s) => s.mfaConfirm)
  const mfaVerify = useStore((s) => s.mfaVerify)
  const notify = useStore((s) => s.notify)

  const [setup, setSetup] = useState<MfaSetupDto | null>(null)
  const [setupFailed, setSetupFailed] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)
  const [signedIn, setSignedIn] = useState<{ user: AuthUser; recoveryCodes: string[] } | null>(null)
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState<'key' | 'codes' | null>(null)
  const asked = useRef(false)

  // The pass for this step lasts `expiresInSeconds`; after that only the login and password start again.
  useEffect(() => {
    const timer = setTimeout(() => setExpired(true), challenge.expiresInSeconds * 1000)
    return () => clearTimeout(timer)
  }, [challenge])

  useEffect(() => {
    if (challenge.stage !== 'setup' || asked.current) return
    asked.current = true
    mfaSetup(challenge.challenge).then(setSetup, (err) => {
      if (isApiError(err) && err.code === 'invalid_challenge') setExpired(true)
      else setSetupFailed(apiErrorText(err, lang))
    })
  }, [challenge, mfaSetup, lang])

  const copy = async (text: string, what: 'key' | 'codes') => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
      setTimeout(() => setCopied(null), 2000)
    } catch {
      // Clipboard refused (some app views): the text stays on screen to copy by hand.
    }
  }

  const submit = async () => {
    setError(null)
    const value = code.trim()
    if (useRecovery ? !recoveryOk(value) : !APP_CODE_RE.test(value)) { setError(t(useRecovery ? 'mfa.err.recovery' : 'mfa.err.code')); return }
    setBusy(true)
    try {
      if (challenge.stage === 'setup') {
        const result = await mfaConfirm(challenge.challenge, value)
        notify(t('mfa.linked'))
        setSignedIn(result)
      } else {
        onSignedIn(await mfaVerify(challenge.challenge, value))
      }
    } catch (err) {
      if (isApiError(err) && err.code === 'invalid_challenge') setExpired(true)
      else setError(apiErrorText(err, lang))
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  if (expired && !signedIn) {
    return (
      <div className="space-y-4">
        <Notice tone="warn">{t('apiError.invalidChallenge')}</Notice>
        <Button type="button" className="w-full" onClick={onRestart}><Icon name="arrowLeft" className="h-4 w-4" />{t('mfa.restart')}</Button>
      </div>
    )
  }

  // First sign-in done: the recovery codes, shown once.
  if (signedIn) {
    const all = signedIn.recoveryCodes.join('\n')
    return (
      <div className="space-y-4">
        <div>
          <h2 className="font-body text-lg font-semibold text-charcoal">{t('mfa.codesTitle')}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-charcoal/70">{t('mfa.codesIntro')}</p>
        </div>
        <ol className="grid grid-cols-2 gap-2 rounded-control border border-charcoal/12 bg-ivory/60 p-3 font-mono text-sm tabular-nums text-charcoal" aria-label={t('mfa.codesTitle')}>
          {signedIn.recoveryCodes.map((c) => <li key={c} className="select-all rounded bg-paper px-2.5 py-1.5 text-center tracking-wider">{c}</li>)}
        </ol>
        <Button type="button" variant="secondary" size="sm" onClick={() => void copy(all, 'codes')}>
          <Icon name={copied === 'codes' ? 'check' : 'file'} className="h-3.5 w-3.5" />{t(copied === 'codes' ? 'mfa.copied' : 'mfa.copyAll')}
        </Button>
        <label className="flex cursor-pointer items-start gap-3 text-[13px] text-charcoal/80">
          <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-forest" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
          <span>{t('mfa.savedCheck')}</span>
        </label>
        <Button type="button" className="w-full" size="lg" disabled={!saved} onClick={() => onSignedIn(signedIn.user)}>
          {t('mfa.continue')} <Icon name="arrowRight" className="h-4 w-4" />
        </Button>
      </div>
    )
  }

  const codeField = (
    <Field label={t(useRecovery ? 'mfa.recoveryCode' : 'mfa.code')} hint={useRecovery ? t('mfa.recoveryHint') : undefined}>
      <Input
        id="mfa-code"
        autoFocus
        autoComplete="one-time-code"
        inputMode={useRecovery ? 'text' : 'numeric'}
        autoCapitalize="none"
        spellCheck={false}
        maxLength={useRecovery ? 20 : 6}
        placeholder={useRecovery ? 'xxxx-xxxx' : '123456'}
        value={code}
        onChange={(e) => { setCode(useRecovery ? e.target.value : e.target.value.replace(/\D/g, '').slice(0, 6)); setError(null) }}
        aria-invalid={!!error}
        className="text-center font-mono text-lg tracking-[0.3em] tabular-nums"
      />
    </Field>
  )

  return (
    <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void submit() }} aria-busy={busy}>
      {challenge.stage === 'setup' ? (
        <>
          <div>
            <h2 className="font-body text-lg font-semibold text-charcoal">{t('mfa.setupTitle')}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-charcoal/70">{t('mfa.setupIntro')}</p>
          </div>
          <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-charcoal/80">
            <li>{t('mfa.step1')}</li>
            <li>{t('mfa.step2')}</li>
            <li>{t('mfa.step3')}</li>
          </ol>
          {setupFailed && <Notice tone="warn">{setupFailed}</Notice>}
          {!setupFailed && (
            <div className="flex flex-col items-center gap-3 rounded-control border border-charcoal/12 bg-ivory/60 p-4">
              {setup ? <QrCode value={setup.otpauthUrl} size={200} label={t('mfa.setupTitle')} /> : <div className="h-[200px] w-[200px] animate-pulse rounded-card bg-sage/60" aria-hidden="true" />}
              {setup && (
                <div className="w-full text-center">
                  <p className="text-[11px] text-charcoal/55">{t('mfa.manual')}</p>
                  <div className="mt-1 flex items-center justify-center gap-2">
                    <code className="select-all break-all rounded bg-paper px-2 py-1 font-mono text-xs tracking-wider text-charcoal">{setup.secret}</code>
                    <button type="button" onClick={() => void copy(setup.secret, 'key')} className="shrink-0 rounded p-1 text-charcoal/50 hover:text-forest" aria-label={t('mfa.copy')} title={t('mfa.copy')}>
                      <Icon name={copied === 'key' ? 'check' : 'file'} className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          {codeField}
        </>
      ) : (
        <>
          <div>
            <h2 className="font-body text-lg font-semibold text-charcoal">{t('mfa.title')}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-charcoal/70">{t(useRecovery ? 'mfa.recoveryIntro' : 'mfa.verifyIntro')}</p>
          </div>
          {codeField}
          <button type="button" className="text-xs font-medium text-forest underline" onClick={() => { setUseRecovery((v) => !v); setCode(''); setError(null) }}>
            {t(useRecovery ? 'mfa.useApp' : 'mfa.useRecovery')}
          </button>
        </>
      )}
      {error && <p className="text-xs text-red-700" role="alert">{error}</p>}
      <Button type="submit" className="w-full" size="lg" disabled={busy || (challenge.stage === 'setup' && !setup)}>
        {busy ? <Icon name="refresh" className="h-4 w-4 animate-spin" /> : <Icon name="lock" className="h-4 w-4" />}
        {t(challenge.stage === 'setup' ? 'mfa.confirm' : 'auth.signIn')}
      </Button>
      <button type="button" className="block w-full text-center text-xs text-charcoal/60 underline hover:text-charcoal" onClick={onRestart}>{t('mfa.restart')}</button>
    </form>
  )
}
