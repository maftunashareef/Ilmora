'use client'
import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, EmptyState, Icon, Input, Notice, PageTitle, Select } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { api, isApiError } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import { formatDate } from '../../lib/format'
import { useStore } from '../../store/useStore'

type Account = { id: string; login: string | null; phoneMasked: string | null; displayName: string; roles: string[]; centerId: string | null; isActive: boolean; subscription: { status: string } | null; createdAt: string; lastLoginAt: string | null }
type Page = { page: number; pageSize: number; total: number; items: Account[] }
const ROLES = ['', 'STUDENT', 'TEACHER', 'CENTER_ADMIN', 'FINANCE_ADMIN'] as const

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

  const load = useCallback(async (p = 1) => {
    const qs = new URLSearchParams({ page: String(p), pageSize: '50', ...(role ? { role } : {}), ...(query.trim() ? { search: query.trim() } : {}) })
    try { setPage(await api<Page>(`/admin/users?${qs.toString()}`)) } catch (err) { notify(isApiError(err) ? apiErrorText(err, lang) : String(err), 'warn') }
  }, [role, query, notify, lang])
  useEffect(() => { void load(1) }, [load])

  const act = async (id: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(id)
    try { await fn(); notify(done); await load(page?.page ?? 1) } catch (err) { notify(isApiError(err) ? apiErrorText(err, lang) : String(err), 'warn') } finally { setBusy(null) }
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
              {a.id !== me && !a.roles.includes('PLATFORM_ADMIN') && (
                <>
                  <Button size="sm" variant="secondary" disabled={busy === a.id} onClick={() => void toggleActive(a)}><Icon name={a.isActive ? 'lock' : 'check'} className="h-3.5 w-3.5" />{a.isActive ? t('admin.accounts.block') : t('admin.accounts.unblock')}</Button>
                  <Button size="sm" variant="danger" disabled={busy === a.id} onClick={() => void remove(a)}><Icon name="trash" className="h-3.5 w-3.5" /></Button>
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
    </div>
  )
}
