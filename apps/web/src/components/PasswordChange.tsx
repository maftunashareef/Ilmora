'use client'
import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useT } from '@/i18n/useT'
import { apiErrorText } from '@/lib/apiErrors'
import { PASSWORD_MAX, passwordChangeProblem, type PasswordChangeFields } from '@/lib/passwordChange'
import { useLocation, useNavigate } from '@/lib/router'
import { workspaceOf } from '@/lib/workspaceHome'
import { useStore, type AuthUser } from '@/store/useStore'
import { Button, Card, Field, Icon, Input, Modal } from './ui'

const EMPTY: PasswordChangeFields = { current: '', next: '', repeat: '' }

/**
 * «Сменить пароль» (POST /auth/password). `required`: the ministry's temporary password from the Super Admin — asked right
 * after the sign-in and the app code, before anything else. Success ends every other session of the account; this
 * browser gets a fresh one, so the store simply takes the new session.
 */
export function PasswordChangeForm({ required = false, heading = true, onDone }: { required?: boolean; heading?: boolean; onDone?: (user: AuthUser) => void }) {
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
      {heading && (
        <div>
          <h2 className="font-body text-lg font-semibold text-charcoal">{t(required ? 'pwd.requiredTitle' : 'pwd.title')}</h2>
          <p className="mt-1.5 text-sm leading-relaxed text-charcoal/70">{t(required ? 'pwd.requiredIntro' : 'pwd.intro')}</p>
        </div>
      )}
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

/**
 * «Сменить пароль» for any signed-in account with a password (account menu, profile pages). Rendered into <body>: the
 * headers blur their background, which would trap a fixed dialog inside them.
 */
export function PasswordChangeDialog({ onClose }: { onClose: () => void }) {
  const { t } = useT()
  return createPortal(
    <Modal open onClose={onClose} title={t('pwd.title')}>
      <PasswordChangeForm heading={false} onDone={onClose} />
    </Modal>,
    document.body,
  )
}

/** A «Password» card for profile and settings pages. Accounts that sign in without a password (SMS only) do not see it. */
export function PasswordCard({ className = '' }: { className?: string }) {
  const { t } = useT()
  const hasLogin = useStore((s) => !!s.auth.user?.login)
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  if (!hasLogin) return null
  return (
    <Card className={`flex flex-wrap items-center justify-between gap-3 p-6 ${className}`}>
      <div className="min-w-0">
        <h2 className="font-body text-base font-semibold text-charcoal">{t('auth.password')}</h2>
        <p className="mt-1 text-xs leading-relaxed text-charcoal/60">{t('pwd.cardHint')}</p>
      </div>
      <Button variant="secondary" onClick={() => setOpen(true)}><Icon name="lock" className="h-4 w-4" />{t('pwd.title')}</Button>
      {open && <PasswordChangeDialog onClose={close} />}
    </Card>
  )
}

/**
 * Takes an account that must change its temporary password to the change screen from any page — on the flag
 * (`passwordChangeRequired`) and on the API's 403 `password_change_required`, which the store turns into the flag.
 * Workspaces show the form in place (RequireRole), the sign-in page in its card; any other page goes to /login and
 * comes back after the change.
 */
export function PasswordChangeRedirect() {
  const mustChange = useStore((s) => s.auth.status === 'authenticated' && s.auth.user?.passwordChangeRequired === true)
  const { pathname, search } = useLocation()
  const nav = useNavigate()
  useEffect(() => {
    if (!mustChange || pathname === '/login' || workspaceOf(pathname)) return
    nav(`/login?next=${encodeURIComponent(pathname + search)}`, { replace: true })
  }, [mustChange, pathname, search, nav])
  return null
}
