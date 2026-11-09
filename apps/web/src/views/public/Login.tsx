'use client'
import { useEffect, useState } from 'react'
import { isUzRegion, normalizeUzInn, normalizeUzPhone, ORG_OWNERSHIPS, TECHNIKUMS, UZ_REGIONS, type OrgOwnership, type Technikum } from '@ilmora/shared'
import { ConsentFields, consentComplete, EMPTY_CONSENT, type ConsentState } from '../../components/ConsentGate'
import { TechnikumPicker } from '../../components/TechnikumPicker'
import { Button, Card, cx, Eyebrow, Field, Icon, Input, Notice, Select, Tabs } from '../../components/ui'
import type { TKey } from '../../i18n/translations'
import { useT } from '../../i18n/useT'
import { isApiError } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import { DEMO_LOGIN_ENABLED } from '../../lib/demoMode'
import { Link, useLocale, useNavigate, useSearchParams } from '../../lib/router'
import { canOpen, homeFor } from '../../lib/workspaceHome'
import { useStore, type RegisterRole } from '../../store/useStore'

type Mode = 'signin' | 'register'
type FieldKey = 'role' | 'name' | 'phone' | 'login' | 'password' | 'confirm' | 'centerName' | 'orgName' | 'ownership' | 'region' | 'inn'
const LOGIN_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/

/** Self-service roles shown at registration: people first, then organizations. */
const ROLE_GROUPS: { label: TKey; cols: string; roles: RegisterRole[] }[] = [
  { label: 'auth.group.person', cols: 'sm:grid-cols-2', roles: ['STUDENT', 'TEACHER'] },
  { label: 'auth.group.org', cols: 'sm:grid-cols-3', roles: ['CENTER', 'TECHNIKUM', 'COMPANY'] },
]
const ROLE_META: Record<RegisterRole, { icon: string; label: TKey; hint: TKey }> = {
  STUDENT: { icon: 'user', label: 'role.student', hint: 'auth.role.studentHint' },
  TEACHER: { icon: 'edit', label: 'role.teacher', hint: 'auth.role.teacherHint' },
  CENTER: { icon: 'building', label: 'auth.role.center', hint: 'auth.role.centerHint' },
  TECHNIKUM: { icon: 'cap', label: 'auth.role.technikum', hint: 'auth.role.technikumHint' },
  COMPANY: { icon: 'briefcase', label: 'auth.role.company', hint: 'auth.role.companyHint' },
}
const isOrgRole = (r: RegisterRole | null): r is 'TECHNIKUM' | 'COMPANY' => r === 'TECHNIKUM' || r === 'COMPANY'

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
  const [role, setRole] = useState<RegisterRole | null>(null)
  const [centerName, setCenterName] = useState('')
  const [orgName, setOrgName] = useState('')
  const [technikumId, setTechnikumId] = useState<string | null>(null)
  const [ownership, setOwnership] = useState<OrgOwnership | null>(null)
  const [region, setRegion] = useState('')
  const [inn, setInn] = useState('')
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
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({})
  const isOrg = mode === 'register' && isOrgRole(role)
  const clearError = (key: FieldKey) => { if (fieldErrors[key]) setFieldErrors((f) => ({ ...f, [key]: undefined })) }

  const pickedTechnikum = technikumId ? TECHNIKUMS.find((x) => x.id === technikumId) : undefined
  /** The TIN shown came from the picked technikum (not typed by the user), so it goes when that pick goes. */
  const innFromPick = (x: Technikum | undefined) => !!x?.inn && inn === x.inn
  /** A picked technikum fills the region, the type and (when known) the TIN; the user can still change them. */
  const applyTechnikum = (x: Technikum) => {
    setRegion(x.region)
    setOwnership(x.ownership)
    const fillInn = !!x.inn && (!inn || innFromPick(pickedTechnikum))
    if (fillInn) setInn(x.inn!)
    setFieldErrors((f) => ({ ...f, region: undefined, ownership: undefined, inn: fillInn ? undefined : f.inn }))
  }
  /** Leaving a picked technikum (typing another name, or a region or type it does not match) clears what it filled in. */
  const dropTechnikum = (name: string) => {
    if (innFromPick(pickedTechnikum)) setInn('')
    setTechnikumId(null)
    setOrgName(name)
  }
  const keepTechnikumIf = (ok: (x: Technikum) => boolean) => {
    if (pickedTechnikum && !ok(pickedTechnikum)) dropTechnikum('')
  }

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
      case 'invalid_organization_name': return t('auth.err.orgName')
      case 'invalid_ownership': return t('auth.err.ownership')
      case 'invalid_region': return t('auth.err.region')
      case 'invalid_inn': return t('auth.err.inn')
      case 'inn_taken': return t('auth.err.innTaken')
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
      if (isOrgRole(role)) {
        if (orgName.trim().length < 2) next.orgName = t('auth.err.orgName')
        if (role === 'TECHNIKUM' && !ownership) next.ownership = t('auth.err.ownership')
        if (!isUzRegion(region)) next.region = t('auth.err.region')
        if (!normalizeUzInn(inn).ok) next.inn = t('auth.err.inn')
      }
      if (!name.trim() || name.trim().length < 2) next.name = t('auth.err.name')
      // An organization must leave a contact phone; for a person the phone is optional.
      if (phone.trim() || isOrgRole(role)) {
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
          organization: isOrgRole(role)
            ? {
                name: orgName.trim(),
                region,
                inn: inn.replace(/\D/g, ''),
                ownership: role === 'TECHNIKUM' ? ownership ?? undefined : undefined,
                technikumId: role === 'TECHNIKUM' ? technikumId ?? undefined : undefined,
              }
            : undefined,
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
          // Google Sign-In creates student or teacher accounts; an organization registers with a login and password.
          role: mode === 'register' && (role === 'STUDENT' || role === 'TEACHER') ? role : undefined,
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
      <div className={cx('mx-auto', mode === 'register' ? 'max-w-lg' : 'max-w-md')}>
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
                <div className="space-y-3">
                  {ROLE_GROUPS.map((group) => (
                    <div key={group.label}>
                      <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-charcoal/45">{t(group.label)}</p>
                      <div className={cx('grid gap-2', group.cols)}>
                        {group.roles.map((r) => (
                          <button
                            key={r}
                            type="button"
                            aria-pressed={role === r}
                            onClick={() => { setRole(r); clearError('role') }}
                            className={cx('flex flex-col items-start justify-start rounded-control border p-3 text-left transition', role === r ? 'border-forest bg-sage/60 shadow-lift' : 'border-charcoal/12 bg-ivory/60 hover:border-forest/50')}
                          >
                            <div className="flex items-center gap-2 text-sm font-semibold text-charcoal">
                              <Icon name={ROLE_META[r].icon} className="h-4 w-4 shrink-0 text-forest" />
                              {t(ROLE_META[r].label)}
                            </div>
                            <div className="mt-1 text-[11px] leading-relaxed text-charcoal/60">{t(ROLE_META[r].hint)}</div>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                {fieldErrors.role && <p className="mt-1.5 text-xs text-red-700" role="alert">{fieldErrors.role}</p>}
              </fieldset>
            )}

            {isOrg && (
              <section aria-labelledby="org-details-title" className="space-y-4 rounded-control border border-forest/15 bg-sage/20 p-4">
                <h2 id="org-details-title" className="flex items-center gap-2 font-body text-sm font-semibold text-charcoal">
                  <Icon name={role === 'TECHNIKUM' ? 'cap' : 'briefcase'} className="h-4 w-4 text-forest" />
                  {t('auth.org.title')}
                </h2>

                {role === 'COMPANY' && (
                  <Field label={t('auth.org.companyName')} required>
                    <Input
                      maxLength={120}
                      placeholder={t('auth.org.companyNamePlaceholder')}
                      value={orgName}
                      onChange={(e) => { setOrgName(e.target.value); clearError('orgName') }}
                      aria-invalid={!!fieldErrors.orgName}
                    />
                    {fieldErrors.orgName && <p className="mt-1.5 text-xs text-red-700" role="alert">{fieldErrors.orgName}</p>}
                  </Field>
                )}

                {role === 'TECHNIKUM' && (
                  <fieldset>
                    <legend className="mb-1.5 text-xs font-medium text-charcoal/70">
                      {t('auth.org.ownership')}<span className="ml-0.5 text-champagne">*</span>
                    </legend>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {ORG_OWNERSHIPS.map((o) => (
                        <button
                          key={o}
                          type="button"
                          aria-pressed={ownership === o}
                          onClick={() => { setOwnership(o); clearError('ownership'); keepTechnikumIf((x) => x.ownership === o) }}
                          className={cx('flex items-start gap-2.5 rounded-control border bg-paper p-3 text-left transition', ownership === o ? 'border-forest ring-2 ring-forest/15' : 'border-charcoal/15 hover:border-forest/50')}
                        >
                          <span className={cx('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', ownership === o ? 'border-forest' : 'border-charcoal/30')}>
                            {ownership === o && <span className="h-2 w-2 rounded-full bg-forest" />}
                          </span>
                          <span>
                            <span className="block text-sm font-semibold text-charcoal">{t(o === 'STATE' ? 'auth.org.state' : 'auth.org.private')}</span>
                            <span className="mt-0.5 block text-[11px] leading-snug text-charcoal/55">{t(o === 'STATE' ? 'auth.org.stateHint' : 'auth.org.privateHint')}</span>
                          </span>
                        </button>
                      ))}
                    </div>
                    {fieldErrors.ownership && <p className="mt-1.5 text-xs text-red-700" role="alert">{fieldErrors.ownership}</p>}
                  </fieldset>
                )}

                <Field label={t('auth.org.region')} required>
                  <Select
                    value={region}
                    onChange={(e) => { const r = e.target.value; setRegion(r); clearError('region'); keepTechnikumIf((x) => x.region === r) }}
                    aria-invalid={!!fieldErrors.region}
                    className={region ? undefined : 'text-charcoal/40'}
                  >
                    <option value="" disabled>{t('auth.org.regionPlaceholder')}</option>
                    {UZ_REGIONS.map((r) => <option key={r.id} value={r.id} className="text-charcoal">{r.name[currentLang]}</option>)}
                  </Select>
                  {fieldErrors.region && <p className="mt-1.5 text-xs text-red-700" role="alert">{fieldErrors.region}</p>}
                </Field>

                {role === 'TECHNIKUM' && (
                  <div>
                    <label htmlFor="technikum-name" className="mb-1.5 flex items-baseline justify-between gap-3 text-xs font-medium text-charcoal/70">
                      <span>{t('auth.org.technikumName')}<span className="ml-0.5 text-champagne">*</span></span>
                      {TECHNIKUMS.length > 0 && <span className="text-[11px] font-normal text-charcoal/45">{t('auth.org.technikumFilterHint')}</span>}
                    </label>
                    <TechnikumPicker
                      id="technikum-name"
                      list={TECHNIKUMS}
                      value={{ id: technikumId, name: orgName }}
                      region={region}
                      ownership={ownership}
                      invalid={!!fieldErrors.orgName}
                      onChange={(v, picked) => { clearError('orgName'); if (picked) { applyTechnikum(picked); setTechnikumId(v.id); setOrgName(v.name) } else if (technikumId) dropTechnikum(v.name); else setOrgName(v.name) }}
                    />
                    {fieldErrors.orgName && <p className="mt-1.5 text-xs text-red-700" role="alert">{fieldErrors.orgName}</p>}
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('auth.org.inn')} hint={t('auth.org.innHint')} required>
                    <Input
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="123456789"
                      value={inn}
                      onChange={(e) => { setInn(e.target.value.replace(/\D/g, '').slice(0, 9)); clearError('inn') }}
                      aria-invalid={!!fieldErrors.inn}
                      className="tabular-nums tracking-wider"
                    />
                    {fieldErrors.inn && <p className="mt-1.5 text-xs text-red-700" role="alert">{fieldErrors.inn}</p>}
                  </Field>
                  <Field label={t('auth.org.phone')} required>
                    <Input
                      type="tel"
                      autoComplete="tel"
                      placeholder="+998 71 123 45 67"
                      maxLength={20}
                      value={phone}
                      onChange={(e) => { setPhone(e.target.value); clearError('phone') }}
                      aria-invalid={!!fieldErrors.phone}
                    />
                    {fieldErrors.phone && <p className="mt-1.5 text-xs text-red-700" role="alert">{fieldErrors.phone}</p>}
                  </Field>
                </div>
              </section>
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
              <Field label={t(isOrg ? 'auth.org.contactName' : 'auth.fullName')} hint={t('auth.fullNamePlaceholder')}>
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

            {mode === 'register' && !isOrg && (
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
