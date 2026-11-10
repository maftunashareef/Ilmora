'use client'
import { useCallback, useEffect, useState } from 'react'
import type { MinistryAccountDto } from '@ilmora/shared'
import { Badge, Button, EmptyState, Field, Icon, Input, Modal, Notice, PageTitle } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { apiErrorText } from '../../lib/apiErrors'
import { formatDate, formatTime } from '../../lib/format'
import { MINISTRY_LOGIN_RE, ministryAccounts, normalizeLogin, type MinistryAccountForm } from '../../services/ministryAccounts'
import { useStore } from '../../store/useStore'

type Ask = { kind: 'disable' | 'enable' | 'password' | 'app'; account: MinistryAccountDto }
type Shown = { account: MinistryAccountDto; password: string; created: boolean }
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Super Admin: ministry accounts (ТЗ 4.4). There is no self-registration for the ministry: the Super Admin creates the
 * account and hands over the temporary password, which is shown once; the first sign-in links the authenticator app.
 * A lost phone is solved here by unlinking the app — the next sign-in shows the QR code again.
 */
export function AdminMinistry() {
  const { t, lang } = useT()
  const notify = useStore((s) => s.notify)
  const [accounts, setAccounts] = useState<MinistryAccountDto[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<MinistryAccountDto | 'new' | null>(null)
  const [ask, setAsk] = useState<Ask | null>(null)
  const [shown, setShown] = useState<Shown | null>(null)

  const [round, setRound] = useState(0)
  useEffect(() => {
    let live = true
    ministryAccounts.list().then(
      (list) => { if (live) { setAccounts(list); setLoadError(null) } },
      (err) => { if (live) setLoadError(apiErrorText(err, lang)) },
    )
    return () => { live = false }
  }, [lang, round])

  const put = (a: MinistryAccountDto) => setAccounts((cur) => (cur?.some((x) => x.id === a.id) ? cur.map((x) => (x.id === a.id ? a : x)) : [...(cur ?? []), a]))
  const closeEditor = useCallback(() => setEditing(null), [])
  const closeAsk = useCallback(() => setAsk(null), [])
  const closeShown = useCallback(() => setShown(null), [])

  const saved = (a: MinistryAccountDto, password?: string) => {
    put(a)
    setEditing(null)
    if (password) setShown({ account: a, password, created: true })
    else notify(t('common.saved'))
  }

  /** Runs the confirmed action; errors stay in the dialog. */
  const confirm = async ({ kind, account }: Ask) => {
    if (kind === 'password') {
      const r = await ministryAccounts.resetPassword(account.id)
      put(r.account)
      setShown({ account: r.account, password: r.temporaryPassword, created: false })
    } else if (kind === 'app') {
      await ministryAccounts.resetApp(account.id)
      put({ ...account, appLinked: false })
      notify(t('admin.ministry.appReset'))
    } else {
      put(await ministryAccounts.setActive(account.id, kind === 'enable'))
      notify(t(kind === 'enable' ? 'admin.ministry.enabled' : 'admin.ministry.disabledDone'))
    }
    setAsk(null)
  }

  return (
    <div>
      <PageTitle
        eyebrow={t('dash.admin')}
        title={t('admin.ministry')}
        subtitle={t('admin.ministry.hint')}
        action={<Button onClick={() => setEditing('new')}><Icon name="plus" className="h-4 w-4" />{t('admin.ministry.add')}</Button>}
      />
      {loadError && (
        <Notice tone="warn" className="mb-4">
          {loadError} <button type="button" className="ml-1 font-medium underline" onClick={() => setRound((r) => r + 1)}>{t('admin.ministry.retry')}</button>
        </Notice>
      )}
      {!accounts && !loadError && <p className="text-sm text-charcoal/55">{t('common.loading')}</p>}
      {accounts && accounts.length === 0 && (
        <EmptyState icon={<Icon name="shield" className="h-6 w-6" />} title={t('admin.ministry.empty')} body={t('admin.ministry.emptyBody')} action={<Button onClick={() => setEditing('new')}><Icon name="plus" className="h-4 w-4" />{t('admin.ministry.add')}</Button>} />
      )}
      {accounts && accounts.length > 0 && (
        <ul className="space-y-2" aria-label={t('admin.ministry')}>
          {accounts.map((a) => (
            <li key={a.id} className="card p-4">
              <div className="flex items-start gap-3">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${a.active ? 'bg-sage text-forest' : 'bg-charcoal/5 text-charcoal/40'}`}><Icon name="shield" className="h-4 w-4" /></span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`truncate text-sm font-medium ${a.active ? 'text-charcoal' : 'text-charcoal/50'}`}>{a.name}</span>
                    {a.appLinked ? <Badge tone="sage"><Icon name="lock" className="mr-1 h-3 w-3" />{t('admin.ministry.appLinked')}</Badge> : <Badge tone="warn">{t('admin.ministry.appNotLinked')}</Badge>}
                    {!a.active && <Badge tone="danger">{t('admin.ministry.disabled')}</Badge>}
                  </div>
                  <div className="truncate text-xs text-charcoal/60">{[`@${a.login}`, a.jobTitle, a.email].filter(Boolean).join(' · ')}</div>
                  <div className="text-xs text-charcoal/45">
                    {a.lastLoginAt ? `${t('admin.ministry.lastLogin')}: ${formatDate(a.lastLoginAt, lang)}, ${formatTime(a.lastLoginAt, lang)}` : t('admin.ministry.never')}
                    {' · '}{t('admin.ministry.createdAt')}: {formatDate(a.createdAt, lang)}
                  </div>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5 sm:pl-[52px]">
                <Button size="sm" variant="secondary" onClick={() => setEditing(a)}><Icon name="edit" className="h-3.5 w-3.5" />{t('common.edit')}</Button>
                <Button size="sm" variant="secondary" onClick={() => setAsk({ kind: 'password', account: a })}><Icon name="lock" className="h-3.5 w-3.5" />{t('admin.ministry.resetPassword')}</Button>
                {a.appLinked && <Button size="sm" variant="secondary" onClick={() => setAsk({ kind: 'app', account: a })}><Icon name="refresh" className="h-3.5 w-3.5" />{t('admin.ministry.resetApp')}</Button>}
                {a.active
                  ? <Button size="sm" variant="danger" onClick={() => setAsk({ kind: 'disable', account: a })}>{t('admin.ministry.disable')}</Button>
                  : <Button size="sm" variant="secondary" onClick={() => setAsk({ kind: 'enable', account: a })}><Icon name="check" className="h-3.5 w-3.5" />{t('admin.ministry.enable')}</Button>}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Notice tone="info" className="mt-6 text-xs">{t('admin.ministry.howItWorks')}</Notice>
      {editing && <AccountEditor account={editing === 'new' ? null : editing} onClose={closeEditor} onSaved={saved} />}
      {ask && <ConfirmDialog ask={ask} onClose={closeAsk} onConfirm={confirm} />}
      {shown && <PasswordDialog shown={shown} onClose={closeShown} />}
    </div>
  )
}

/** Create (login, name, job title, email) or edit (everything but the login) one ministry account. */
function AccountEditor({ account, onClose, onSaved }: { account: MinistryAccountDto | null; onClose: () => void; onSaved: (a: MinistryAccountDto, password?: string) => void }) {
  const { t, lang } = useT()
  const [form, setForm] = useState<MinistryAccountForm>({ login: account?.login ?? '', name: account?.name ?? '', jobTitle: account?.jobTitle ?? '', email: account?.email ?? '' })
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const set = (k: keyof MinistryAccountForm) => (e: { target: { value: string } }) => { setForm((f) => ({ ...f, [k]: e.target.value })); setError(null) }
  const loginBad = !account && form.login.trim() !== '' && !MINISTRY_LOGIN_RE.test(normalizeLogin(form.login))
  const emailBad = form.email.trim() !== '' && !EMAIL_RE.test(form.email.trim())
  const nameShort = form.name.trim().length < 2
  const jobShort = form.jobTitle.trim() !== '' && form.jobTitle.trim().length < 2
  const ready = (account || MINISTRY_LOGIN_RE.test(normalizeLogin(form.login))) && !nameShort && !jobShort && !emailBad && !saving

  const save = async () => {
    if (!ready) return
    setSaving(true)
    try {
      if (account) onSaved(await ministryAccounts.update(account.id, form))
      else { const r = await ministryAccounts.create(form); onSaved(r.account, r.temporaryPassword) }
    } catch (err) {
      setError(apiErrorText(err, lang))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={account ? t('admin.ministry.editTitle') : t('admin.ministry.addTitle')}
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button disabled={!ready} onClick={() => void save()}>{saving ? <Icon name="refresh" className="h-4 w-4 animate-spin" /> : null}{account ? t('common.save') : t('admin.ministry.create')}</Button></div>}
    >
      <form className="space-y-4" noValidate onSubmit={(e) => { e.preventDefault(); void save() }}>
        <Field label={t('auth.login')} required={!account} hint={account ? t('admin.ministry.loginFixed') : t('admin.ministry.loginHint')}>
          <Input id="ministry-login" value={form.login} onChange={set('login')} disabled={!!account} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={32} placeholder="vazirlik.ivanov" aria-invalid={loginBad} />
        </Field>
        {loginBad && <p className="-mt-2 text-xs text-red-700">{t('auth.err.login')}</p>}
        <Field label={t('admin.ministry.name')} required>
          <Input id="ministry-name" value={form.name} onChange={set('name')} maxLength={120} autoComplete="off" />
        </Field>
        <Field label={t('auth.position')}>
          <Input id="ministry-job" value={form.jobTitle} onChange={set('jobTitle')} maxLength={120} autoComplete="off" />
        </Field>
        <Field label={t('q.email')} hint={t('admin.ministry.emailHint')}>
          <Input id="ministry-email" type="email" value={form.email} onChange={set('email')} maxLength={120} autoComplete="off" aria-invalid={emailBad} />
        </Field>
        {emailBad && <p className="-mt-2 text-xs text-red-700">{t('admin.ministry.emailBad')}</p>}
        {!account && <Notice tone="info" className="text-xs">{t('admin.ministry.createNote')}</Notice>}
        {error && <p className="text-xs text-red-700" role="alert">{error}</p>}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  )
}

/** One question before disabling, enabling, a new password or unlinking the app; the API's error stays in the dialog. */
function ConfirmDialog({ ask, onClose, onConfirm }: { ask: Ask; onClose: () => void; onConfirm: (ask: Ask) => Promise<void> }) {
  const { t, lang } = useT()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const name = ask.account.name
  const text = { disable: 'admin.ministry.disableConfirm', enable: 'admin.ministry.enableConfirm', password: 'admin.ministry.resetPasswordConfirm', app: 'admin.ministry.resetAppConfirm' } as const
  const action = { disable: 'admin.ministry.disable', enable: 'admin.ministry.enable', password: 'admin.ministry.resetPassword', app: 'admin.ministry.resetApp' } as const
  const go = async () => {
    setBusy(true); setError(null)
    try { await onConfirm(ask) } catch (err) { setError(apiErrorText(err, lang)) } finally { setBusy(false) }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={t(action[ask.kind])}
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button variant={ask.kind === 'enable' ? 'primary' : 'danger'} disabled={busy} onClick={() => void go()}>{busy ? <Icon name="refresh" className="h-4 w-4 animate-spin" /> : null}{t(action[ask.kind])}</Button></div>}
    >
      <p className="text-sm leading-relaxed text-charcoal/80">{t(text[ask.kind], { name })}</p>
      {error && <p className="mt-3 text-xs text-red-700" role="alert">{error}</p>}
    </Modal>
  )
}

/** The temporary password, shown once: copy it, hand it over, close. */
function PasswordDialog({ shown, onClose }: { shown: Shown; onClose: () => void }) {
  const { t } = useT()
  const [copied, setCopied] = useState(false)
  const [handed, setHanded] = useState(false)
  // Closing (Esc, the cross, the backdrop) only after the Super Admin confirms the password was handed over.
  const close = useCallback(() => { if (handed) onClose() }, [handed, onClose])
  const copy = async () => {
    try { await navigator.clipboard.writeText(`${shown.account.login}\n${shown.password}`); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* the text stays on screen to copy by hand */ }
  }
  return (
    <Modal
      open
      onClose={close}
      title={shown.created ? t('admin.ministry.created') : t('admin.ministry.passwordTitle')}
      footer={<div className="flex justify-end"><Button disabled={!handed} onClick={onClose}>{t('mfa.continue')}</Button></div>}
    >
      <div className="space-y-4">
        <p className="text-sm text-charcoal/75">{shown.account.name}</p>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2 rounded-control border border-charcoal/12 bg-ivory/60 p-4 text-sm">
          <dt className="text-charcoal/55">{t('auth.login')}</dt><dd className="select-all font-mono text-charcoal">{shown.account.login}</dd>
          <dt className="text-charcoal/55">{t('admin.ministry.passwordTitle')}</dt><dd className="select-all break-all font-mono text-base tracking-wider text-charcoal">{shown.password}</dd>
        </dl>
        <Button type="button" size="sm" variant="secondary" onClick={() => void copy()}><Icon name={copied ? 'check' : 'file'} className="h-3.5 w-3.5" />{t(copied ? 'mfa.copied' : 'admin.ministry.copyBoth')}</Button>
        <Notice tone="warn" className="text-xs">{t('admin.ministry.passwordOnce')}</Notice>
        {!shown.account.appLinked && <p className="text-xs leading-relaxed text-charcoal/65">{t('admin.ministry.firstSignIn')}</p>}
        <label className="flex cursor-pointer items-start gap-3 text-[13px] text-charcoal/80">
          <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-forest" checked={handed} onChange={(e) => setHanded(e.target.checked)} />
          <span>{t('admin.ministry.passwordSaved')}</span>
        </label>
      </div>
    </Modal>
  )
}
