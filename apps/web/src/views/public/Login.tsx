'use client'
import { useEffect, useState } from 'react'
import { ConsentFields, consentComplete, EMPTY_CONSENT, type ConsentState } from '../../components/ConsentGate'
import { Button, Card, cx, Eyebrow, Field, Icon, Input, Notice, Tabs } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { isApiError } from '../../lib/api'
import { Link, useNavigate, useSearchParams } from '../../lib/router'
import { useStore, type AuthUser } from '../../store/useStore'

type Mode = 'signin' | 'register'
type Role = AuthUser['roles'][number]
const LOGIN_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/

/** Which workspace a path belongs to; paths outside the three workspaces are open to any signed-in account. */
const workspaceOf = (path: string) => (path.startsWith('/admin') ? 'admin' : path.startsWith('/teacher') ? 'teacher' : path.startsWith('/student') ? 'student' : null)
const canOpen = (roles: Role[], path: string) => {
  const w = workspaceOf(path)
  if (!w || roles.includes('PLATFORM_ADMIN')) return true
  return w === 'teacher' ? roles.includes('TEACHER') : w === 'student' ? roles.includes('STUDENT') : false
}
const homeFor = (roles: Role[]) => (roles.includes('PLATFORM_ADMIN') ? '/admin' : roles.includes('TEACHER') ? '/teacher' : '/student')

/**
 * Login + password sign-in and Student/Teacher registration. The protected destination in `?next=` is kept
 * only when the signed-in account may open it; otherwise the account's own workspace opens.
 */
export function LoginPage() {
  const { t } = useT()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const rawNext = params.get('next') ?? ''
  const safeNext = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : null
  const auth = useStore((s) => s.auth)
  const login = useStore((s) => s.login)
  const register = useStore((s) => s.register)
  const notify = useStore((s) => s.notify)
  const [mode, setMode] = useState<Mode>(params.get('mode') === 'register' ? 'register' : 'signin')
  const [role, setRole] = useState<'STUDENT' | 'TEACHER' | null>(null)
  const [name, setName] = useState('')
  const [loginName, setLoginName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [consent, setConsent] = useState<ConsentState>(EMPTY_CONSENT)
  const [consentInvalid, setConsentInvalid] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'role' | 'login' | 'password' | 'confirm', string>>>({})

  useEffect(() => {
    if (auth.status !== 'authenticated') return
    const roles = auth.user?.roles ?? []
    nav(safeNext && canOpen(roles, safeNext) ? safeNext : homeFor(roles), { replace: true })
  }, [auth.status, auth.user, nav, safeNext])

  const switchMode = (m: Mode) => { setMode(m); setError(null); setFieldErrors({}); setConsentInvalid(false) }

  const describe = (err: unknown): string => {
    if (!isApiError(err)) return String(err)
    if (err.status === 429) return t('auth.err.tooMany')
    switch (err.code) {
      case 'login_taken': return t('auth.err.loginTaken')
      case 'invalid_credentials': return t('auth.err.invalid')
      case 'invalid_login': return t('auth.err.login')
      case 'weak_password': return t('auth.err.password')
      case 'invalid_role': return t('auth.err.role')
      case 'account_disabled': return t('auth.err.disabled')
      default: return err.message
    }
  }

  const validate = (): boolean => {
    const normalized = loginName.trim().toLowerCase()
    const next: typeof fieldErrors = {}
    if (!LOGIN_RE.test(normalized)) next.login = t('auth.err.login')
    if (mode === 'register') {
      if (!role) next.role = t('auth.err.role')
      if (password.length < 8) next.password = t('auth.err.password')
      else if (password !== confirm) next.confirm = t('auth.err.mismatch')
      setConsentInvalid(!consentComplete(consent))
    } else if (!password) next.password = t('auth.err.password')
    setFieldErrors(next)
    return Object.keys(next).length === 0 && (mode !== 'register' || consentComplete(consent))
  }

  const submit = async () => {
    setError(null)
    if (!validate()) return
    setBusy(true)
    try {
      const normalized = loginName.trim().toLowerCase()
      if (mode === 'register' && role) {
        const user = await register({ role, login: normalized, password, displayName: name.trim() || undefined, acceptOffer: true, consentPersonalData: true })
        notify(t('auth.registered', { name: user.displayName }))
      } else {
        const user = await login(normalized, password)
        notify(t('auth.welcome', { name: user.displayName }))
      }
    } catch (err) {
      setError(describe(err))
    } finally { setBusy(false) }
  }

  const passwordToggle = (
    <button type="button" className="text-[11px] font-medium text-forest underline" onClick={() => setShow((v) => !v)} aria-pressed={show}>
      {show ? t('auth.hidePassword') : t('auth.showPassword')}
    </button>
  )

  return (
    <div className="container-x py-14 lg:py-20">
      <div className="mx-auto max-w-md">
        <Eyebrow className="mb-2">ILMORA</Eyebrow>
        <Card className="px-5 py-7 sm:px-7 sm:py-8">
          <h1 className="font-display text-3xl text-charcoal">{t('auth.title')}</h1>
          <p className="mt-2 text-sm leading-relaxed text-charcoal/65">{t('auth.subtitle')}</p>
          <Tabs<Mode> value={mode} onChange={switchMode} className="mt-5" tabs={[{ id: 'signin', label: t('auth.tab.signIn') }, { id: 'register', label: t('auth.tab.register') }]} />

          <form className="mt-6 space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void submit() }} aria-busy={busy}>
            {mode === 'register' && (
              <fieldset>
                <legend className="mb-2 text-xs font-medium text-charcoal/70">{t('auth.whoAreYou')}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(['STUDENT', 'TEACHER'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      aria-pressed={role === r}
                      onClick={() => { setRole(r); setFieldErrors((f) => ({ ...f, role: undefined })) }}
                      className={cx('rounded-control border p-3 text-left transition', role === r ? 'border-forest bg-sage/60 shadow-lift' : 'border-charcoal/12 bg-ivory/60 hover:border-forest/50')}
                    >
                      <div className="flex items-center gap-2 text-sm font-semibold text-charcoal"><Icon name={r === 'STUDENT' ? 'user' : 'edit'} className="h-4 w-4 text-forest" />{t(r === 'STUDENT' ? 'role.student' : 'role.teacher')}</div>
                      <div className="mt-1 text-[11px] leading-relaxed text-charcoal/60">{t(r === 'STUDENT' ? 'auth.role.studentHint' : 'auth.role.teacherHint')}</div>
                    </button>
                  ))}
                </div>
                {fieldErrors.role && <p className="mt-1.5 text-xs text-red-700" role="alert">{fieldErrors.role}</p>}
              </fieldset>
            )}

            {mode === 'register' && (
              <Field label={t('auth.displayName')}>
                <Input autoComplete="name" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
              </Field>
            )}

            <Field label={t('auth.login')} hint={mode === 'register' ? t('auth.loginHint') : undefined}>
              <Input autoFocus autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={32} value={loginName} onChange={(e) => setLoginName(e.target.value)} aria-invalid={!!fieldErrors.login} />
              {fieldErrors.login && <p className="mt-1.5 text-xs text-red-700" role="alert">{fieldErrors.login}</p>}
            </Field>

            <Field label={t('auth.password')} hint={mode === 'register' ? t('auth.passwordHint') : passwordToggle}>
              <Input type={show ? 'text' : 'password'} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} maxLength={128} value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={!!fieldErrors.password} />
              {fieldErrors.password && <p className="mt-1.5 text-xs text-red-700" role="alert">{fieldErrors.password}</p>}
            </Field>

            {mode === 'register' && (
              <Field label={t('auth.confirmPassword')} hint={passwordToggle}>
                <Input type={show ? 'text' : 'password'} autoComplete="new-password" maxLength={128} value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={!!fieldErrors.confirm} />
                {fieldErrors.confirm && <p className="mt-1.5 text-xs text-red-700" role="alert">{fieldErrors.confirm}</p>}
              </Field>
            )}

            {mode === 'register' && <ConsentFields value={consent} onChange={setConsent} invalid={consentInvalid} />}

            {error && <div role="alert"><Notice tone="warn">{error}</Notice></div>}

            <Button type="submit" className="w-full" size="lg" disabled={busy}>
              {busy ? <Icon name="refresh" className="h-4 w-4 animate-spin" /> : <Icon name={mode === 'register' ? 'check' : 'arrowRight'} className="h-4 w-4" />}
              {mode === 'register' ? t('auth.createAccount') : t('auth.signIn')}
            </Button>
            {mode === 'register' && <p className="text-[11px] leading-relaxed text-charcoal/45">{t('auth.consent')}</p>}
            <p className="text-center text-xs text-charcoal/60">
              {mode === 'register' ? t('auth.haveAccount') : t('auth.noAccount')}{' '}
              <button type="button" className="font-medium text-forest underline" onClick={() => switchMode(mode === 'register' ? 'signin' : 'register')}>
                {mode === 'register' ? t('auth.tab.signIn') : t('auth.tab.register')}
              </button>
            </p>
          </form>
        </Card>
        <p className="mt-4 text-center text-[11px] text-charcoal/45"><Link to="/" className="underline">{t('common.goHome')}</Link></p>
      </div>
    </div>
  )
}
