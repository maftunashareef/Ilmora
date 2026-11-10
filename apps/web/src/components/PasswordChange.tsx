'use client'
import { useState } from 'react'
import { useT } from '@/i18n/useT'
import { apiErrorText } from '@/lib/apiErrors'
import { PASSWORD_MAX, passwordChangeProblem, type PasswordChangeFields } from '@/lib/passwordChange'
import { useStore, type AuthUser } from '@/store/useStore'
import { Button, Card, Field, Icon, Input } from './ui'

const EMPTY: PasswordChangeFields = { current: '', next: '', repeat: '' }

/**
 * «Сменить пароль» (POST /auth/password). `required`: the ministry's temporary password from the Super Admin — asked right
 * after the sign-in and the app code, before anything else. Success ends every other session of the account; this
 * browser gets a fresh one, so the store simply takes the new session.
 */
export function PasswordChangeForm({ required = false, onDone }: { required?: boolean; onDone?: (user: AuthUser) => void }) {
  const { t, lang } = useT()
  const login = useStore((s) => s.auth.user?.login ?? null)
  const changePassword = useStore((s) => s.changePassword)
  const logout = useStore((s) => s.logout)
  const notify = useStore((s) => s.notify)
  const [form, setForm] = useState<PasswordChangeFields>(EMPTY)
  const [shown, setShown] = useState(false)
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const problem = passwordChangeProblem(form, login)
  // The field the shown problem is about (only after the first try, so an empty form is not red at once).
  const badField: keyof PasswordChangeFields | null = !tried || !problem ? null : problem === 'pwd.err.current' ? 'current' : problem === 'auth.err.mismatch' ? 'repeat' : 'next'
  const set = (k: keyof PasswordChangeFields) => (e: { target: { value: string } }) => { setForm((f) => ({ ...f, [k]: e.target.value })); setError(null) }

  const submit = async () => {
    setTried(true)
    if (problem) return
    setBusy(true); setError(null)
    try {
      const user = await changePassword(form.current, form.next)
      setForm(EMPTY); setTried(false)
      notify(t('pwd.changed'))
      onDone?.(user)
    } catch (err) {
      setError(apiErrorText(err, lang))
    } finally {
      setBusy(false)
    }
  }

  const field = (k: keyof PasswordChangeFields, label: string, autoComplete: string, hint?: string) => (
    <Field label={label} hint={hint} required>
      <Input
        id={`pwd-${k}`}
        type={shown ? 'text' : 'password'}
        autoComplete={autoComplete}
        maxLength={PASSWORD_MAX}
        value={form[k]}
        onChange={set(k)}
        aria-invalid={badField === k}
      />
    </Field>
  )

  return (
    <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void submit() }} aria-busy={busy}>
      <div>
        <h2 className="font-body text-lg font-semibold text-charcoal">{t(required ? 'pwd.requiredTitle' : 'pwd.title')}</h2>
        <p className="mt-1.5 text-sm leading-relaxed text-charcoal/70">{t(required ? 'pwd.requiredIntro' : 'pwd.intro')}</p>
      </div>
      {/* The login is in the form so a password manager saves the new password under the right account. */}
      {login && <input type="text" name="username" autoComplete="username" value={login} readOnly hidden />}
      {field('current', t(required ? 'pwd.currentTemp' : 'pwd.current'), 'current-password')}
      {field('next', t('pwd.new'), 'new-password', t('pwd.newHint'))}
      {field('repeat', t('auth.confirmPassword'), 'new-password')}
      <label className="flex cursor-pointer items-center gap-2 text-xs text-charcoal/70">
        <input type="checkbox" className="h-4 w-4 accent-forest" checked={shown} onChange={(e) => setShown(e.target.checked)} />
        {t('pwd.show')}
      </label>
      {tried && problem && <p className="text-xs text-red-700" role="alert">{t(problem)}</p>}
      {error && <p className="text-xs text-red-700" role="alert">{error}</p>}
      <Button type="submit" className="w-full" size="lg" disabled={busy}>
        {busy ? <Icon name="refresh" className="h-4 w-4 animate-spin" /> : <Icon name="lock" className="h-4 w-4" />}{t('pwd.submit')}
      </Button>
      <p className="text-xs leading-relaxed text-charcoal/55">{t('pwd.sessionsNote')}</p>
      {required && <button type="button" className="block w-full text-center text-xs text-charcoal/60 underline hover:text-charcoal" onClick={() => void logout()}>{t('auth.signOut')}</button>}
    </form>
  )
}

/** Shown instead of a workspace while the account still has the temporary password from the Super Admin. */
export function PasswordChangeGate() {
  return (
    <div className="container-x py-16">
      <Card className="mx-auto max-w-md px-7 py-9">
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-sage text-forest"><Icon name="lock" className="h-5 w-5" /></div>
        <PasswordChangeForm required />
      </Card>
    </div>
  )
}
