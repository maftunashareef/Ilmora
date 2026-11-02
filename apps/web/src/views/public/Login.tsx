'use client'
import { useEffect, useState } from 'react'
import { normalizeUzPhone } from '@ilmora/shared'
import { ConsentFields, consentComplete, EMPTY_CONSENT, type ConsentState } from '../../components/ConsentGate'
import { Button, Card, cx, Eyebrow, Field, Icon, Input, Notice, Tabs } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { isApiError } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import { DEMO_LOGIN_ENABLED } from '../../lib/demoMode'
import { Link, useLocale, useNavigate, useSearchParams } from '../../lib/router'
import { useStore, type AuthUser } from '../../store/useStore'

type Mode = 'signin' | 'register'
type Role = AuthUser['roles'][number]
const LOGIN_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/

/** Which workspace a path belongs to; paths outside the three workspaces are open to any signed-in account. */
const workspaceOf = (path: string) => (path.startsWith('/admin') ? 'admin' : path.startsWith('/teacher') ? 'teacher' : path.startsWith('/center') ? 'center' : path.startsWith('/student') ? 'student' : null)
const canOpen = (roles: Role[], path: string) => {
  const w = workspaceOf(path)
  if (!w || roles.includes('PLATFORM_ADMIN')) return true
  // Finance admins may open the finance page of the admin workspace, nothing else in it.
  if (w === 'admin') return roles.includes('FINANCE_ADMIN') && (path === '/admin/finance' || path.startsWith('/admin/finance/'))
  return w === 'teacher' ? roles.includes('TEACHER') : w === 'center' ? roles.includes('CENTER_ADMIN') : w === 'student' ? roles.includes('STUDENT') : false
}
const homeFor = (roles: Role[]) => (roles.includes('PLATFORM_ADMIN') ? '/admin' : roles.includes('TEACHER') ? '/teacher' : roles.includes('CENTER_ADMIN') ? '/center' : roles.includes('FINANCE_ADMIN') ? '/admin/finance' : '/student')

export function LoginPage() {
  const { t } = useT()
  const locale = useLocale()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const rawNext = params.get('next') ?? ''
  const safeNext = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : null
  const auth = useStore((s) => s.auth)
  const lang = useStore((s) => s.lang)
  const currentLang = locale || lang || 'uz'
  const login = useStore((s) => s.login)
  const register = useStore((s) => s.register)
  const loginAsDemo = useStore((s) => s.loginAsDemo)
  const notify = useStore((s) => s.notify)

  const [mode, setMode] = useState<Mode>(params.get('mode') === 'register' ? 'register' : 'signin')
  const [role, setRole] = useState<'STUDENT' | 'TEACHER' | 'CENTER' | null>(null)
  const [centerName, setCenterName] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [loginName, setLoginName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [consent, setConsent] = useState<ConsentState>(EMPTY_CONSENT)
  const [consentInvalid, setConsentInvalid] = useState(false)
  const [busy, setBusy] = useState(false)
  const [googleBusy, setGoogleBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [networkOffline, setNetworkOffline] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'role' | 'name' | 'phone' | 'login' | 'password' | 'confirm' | 'centerName', string>>>({})

  useEffect(() => {
    if (auth.status !== 'authenticated') return
    const roles = auth.user?.roles ?? []
    nav(safeNext && canOpen(roles, safeNext) ? safeNext : homeFor(roles), { replace: true })
  }, [auth.status, auth.user, nav, safeNext])

  const switchMode = (m: Mode) => {
    setMode(m)
    setError(null)
    setFieldErrors({})
    setConsentInvalid(false)
    setNetworkOffline(false)
  }

  const describe = (err: unknown): string => {
    if (!isApiError(err)) {
      setNetworkOffline(true)
      return t('auth.err.network')
    }
    if (err.status === 429) return t('auth.err.tooMany')
    switch (err.code) {
      case 'login_taken': return t('auth.err.loginTaken')
      case 'phone_taken': return t('auth.err.phoneTaken')
      case 'invalid_credentials': return t('auth.err.invalid')
      case 'invalid_login': return t('auth.err.login')
      case 'invalid_phone': return t('auth.err.phone')
      case 'weak_password': return t('auth.err.password')
      case 'invalid_role': return t('auth.err.role')
      case 'invalid_center_name': return t('auth.err.centerName')
      case 'account_disabled': return t('auth.err.disabled')
      case 'unverified_email': return t('auth.err.google')
      case 'invalid_google_token': return t('auth.err.google')
      case 'google_cancelled': return t('auth.err.googleCancelled')
      case 'google_unconfigured': return t('auth.err.googleUnconfigured')
      case 'network_error':
        setNetworkOffline(true)
        return t('auth.err.network')
      default: return apiErrorText(err, lang)
    }
  }

  const validate = (): boolean => {
    const rawLogin = loginName.trim()
    const next: typeof fieldErrors = {}

    if (mode === 'signin') {
      const isPhone = normalizeUzPhone(rawLogin).ok
      const isUsername = LOGIN_RE.test(rawLogin.toLowerCase())
      if (!rawLogin || (!isPhone && !isUsername)) {
        next.login = t('auth.err.login')
      }
      if (!password) {
        next.password = t('auth.err.password')
      }
    } else {
      if (!role) next.role = t('auth.err.role')
      if (role === 'CENTER' && centerName.trim().length < 2) next.centerName = t('auth.err.centerName')
      if (!name.trim() || name.trim().length < 2) next.name = t('auth.err.name')
      if (phone.trim()) {
        const phoneCheck = normalizeUzPhone(phone)
        if (!phoneCheck.ok) next.phone = t('auth.err.phone')
      }
      const normalizedLogin = rawLogin.toLowerCase()
      if (!LOGIN_RE.test(normalizedLogin)) next.login = t('auth.err.login')
      if (password.length < 8) next.password = t('auth.err.password')
      else if (password !== confirm) next.confirm = t('auth.err.mismatch')
      const completeConsent = consentComplete(consent)
      setConsentInvalid(!completeConsent)
    }

    setFieldErrors(next)
    return Object.keys(next).length === 0 && (mode !== 'register' || consentComplete(consent))
  }

  const submit = async () => {
    setError(null)
    setNetworkOffline(false)
    if (!validate()) return
    setBusy(true)
    try {
      const normalizedLogin = loginName.trim().toLowerCase()
      if (mode === 'register' && role) {
        const user = await register({
          role,
          login: normalizedLogin,
          password,
          displayName: name.trim() || undefined,
          phone: phone.trim() || undefined,
          centerName: role === 'CENTER' ? centerName.trim() : undefined,
          acceptOffer: true,
          consentPersonalData: true,
        })
        notify(t('auth.registered', { name: user.displayName }))
      } else {
        const user = await login(loginName.trim(), password)
        notify(t('auth.welcome', { name: user.displayName }))
      }
    } catch (err) {
      setError(describe(err))
    } finally {
      setBusy(false)
    }
  }

  const handleGoogleSignIn = async () => {
    setError(null)
    setNetworkOffline(false)
    setGoogleBusy(true)
    try {
      const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
      if (googleClientId && typeof window !== 'undefined') {
        const redirectUri = `${window.location.origin}/auth/google/callback`
        const statePayload = {
          lang: currentLang,
          // Google Sign-In creates student or teacher accounts; a center registers with a login and password.
          role: mode === 'register' && role && role !== 'CENTER' ? role : undefined,
          next: safeNext || undefined,
        }
        const state = encodeURIComponent(JSON.stringify(statePayload))
        const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(googleClientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid%20email%20profile&prompt=select_account&state=${state}&hl=${currentLang}`
        window.location.href = authUrl
        return
      }

      // Do not pretend OAuth works when credentials are not configured
      setError(t('auth.err.googleUnconfigured'))
    } catch (err) {
      setError(describe(err))
    } finally {
      setGoogleBusy(false)
    }
  }

  const handleDemoLogin = async (selectedRole: 'STUDENT' | 'TEACHER') => {
    setBusy(true)
    setError(null)
    try {
      const user = await loginAsDemo(selectedRole)
      notify(t('auth.welcome', { name: user.displayName }))
    } catch (err) {
      setError(describe(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="container-x py-14 lg:py-20">
      <div className="mx-auto max-w-md">
        <Eyebrow className="mb-2">ILMORA</Eyebrow>
        <Card className="px-5 py-7 sm:px-7 sm:py-8 shadow-card border-charcoal/10 bg-white">
          <h1 className="font-display text-3xl text-charcoal">{t('auth.title')}</h1>
          <p className="mt-2 text-sm leading-relaxed text-charcoal/65">{t('auth.subtitle')}</p>

          {/* Social Sign-In (Google) */}
          <div className="mt-6">
            <button
              type="button"
              id="google-signin-button"
              onClick={handleGoogleSignIn}
              disabled={busy || googleBusy}
              className="flex w-full items-center justify-center gap-3 rounded-control border border-charcoal/15 bg-white px-4 py-3 text-sm font-semibold text-charcoal shadow-sm transition hover:border-forest/50 hover:bg-ivory/60 hover:shadow-lift active:scale-[0.99] disabled:opacity-50"
            >
              {googleBusy ? (
                <Icon name="refresh" className="h-4 w-4 animate-spin text-forest" />
              ) : (
                <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
              )}
              <span>{t('auth.google')}</span>
            </button>

            <div className="relative my-5 flex items-center justify-center">
              <div className="w-full border-t border-charcoal/10" />
              <span className="absolute bg-white px-3 text-[11px] font-medium uppercase tracking-wider text-charcoal/40">
                {t('auth.or')}
              </span>
            </div>
          </div>

          <Tabs<Mode>
            value={mode}
            onChange={switchMode}
            tabs={[
              { id: 'signin', label: t('auth.tab.signIn') },
              { id: 'register', label: t('auth.tab.register') },
            ]}
          />

          <form className="mt-6 space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void submit() }} aria-busy={busy}>
            {mode === 'register' && (
              <fieldset>
                <legend className="mb-2 text-xs font-medium text-charcoal/70">{t('auth.whoAreYou')}</legend>
                <div className="grid gap-2 sm:grid-cols-3">
                  {(['STUDENT', 'TEACHER', 'CENTER'] as const).map((r) => (
                    <button
                      key={r}
                      type="button"
                      aria-pressed={role === r}
                      onClick={() => { setRole(r); setFieldErrors((f) => ({ ...f, role: undefined })) }}
                      className={cx('rounded-control border p-3 text-left transition', role === r ? 'border-forest bg-sage/60 shadow-lift' : 'border-charcoal/12 bg-ivory/60 hover:border-forest/50')}
                    >
                      <div className="flex items-center gap-2 text-sm font-semibold text-charcoal">
                        <Icon name={r === 'STUDENT' ? 'user' : r === 'TEACHER' ? 'edit' : 'building'} className="h-4 w-4 text-forest" />
                        {t(r === 'STUDENT' ? 'role.student' : r === 'TEACHER' ? 'role.teacher' : 'auth.role.center')}
                      </div>
                      <div className="mt-1 text-[11px] leading-relaxed text-charcoal/60">
                        {t(r === 'STUDENT' ? 'auth.role.studentHint' : r === 'TEACHER' ? 'auth.role.teacherHint' : 'auth.role.centerHint')}
                      </div>
                    </button>
                  ))}
                </div>
                {fieldErrors.role && <p className="mt-1.5 text-xs text-red-700" role="alert">{fieldErrors.role}</p>}
              </fieldset>
            )}

            {mode === 'register' && role === 'CENTER' && (
              <Field label={t('auth.centerName')} required>
                <Input
                  maxLength={120}
                  value={centerName}
                  onChange={(e) => {
                    setCenterName(e.target.value)
                    if (fieldErrors.centerName) setFieldErrors((f) => ({ ...f, centerName: undefined }))
                  }}
                  aria-invalid={!!fieldErrors.centerName}
                />
                {fieldErrors.centerName && <p className="mt-1.5 text-xs text-red-700" role="alert">{fieldErrors.centerName}</p>}
              </Field>
            )}

            {mode === 'register' && (
              <Field label={t('auth.fullName')} hint={t('auth.fullNamePlaceholder')}>
                <Input
                  autoComplete="name"
                  maxLength={60}
                  placeholder={t('auth.fullNamePlaceholder')}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value)
                    if (fieldErrors.name) setFieldErrors((f) => ({ ...f, name: undefined }))
                  }}
                  aria-invalid={!!fieldErrors.name}
                />
                {fieldErrors.name && <p className="mt-1.5 text-xs text-red-700" role="alert">{fieldErrors.name}</p>}
              </Field>
            )}

            {mode === 'register' && (
              <Field label={t('auth.phone')} hint={t('auth.phonePlaceholder')}>
                <Input
                  type="tel"
                  autoComplete="tel"
                  placeholder="+998 90 123 45 67"
                  maxLength={20}
                  value={phone}
                  onChange={(e) => {
                    setPhone(e.target.value)
                    if (fieldErrors.phone) setFieldErrors((f) => ({ ...f, phone: undefined }))
                  }}
                  aria-invalid={!!fieldErrors.phone}
                />
                {fieldErrors.phone && <p className="mt-1.5 text-xs text-red-700" role="alert">{fieldErrors.phone}</p>}
              </Field>
            )}

            <Field
              label={mode === 'signin' ? t('auth.loginOrPhone') : t('auth.login')}
              hint={mode === 'register' ? t('auth.loginHint') : undefined}
            >
              <Input
                autoFocus={mode === 'signin'}
                autoComplete={mode === 'signin' ? 'username' : 'off'}
                autoCapitalize="none"
                spellCheck={false}
                maxLength={32}
                placeholder={mode === 'signin' ? t('auth.loginOrPhonePlaceholder') : 'anvar_qodirov'}
                value={loginName}
                onChange={(e) => {
                  setLoginName(e.target.value)
                  if (fieldErrors.login) setFieldErrors((f) => ({ ...f, login: undefined }))
                }}
                aria-invalid={!!fieldErrors.login}
              />
              {fieldErrors.login && <p className="mt-1.5 text-xs text-red-700" role="alert">{fieldErrors.login}</p>}
            </Field>

            <Field
              label={t('auth.password')}
              hint={mode === 'register' ? t('auth.passwordHint') : undefined}
            >
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  maxLength={128}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    if (fieldErrors.password) setFieldErrors((f) => ({ ...f, password: undefined }))
                  }}
                  aria-invalid={!!fieldErrors.password}
                  className="pr-10"
                />
                <button
                  type="button"
                  tabIndex={-1}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-charcoal/40 transition hover:text-forest focus:outline-none"
                  onClick={() => setShowPassword((v) => !v)}
                  title={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  aria-label={showPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                >
                  <Icon name={showPassword ? 'eyeOff' : 'eye'} className="h-4 w-4" />
                </button>
              </div>
              {fieldErrors.password && <p className="mt-1.5 text-xs text-red-700" role="alert">{fieldErrors.password}</p>}
            </Field>

            {mode === 'register' && (
              <Field label={t('auth.confirmPassword')}>
                <div className="relative">
                  <Input
                    type={showConfirm ? 'text' : 'password'}
                    autoComplete="new-password"
                    maxLength={128}
                    value={confirm}
                    onChange={(e) => {
                      setConfirm(e.target.value)
                      if (fieldErrors.confirm) setFieldErrors((f) => ({ ...f, confirm: undefined }))
                    }}
                    aria-invalid={!!fieldErrors.confirm}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    tabIndex={-1}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-charcoal/40 transition hover:text-forest focus:outline-none"
                    onClick={() => setShowConfirm((v) => !v)}
                    title={showConfirm ? t('auth.hidePassword') : t('auth.showPassword')}
                    aria-label={showConfirm ? t('auth.hidePassword') : t('auth.showPassword')}
                  >
                    <Icon name={showConfirm ? 'eyeOff' : 'eye'} className="h-4 w-4" />
                  </button>
                </div>
                {fieldErrors.confirm && <p className="mt-1.5 text-xs text-red-700" role="alert">{fieldErrors.confirm}</p>}
              </Field>
            )}

            {mode === 'register' && <ConsentFields value={consent} onChange={setConsent} invalid={consentInvalid} />}

            {error && (
              <div role="alert" className="space-y-3">
                <Notice tone="warn">{error}</Notice>
                {networkOffline && DEMO_LOGIN_ENABLED && (
                  <div className="rounded-control border border-sage bg-sage/30 p-3 text-xs text-charcoal/80">
                    <p className="font-semibold text-forest mb-2">{t('auth.demoQuick')}</p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => handleDemoLogin('STUDENT')}
                        disabled={busy}
                      >
                        {t('auth.demoStudent')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDemoLogin('TEACHER')}
                        disabled={busy}
                      >
                        {t('auth.demoTeacher')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <Button type="submit" className="w-full" size="lg" disabled={busy || googleBusy}>
              {busy ? <Icon name="refresh" className="h-4 w-4 animate-spin" /> : <Icon name={mode === 'register' ? 'check' : 'arrowRight'} className="h-4 w-4" />}
              {mode === 'register' ? t('auth.createAccount') : t('auth.signIn')}
            </Button>

            {mode === 'register' && <p className="text-[11px] leading-relaxed text-charcoal/45">{t('auth.consent')}</p>}

            <p className="text-center text-xs text-charcoal/60">
              {mode === 'register' ? t('auth.haveAccount') : t('auth.noAccount')}{' '}
              <button
                type="button"
                className="font-medium text-forest underline hover:text-forest/80"
                onClick={() => switchMode(mode === 'register' ? 'signin' : 'register')}
              >
                {mode === 'register' ? t('auth.tab.signIn') : t('auth.tab.register')}
              </button>
            </p>
          </form>
        </Card>
        <p className="mt-4 text-center text-[11px] text-charcoal/45">
          <Link to="/" className="underline hover:text-charcoal/70">{t('common.goHome')}</Link>
        </p>
      </div>
    </div>
  )
}
