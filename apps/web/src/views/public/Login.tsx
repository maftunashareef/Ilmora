'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { INSTITUTION_REGISTRY, INSTITUTION_TYPES, normalizeUzInn, normalizeUzPhone, ORG_OWNERSHIPS, isUzRegion, type InstitutionChoice, type InstitutionType, type OrgOwnership, type MfaChallengeDto } from '@ilmora/shared'
import { ConsentFields } from '../../components/ConsentGate'
import { consentComplete, EMPTY_CONSENT, type ConsentState } from '../../components/consent'
import { InstitutionSearch } from '../../components/InstitutionSearch'
import { Button, Card, Eyebrow, Field, Icon, Input, Notice, Tabs } from '../../components/ui'
import { cx } from '../../components/ui/helpers'
import type { TKey } from '../../i18n/translations'
import { useT } from '../../i18n/useT'
import { isApiError } from '../../lib/api'
import { apiErrorText, tooManyText } from '../../lib/apiErrors'
import { DEMO_LOGIN_ENABLED } from '../../lib/demoMode'
import { Link } from '../../lib/router'
import { useNavigate, useSearchParams } from '../../lib/routerHooks'
import { canOpen, homeFor } from '../../lib/workspaceHome'
import { startCompany } from '../../services/companies'
import { claimInstitution } from '../../services/institutions'
import { MfaSignIn } from '../../components/MfaSignIn'
import { ForgotPassword } from '../../components/ForgotPassword'
import { PasswordChangeForm } from '../../components/PasswordChange'
import { isMfaChallenge, useStore, type AuthUser, type RegisterRole } from '../../store/useStore'

type Mode = 'signin' | 'register'
type FieldKey = 'role' | 'name' | 'phone' | 'login' | 'password' | 'confirm' | 'centerName' | 'position' | 'instType' | 'ownership' | 'institution' | 'inn' | 'companyName' | 'email'
const LOGIN_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

/** Self-service roles shown at registration: people first, then organizations. */
const ROLE_GROUPS: { label: TKey; cols: string; roles: RegisterRole[] }[] = [
  { label: 'auth.group.person', cols: 'sm:grid-cols-2', roles: ['STUDENT', 'TEACHER'] },
  { label: 'auth.group.org', cols: 'sm:grid-cols-3', roles: ['CENTER', 'INSTITUTION', 'COMPANY'] },
]
const ROLE_META: Record<RegisterRole, { icon: string; label: TKey; hint: TKey }> = {
  STUDENT: { icon: 'user', label: 'role.student', hint: 'auth.role.studentHint' },
  TEACHER: { icon: 'edit', label: 'role.teacher', hint: 'auth.role.teacherHint' },
  CENTER: { icon: 'building', label: 'auth.role.center', hint: 'auth.role.centerHint' },
  INSTITUTION: { icon: 'cap', label: 'auth.role.institution', hint: 'auth.role.institutionHint' },
  COMPANY: { icon: 'briefcase', label: 'auth.role.company', hint: 'auth.role.companyHint' },
}
/**
 * An institution (ТЗ 4.2) or a company (ТЗ 4.3) signs up as its representative (name, job title, phone) with its STIR.
 * An institution also says what it is (type, ownership) and picks itself from the registry or types its name; a company
 * gives its name and the representative's email. The account is created first; then the institution is claimed by STIR
 * (`claimInstitution`) or the company profile is started (`startCompany`). The rest is completed in the workspace.
 */
const isOrgRole = (r: RegisterRole | null): r is 'INSTITUTION' | 'COMPANY' => r === 'INSTITUTION' || r === 'COMPANY'
/**
 * Where a new account goes first: a student starts the questionnaire (ТЗ 4.1); an institution's or a company's
 * representative goes to the home page until their workspace exists.
 */
const FIRST_STOP: Partial<Record<RegisterRole, string>> = { STUDENT: '/student/questionnaire', INSTITUTION: '/', COMPANY: '/' }

export function LoginPage() {
  const { t } = useT()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const rawNext = params.get('next') ?? ''
  const safeNext = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : null
  const auth = useStore((s) => s.auth)
  const lang = useStore((s) => s.lang)
  const login = useStore((s) => s.login)
  const register = useStore((s) => s.register)
  const loginAsDemo = useStore((s) => s.loginAsDemo)
  const notify = useStore((s) => s.notify)

  const [mode, setMode] = useState<Mode>(params.get('mode') === 'register' ? 'register' : 'signin')
  const [role, setRole] = useState<RegisterRole | null>(null)
  const [centerName, setCenterName] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [position, setPosition] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [email, setEmail] = useState('')
  const firstStop = useRef<string | null>(null)
  /** Holds the redirect after sign-up while the institution is being claimed. */
  const holdRedirect = useRef(false)
  const [instType, setInstType] = useState<InstitutionType | null>(null)
  const [ownership, setOwnership] = useState<OrgOwnership | null>(null)
  const [institution, setInstitution] = useState<InstitutionChoice | null>(null)
  const [inn, setInn] = useState('')
  const [loginName, setLoginName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [consent, setConsent] = useState<ConsentState>(EMPTY_CONSENT)
  const [consentInvalid, setConsentInvalid] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [networkOffline, setNetworkOffline] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({})
  const clearError = (key: FieldKey) => { if (fieldErrors[key]) setFieldErrors((f) => ({ ...f, [key]: undefined })) }
  const registryEntry = (c: InstitutionChoice | null) => (c?.id ? INSTITUTION_REGISTRY.find((x) => x.id === c.id) : undefined)
  const picked = registryEntry(institution)
  /** The STIR shown came from the picked registry entry (not typed), so it goes when that pick goes. */
  const innFromPick = !!picked?.inn && inn === picked.inn
  const chooseInstitution = (v: InstitutionChoice | null) => {
    const entry = registryEntry(v)
    setInstitution(v)
    clearError('institution')
    if (entry?.ownership) setOwnership(entry.ownership)
    if (entry?.inn && (!inn || innFromPick)) { setInn(entry.inn); clearError('inn') }
    else if (!entry?.inn && innFromPick) setInn('')
  }
  const isOrg = mode === 'register' && isOrgRole(role)
  
  /** Where a signed-in account goes: its first stop after sign-up, the page it came from (if it may open it), or its home. */
  const destination = useCallback(
    (roles: readonly string[]) => firstStop.current ?? (safeNext && canOpen(roles, safeNext) ? safeNext : homeFor(roles)),
    [safeNext],
  )
  // A temporary password from the Super Admin (ministry) is changed here first; the page moves on once the new session
  // comes back without the flag.
  const mustChangePassword = auth.status === 'authenticated' && auth.user?.passwordChangeRequired === true
  useEffect(() => {
    if (auth.status !== 'authenticated' || holdRedirect.current || auth.user?.passwordChangeRequired) return
    nav(destination(auth.user?.roles ?? []), { replace: true })
  }, [auth.status, auth.user, nav, destination])

  /** The authenticator step after the password (ministry, Super Admins); the page waits for it before moving on. */
  const [mfa, setMfa] = useState<MfaChallengeDto | null>(null)
  /** «Забыли пароль?»: the card shows the phone → SMS code → new password steps; success signs in and moves on. */
  const [forgot, setForgot] = useState(false)
  const finishMfa = (user: AuthUser) => {
    holdRedirect.current = false
    setMfa(null)
    // Still on the temporary password: the card shows «Смените временный пароль» next, the rest (and the welcome) after.
    if (user.passwordChangeRequired) return
    notify(t('auth.welcome', { name: user.displayName }))
    nav(destination(user.roles), { replace: true })
  }
  const restartMfa = () => {
    holdRedirect.current = false
    setMfa(null)
    setPassword('')
  }

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
    if (err.status === 429) return tooManyText(err, lang)
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
      if (isOrgRole(role) && position.trim().length < 2) next.position = t('auth.err.position')
      if (role === 'INSTITUTION') {
        if (!instType) next.instType = t('q.err.institutionType')
        if (!ownership) next.ownership = t('auth.err.ownership')
        if (!institution || institution.name.trim().length < 2 || !isUzRegion(institution.region)) next.institution = t('q.err.institution')
      }
      if (isOrgRole(role) && !normalizeUzInn(inn).ok) next.inn = t('auth.err.inn')
      if (role === 'COMPANY' && companyName.trim().length < 2) next.companyName = t('auth.err.orgName')
      if (role === 'COMPANY' && !EMAIL_RE.test(email.trim())) next.email = t('q.err.email')
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

  /**
   * The account exists; now it claims the institution by STIR. Whatever the answer, the representative is signed in and
   * moves on: a refused claim (the STIR already has a representative) is shown as a warning to take to support.
   */
  const claimAfterSignUp = async (type: InstitutionType, own: OrgOwnership, choice: InstitutionChoice) => {
    try {
      const outcome = await claimInstitution({ stir: inn.replace(/\D/g, ''), type, name: choice.name, ownership: own, region: choice.region })
      notify(t(outcome.detailsSaved ? 'auth.institutionClaimed' : 'auth.institutionClaimedDetailsLater', { name: choice.name.trim() }))
    } catch (err) {
      notify(apiErrorText(err, lang), 'warn')
    } finally {
      holdRedirect.current = false
      nav(firstStop.current ?? '/', { replace: true })
    }
  }

  /** The account exists; now the STIR and the name start the company profile (a registered STIR → "write to support"). */
  const startCompanyAfterSignUp = async () => {
    try {
      const { emailSaved } = await startCompany({ stir: inn.replace(/\D/g, ''), name: companyName, email })
      notify(t(emailSaved ? 'auth.companyCreated' : 'auth.companyCreatedEmailLater', { name: companyName.trim() }))
    } catch (err) {
      notify(apiErrorText(err, lang), 'warn')
    } finally {
      holdRedirect.current = false
      nav(firstStop.current ?? '/', { replace: true })
    }
  }

  const submit = async () => {
    setError(null)
    setNetworkOffline(false)
    if (!validate()) return
    setBusy(true)
    try {
      const normalizedLogin = loginName.trim().toLowerCase()
      if (mode === 'register' && role) {
        firstStop.current = FIRST_STOP[role] ?? null
        holdRedirect.current = isOrgRole(role)
        const user = await register({
          role,
          login: normalizedLogin,
          password,
          displayName: name.trim() || undefined,
          phone: phone.trim() || undefined,
          centerName: role === 'CENTER' ? centerName.trim() : undefined,
          jobTitle: isOrgRole(role) ? position.trim() : undefined,
          acceptOffer: true,
          consentPersonalData: true,
        })
        notify(t('auth.registered', { name: user.displayName }))
        if (role === 'INSTITUTION') {
          if (instType && ownership && institution) await claimAfterSignUp(instType, ownership, institution)
          else { holdRedirect.current = false; nav(firstStop.current ?? '/', { replace: true }) }
        }
        if (role === 'COMPANY') await startCompanyAfterSignUp()
      } else {
        const result = await login(loginName.trim(), password)
        if (isMfaChallenge(result)) {
          // Hold the redirect: the first sign-in shows the recovery codes once the session is already open.
          holdRedirect.current = true
          setMfa(result)
        } else if (!result.passwordChangeRequired) {
          // A temporary password from the Super Admin: the card asks for a new one first, the welcome comes after.
          notify(t('auth.welcome', { name: result.displayName }))
        }
      }
    } catch (err) {
      holdRedirect.current = false
      setError(describe(err))
    } finally {
      setBusy(false)
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
          <p className="mt-2 text-sm leading-relaxed text-charcoal/65">{t(mfa ? 'mfa.passwordAccepted' : mustChangePassword ? 'pwd.lastStep' : forgot ? 'forgot.subtitle' : 'auth.subtitle')}</p>

          {mfa ? (
            <div className="mt-6 border-t border-charcoal/10 pt-6">
              <MfaSignIn challenge={mfa} onSignedIn={finishMfa} onRestart={restartMfa} />
            </div>
          ) : mustChangePassword ? (
            <div className="mt-6 border-t border-charcoal/10 pt-6">
              <PasswordChangeForm required />
            </div>
          ) : forgot ? (
            <div className="mt-6 border-t border-charcoal/10 pt-6">
              <ForgotPassword onBack={() => setForgot(false)} onDone={() => setForgot(false)} />
            </div>
          ) : (<>
          <Tabs<Mode>
            className="mt-6"
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

            {mode === 'register' && role === 'INSTITUTION' && (
              <section aria-labelledby="org-details-title" className="space-y-4 rounded-control border border-forest/15 bg-sage/20 p-4">
                <h2 id="org-details-title" className="flex items-center gap-2 font-body text-sm font-semibold text-charcoal">
                  <Icon name="cap" className="h-4 w-4 text-forest" />{t('auth.org.institutionTitle')}
                </h2>
                <fieldset>
                  <legend className="mb-1.5 text-xs font-medium text-charcoal/70">{t('q.institutionType')}<span className="ml-0.5 text-champagne">*</span></legend>
                  <div className="flex flex-wrap gap-2">
                    {INSTITUTION_TYPES.map((x) => (
                      <button key={x} type="button" aria-pressed={instType === x}
                        onClick={() => { setInstType(x); clearError('instType'); if (picked && picked.type !== x) chooseInstitution(null) }}
                        className={cx('min-h-[38px] rounded-control border px-3.5 py-1.5 text-sm font-medium transition', instType === x ? 'border-forest bg-forest text-ivory' : 'border-charcoal/15 bg-paper text-charcoal/75 hover:border-forest/50')}>
                        {t(`inst.type.${x}`)}
                      </button>
                    ))}
                  </div>
                  {fieldErrors.instType && <p className="mt-1.5 text-xs text-red-700" role="alert">{fieldErrors.instType}</p>}
                </fieldset>
                <fieldset>
                  <legend className="mb-1.5 text-xs font-medium text-charcoal/70">{t('auth.org.ownershipLabel')}<span className="ml-0.5 text-champagne">*</span></legend>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {ORG_OWNERSHIPS.map((o) => (
                      <button key={o} type="button" aria-pressed={ownership === o}
                        onClick={() => { setOwnership(o); clearError('ownership'); if (picked?.ownership && picked.ownership !== o) chooseInstitution(null) }}
                        className={cx('flex items-start gap-2.5 rounded-control border bg-paper p-3 text-left transition', ownership === o ? 'border-forest ring-2 ring-forest/15' : 'border-charcoal/15 hover:border-forest/50')}>
                        <span className={cx('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', ownership === o ? 'border-forest' : 'border-charcoal/30')}>
                          {ownership === o && <span className="h-2 w-2 rounded-full bg-forest" />}
                        </span>
                        <span>
                          <span className="block text-sm font-semibold text-charcoal">{t(o === 'STATE' ? 'auth.org.stateInst' : 'auth.org.privateInst')}</span>
                          <span className="mt-0.5 block text-[11px] leading-snug text-charcoal/55">{t(o === 'STATE' ? 'auth.org.stateHint' : 'auth.org.privateHint')}</span>
                        </span>
                      </button>
                    ))}
                  </div>
                  {fieldErrors.ownership && <p className="mt-1.5 text-xs text-red-700" role="alert">{fieldErrors.ownership}</p>}
                </fieldset>
                <div>
                  <label htmlFor="reg-institution" className="mb-1.5 flex items-baseline justify-between gap-3 text-xs font-medium text-charcoal/70">
                    <span>{t('auth.org.institution')}<span className="ml-0.5 text-champagne">*</span></span>
                    <span className="text-[11px] font-normal text-charcoal/45">{t('auth.org.technikumFilterHint')}</span>
                  </label>
                  <InstitutionSearch id="reg-institution" list={INSTITUTION_REGISTRY} type={instType} ownership={ownership} value={institution} invalid={!!fieldErrors.institution} onChange={chooseInstitution} />
                  {fieldErrors.institution && <p className="mt-1.5 text-xs text-red-700" role="alert">{fieldErrors.institution}</p>}
                </div>
                <InnField value={inn} error={fieldErrors.inn} fromList={innFromPick} onChange={(v) => { setInn(v); clearError('inn') }} />
              </section>
            )}

            {mode === 'register' && role === 'COMPANY' && (
              <section aria-labelledby="company-details-title" className="space-y-4 rounded-control border border-forest/15 bg-sage/20 p-4">
                <h2 id="company-details-title" className="flex items-center gap-2 font-body text-sm font-semibold text-charcoal">
                  <Icon name="briefcase" className="h-4 w-4 text-forest" />{t('auth.org.companyTitle')}
                </h2>
                <Field label={t('auth.org.companyName')} required>
                  <Input maxLength={200} placeholder={t('auth.org.companyNamePlaceholder')} value={companyName}
                    onChange={(e) => { setCompanyName(e.target.value); clearError('companyName') }} aria-invalid={!!fieldErrors.companyName} />
                  {fieldErrors.companyName && <p className="mt-1.5 text-xs text-red-700" role="alert">{fieldErrors.companyName}</p>}
                </Field>
                <InnField value={inn} error={fieldErrors.inn} onChange={(v) => { setInn(v); clearError('inn') }} />
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
              <Field label={t(role === 'INSTITUTION' ? 'auth.org.repName' : role === 'COMPANY' ? 'auth.org.contactName' : 'auth.fullName')} hint={t('auth.fullNamePlaceholder')} required={isOrg}>
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

            {isOrg && (
              <Field label={t('auth.position')} required>
                <Input
                  autoComplete="organization-title"
                  maxLength={80}
                  placeholder={t('auth.positionPlaceholder')}
                  value={position}
                  onChange={(e) => { setPosition(e.target.value); if (fieldErrors.position) setFieldErrors((f) => ({ ...f, position: undefined })) }}
                  aria-invalid={!!fieldErrors.position}
                />
                {fieldErrors.position && <p className="mt-1.5 text-xs text-red-700" role="alert">{fieldErrors.position}</p>}
              </Field>
            )}

            {mode === 'register' && (
              <Field label={t('auth.phone')} hint={t('auth.phonePlaceholder')} required={isOrg}>
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

            {role === 'COMPANY' && mode === 'register' && (
              <Field label={t('q.email')} required>
                <Input type="email" autoComplete="email" maxLength={120} placeholder="info@company.uz" value={email}
                  onChange={(e) => { setEmail(e.target.value); clearError('email') }} aria-invalid={!!fieldErrors.email} />
                {fieldErrors.email && <p className="mt-1.5 text-xs text-red-700" role="alert">{fieldErrors.email}</p>}
              </Field>
            )}

            {isOrg && (
              <p className="flex items-start gap-2 rounded-control bg-sage/30 px-3 py-2.5 text-xs leading-relaxed text-charcoal/70">
                <Icon name="info" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-forest" />
                {t(role === 'COMPANY' ? 'auth.companyNext' : 'auth.institutionNext')}
              </p>
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

            <Button type="submit" className="w-full" size="lg" disabled={busy}>
              {busy ? <Icon name="refresh" className="h-4 w-4 animate-spin" /> : <Icon name={mode === 'register' ? 'check' : 'arrowRight'} className="h-4 w-4" />}
              {mode === 'register' ? t('auth.createAccount') : t('auth.signIn')}
            </Button>
            {mode === 'signin' && (
              <button type="button" className="block w-full text-center text-xs font-medium text-forest underline hover:text-forest/80" onClick={() => { setError(null); setForgot(true) }}>{t('forgot.link')}</button>
            )}

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
          </>)}
        </Card>
        <p className="mt-4 text-center text-[11px] text-charcoal/45">
          <Link to="/" className="underline hover:text-charcoal/70">{t('common.goHome')}</Link>
        </p>
      </div>
    </div>
  )
}

/** STIR (TIN): digits only, nine of them; spaces and dashes typed or pasted are dropped. */
function InnField({ value, onChange, error, fromList }: { value: string; onChange: (v: string) => void; error?: string; fromList?: boolean }) {
  const { t } = useT()
  return (
    <Field label={t('auth.org.stir')} hint={t('auth.org.innHint')} required>
      <Input inputMode="numeric" autoComplete="off" placeholder="123456789" value={value}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, '').slice(0, 9))} aria-invalid={!!error} className="tabular-nums tracking-wider" />
      {error && <p className="mt-1.5 text-xs text-red-700" role="alert">{error}</p>}
      {!error && fromList && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[11px] leading-snug text-charcoal/55">
          <Icon name="info" className="mt-px h-3.5 w-3.5 shrink-0 text-champagne" />{t('auth.org.innFromList')}
        </p>
      )}
    </Field>
  )
}
