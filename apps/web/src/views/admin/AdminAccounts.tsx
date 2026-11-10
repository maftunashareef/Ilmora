'use client'
import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, EmptyState, Field, Icon, Input, Modal, Notice, PageTitle, Select } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { api, isApiError } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import { formatDate } from '../../lib/format'
import { ministryAccounts } from '../../services/ministryAccounts'
import { useStore } from '../../store/useStore'

type Account = { id: string; login: string | null; phoneMasked: string | null; displayName: string; roles: string[]; centerId: string | null; isActive: boolean; subscription: { status: string } | null; createdAt: string; lastLoginAt: string | null }
type Page = { page: number; pageSize: number; total: number; items: Account[] }
const ROLES = ['', 'STUDENT', 'TEACHER', 'CENTER_ADMIN', 'FINANCE_ADMIN'] as const
/** Every role the Super Admin may grant; PLATFORM_ADMIN is owner-only (owner-setup on the server). */
const ASSIGNABLE = ['STUDENT', 'TEACHER', 'CENTER_ADMIN', 'FINANCE_ADMIN', 'PLATFORM_ADMIN'] as const
type AssignableRole = (typeof ASSIGNABLE)[number]

/** Super Admin: every account on the platform with search, blocking and deletion (live API, not the demo people list). */
export function AdminAccounts() {
  const { t, lang } = useT()
  const notify = useStore((s) => s.notify)
  const centers = useStore((s) => s.centers)
  const me = useStore((s) => s.auth.user?.id)
  const [query, setQuery] = useState('')
  const [role, setRole] = useState<(typeof ROLES)[number]>('')
  const [page, setPage] = useState<Page | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [editing, setEditing] = useState<Account | null>(null)

  const load = useCallback(async (p = 1) => {
    const qs = new URLSearchParams({ page: String(p), pageSize: '50', ...(role ? { role } : {}), ...(query.trim() ? { search: query.trim() } : {}) })
    try { setPage(await api<Page>(`/admin/users?${qs.toString()}`)) } catch (err) { notify(isApiError(err) ? apiErrorText(err, lang) : String(err), 'warn') }
  }, [role, query, notify, lang])
  useEffect(() => { void load(1) }, [load])

  /** Runs an admin action; resolves true when it succeeded (errors are shown as a toast). */
  const act = async (id: string, fn: () => Promise<unknown>, done: string): Promise<boolean> => {
    setBusy(id)
    try { await fn(); notify(done); await load(page?.page ?? 1); return true } catch (err) { notify(isApiError(err) ? apiErrorText(err, lang) : String(err), 'warn'); return false } finally { setBusy(null) }
  }
  const toggleActive = (a: Account) => {
    const roles = a.roles.filter((r) => r !== 'PLATFORM_ADMIN')
    return act(a.id, () => api(`/admin/users/${a.id}/roles`, { method: 'PUT', body: { roles: roles.length ? roles : ['STUDENT'], isActive: !a.isActive, reason: a.isActive ? 'Blocked by the Super Admin' : 'Unblocked by the Super Admin' } }), t('common.saved'))
  }
  const remove = (a: Account) => {
    if (!confirm(t('admin.accounts.confirmDelete'))) return
    const reason = prompt(t('admin.accounts.deleteReason'))?.trim()
    if (!reason || reason.length < 3) return
    return act(a.id, () => api(`/admin/users/${a.id}`, { method: 'DELETE', body: { reason } }), t('admin.accounts.deleted'))
  }
  /** Lost phone of another Super Admin: unlink the authenticator app (the API refuses one's own). */
  const resetApp = (a: Account) => {
    if (!confirm(t('admin.ministry.resetAppConfirm', { name: a.displayName }))) return
    return act(a.id, () => ministryAccounts.resetApp(a.id), t('admin.ministry.appReset'))
  }
  const roleLabel = (r: string) => (r === 'STUDENT' ? t('role.student') : r === 'TEACHER' ? t('role.teacher') : r === 'CENTER_ADMIN' ? t('role.center') : r === 'FINANCE_ADMIN' ? t('finance.title') : r === 'PLATFORM_ADMIN' ? t('role.admin') : r)

  return (
    <div>
      <PageTitle eyebrow={t('dash.admin')} title={t('admin.accounts')} subtitle={t('admin.accounts.hint')} />
      <form className="mb-4 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void load(1) }}>
        <Input className="min-w-[16rem] flex-1" aria-label={t('admin.accounts.search')} placeholder={t('admin.accounts.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
        <Select aria-label={t('common.status')} value={role} onChange={(e) => setRole(e.target.value as (typeof ROLES)[number])}>{ROLES.map((r) => <option key={r} value={r}>{r ? roleLabel(r) : t('common.all')}</option>)}</Select>
        <Button type="submit" variant="secondary"><Icon name="search" className="h-4 w-4" />{t('common.search')}</Button>
      </form>
      {page && page.items.length === 0 && <EmptyState title={t('admin.accounts.noResults')} />}
      {page && page.items.length > 0 && (
        <ul className="space-y-2">
          {page.items.map((a) => (
            <li key={a.id} className="card flex flex-wrap items-center gap-3 p-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-sage text-forest"><Icon name="user" className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-medium text-charcoal">{a.displayName}</span>{a.roles.map((r) => <Badge key={r} tone={r === 'PLATFORM_ADMIN' ? 'champagne' : 'neutral'}>{roleLabel(r)}</Badge>)}{!a.isActive && <Badge tone="danger">{t('admin.accounts.blocked')}</Badge>}</div>
                <div className="truncate text-xs text-charcoal/55">{[a.login ? `@${a.login}` : null, a.phoneMasked, a.centerId ? centers.find((c) => c.id === a.centerId)?.name ?? a.centerId : null, `${t('group.since')} ${formatDate(a.createdAt, lang)}`].filter(Boolean).join(' · ')}</div>
              </div>
              {a.id !== me && (
                <>
                  <Button size="sm" variant="secondary" disabled={busy === a.id} onClick={() => setEditing(a)}><Icon name="user" className="h-3.5 w-3.5" />{t('admin.accounts.roles')}</Button>
                  {a.roles.includes('PLATFORM_ADMIN') && <Button size="sm" variant="secondary" disabled={busy === a.id} onClick={() => void resetApp(a)}><Icon name="refresh" className="h-3.5 w-3.5" />{t('admin.ministry.resetApp')}</Button>}
                  {/* Block and delete stay off Super Admin accounts; change them through the Roles dialog instead. */}
                  {!a.roles.includes('PLATFORM_ADMIN') && (
                    <>
                      <Button size="sm" variant="secondary" disabled={busy === a.id} onClick={() => void toggleActive(a)}><Icon name={a.isActive ? 'lock' : 'check'} className="h-3.5 w-3.5" />{a.isActive ? t('admin.accounts.block') : t('admin.accounts.unblock')}</Button>
                      <Button size="sm" variant="danger" disabled={busy === a.id} onClick={() => void remove(a)} aria-label={t('common.delete')}><Icon name="trash" className="h-3.5 w-3.5" /></Button>
                    </>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {page && page.total > page.pageSize && (
        <div className="mt-4 flex items-center justify-between text-xs text-charcoal/55">
          <span>{page.total}</span>
          <div className="flex gap-2"><Button size="sm" variant="ghost" disabled={page.page <= 1} onClick={() => void load(page.page - 1)}>{t('common.back')}</Button><Button size="sm" variant="ghost" disabled={page.page * page.pageSize >= page.total} onClick={() => void load(page.page + 1)}>{t('common.next')}</Button></div>
        </div>
      )}
      <Notice tone="info" className="mt-6 text-xs">{t('admin.accounts.ownerProtected')}</Notice>
      {editing && (
        <RolesEditor
          account={editing}
          centers={centers}
          roleLabel={roleLabel}
          onClose={() => setEditing(null)}
          onSave={(body) => act(editing.id, () => api(`/admin/users/${editing.id}/roles`, { method: 'PUT', body }), t('admin.accounts.rolesSaved')).then((ok) => { if (ok) setEditing(null) })}
        />
      )}
    </div>
  )
}

type RolesBody = { roles: AssignableRole[]; centerId: string | null; reason: string }

/** Checkbox editor for one account's roles; a center administrator must be tied to a center. */
function RolesEditor({ account, centers, roleLabel, onClose, onSave }: { account: Account; centers: { id: string; name: string }[]; roleLabel: (r: string) => string; onClose: () => void; onSave: (body: RolesBody) => Promise<void> }) {
  const { t } = useT()
  const [roles, setRoles] = useState<AssignableRole[]>(() => account.roles.filter((r): r is AssignableRole => (ASSIGNABLE as readonly string[]).includes(r)))
  const [centerId, setCenterId] = useState<string>(account.centerId ?? '')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const toggle = (r: AssignableRole) => setRoles((cur) => (cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r]))
  const needsCenter = roles.includes('CENTER_ADMIN')
  const problem = roles.length === 0 ? t('admin.accounts.noRoles') : needsCenter && !centerId ? t('admin.accounts.centerRequired') : null
  const canSave = !problem && reason.trim().length >= 3 && !saving
  const save = async () => {
    if (!canSave) return
    setSaving(true)
    // Keep the order stable so the audit log shows the same list for the same set of roles.
    try { await onSave({ roles: ASSIGNABLE.filter((r) => roles.includes(r)), centerId: centerId || null, reason: reason.trim() }) } finally { setSaving(false) }
  }
  return (
    <Modal
      open
      onClose={onClose}
      title={`${t('admin.accounts.rolesTitle')} · ${account.displayName}`}
      footer={<div className="flex justify-end gap-2"><Button variant="ghost" onClick={onClose}>{t('common.cancel')}</Button><Button disabled={!canSave} onClick={() => void save()}>{t('common.save')}</Button></div>}
    >
      <div className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="mb-2 text-sm font-medium text-charcoal">{t('admin.accounts.roles')}</legend>
          {ASSIGNABLE.map((r) => (
            <label key={r} className="flex cursor-pointer items-start gap-3 rounded-control border border-charcoal/10 bg-paper px-3 py-2.5 hover:border-forest/40">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-forest" checked={roles.includes(r)} onChange={() => toggle(r)} />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-charcoal">{roleLabel(r)}</span>
                <span className="block text-xs text-charcoal/55">{t(`admin.accounts.role.${r}`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
        {roles.includes('PLATFORM_ADMIN') && <Notice tone="warn" className="text-xs">{t('admin.accounts.superAdminWarn')}</Notice>}
        {(needsCenter || centerId) && (
          <Field label={t('admin.accounts.center')} required={needsCenter}>
            <Select value={centerId} onChange={(e) => setCenterId(e.target.value)}>
              <option value="">{t('admin.accounts.noCenter')}</option>
              {centers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
        )}
        <Field label={t('admin.accounts.roleReason')} required>
          <Input value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {problem && <Notice tone="warn" className="text-xs">{problem}</Notice>}
        <Notice tone="info" className="text-xs">{t('admin.accounts.rolesHint')}</Notice>
      </div>
    </Modal>
  )
}
