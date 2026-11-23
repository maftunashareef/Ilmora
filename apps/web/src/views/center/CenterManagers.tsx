'use client'
import { useCallback, useEffect, useState } from 'react'
import { Badge, Button, Card, Eyebrow, Field, Icon, Input, Notice } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { api, isApiError } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import { formatDate } from '../../lib/format'
import { useStore } from '../../store/useStore'
import { useCenterScope } from './centerApi'

interface Manager { id: string; login: string; name: string; active: boolean; passwordToChange: boolean; lastLoginAt: string | null; createdAt: string }
interface Issued { manager: Manager; temporaryPassword: string }

/**
 * Managers of the center (проверка 19.11, №15; Тимур, 23.11): the students' table, invitations, Excel, reading groups and
 * the journal. The administrator creates a separate account — a login and a temporary password shown once, changed at
 * the first sign-in (Шерзод, 23.11: only new accounts). The Super Admin sees the same card on the center's page.
 */
export function CenterManagersCard({ disabled }: { disabled?: boolean }) {
  const { t, lang } = useT()
  const scope = useCenterScope()
  const notify = useStore((s) => s.notify)
  const [items, setItems] = useState<Manager[] | null>(null)
  const [max, setMax] = useState(10)
  const [login, setLogin] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [issued, setIssued] = useState<Issued | null>(null)
  const fail = useCallback((err: unknown) => notify(isApiError(err) ? apiErrorText(err, lang) : String(err), 'warn'), [notify, lang])
  const fetchList = useCallback(() => api<{ items: Manager[]; max: number }>(`${scope.base}/managers`), [scope.base])
  const load = useCallback(async () => {
    try {
      const r = await fetchList()
      setItems(r.items)
      setMax(r.max)
    } catch (err) { fail(err) }
  }, [fetchList, fail])
  useEffect(() => {
    let live = true
    fetchList().then((r) => { if (live) { setItems(r.items); setMax(r.max) } }, (err: unknown) => { if (live) fail(err) })
    return () => { live = false }
  }, [fetchList, fail])

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true)
    try { await fn(); await load() } catch (err) { fail(err) } finally { setBusy(false) }
  }
  const create = () => run(async () => {
    const r = await api<Issued>(`${scope.base}/managers`, { method: 'POST', body: { login: login.trim(), name: name.trim() } })
    setIssued(r)
    setLogin('')
    setName('')
  })
  const reset = (m: Manager) => { if (confirm(t('mgr.resetConfirm', { name: m.name }))) void run(async () => setIssued(await api<Issued>(`${scope.base}/managers/${m.id}/reset-password`, { method: 'POST' }))) }
  const toggle = (m: Manager) => { if (!m.active || confirm(t('mgr.disableConfirm', { name: m.name }))) void run(() => api(`${scope.base}/managers/${m.id}/${m.active ? 'disable' : 'enable'}`, { method: 'POST' })) }
  const full = !!items && items.length >= max

  return (
    <Card className="space-y-4 p-6">
      <Eyebrow>{t('mgr.title')}</Eyebrow>
      <p className="text-xs text-charcoal/60">{t('mgr.hint')}</p>
      {issued && (
        <Notice tone="info" className="space-y-1 text-[12px]">
          <div className="font-medium">{t('mgr.issued', { name: issued.manager.name })}</div>
          <div>{t('mgr.login')}: <code className="select-all">{issued.manager.login}</code></div>
          <div>{t('mgr.password')}: <code className="select-all">{issued.temporaryPassword}</code></div>
          <div className="text-charcoal/60">{t('mgr.issuedHint')}</div>
          <Button size="sm" variant="ghost" onClick={() => setIssued(null)}>{t('common.close')}</Button>
        </Notice>
      )}
      {items === null ? <div className="text-xs text-charcoal/55">{t('common.loading')}</div> : items.length === 0 ? <div className="text-xs text-charcoal/55">{t('mgr.none')}</div> : (
        <ul className="divide-y divide-charcoal/10">
          {items.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-sm font-medium text-charcoal">{m.name}{!m.active && <Badge tone="muted">{t('mgr.off')}</Badge>}{m.active && m.passwordToChange && <Badge tone="warn">{t('mgr.passwordToChange')}</Badge>}</div>
                <div className="text-xs text-charcoal/55">{m.login} · {m.lastLoginAt ? t('mgr.lastLogin', { date: formatDate(m.lastLoginAt, lang) }) : t('mgr.neverLogged')}</div>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="secondary" disabled={busy || disabled || !m.active} onClick={() => reset(m)}><Icon name="refresh" className="h-3.5 w-3.5" />{t('mgr.reset')}</Button>
                <Button size="sm" variant={m.active ? 'danger' : 'secondary'} disabled={busy || disabled} onClick={() => toggle(m)}>{m.active ? t('mgr.disable') : t('mgr.enable')}</Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t('mgr.name')}><Input disabled={busy || disabled || full} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label={t('mgr.login')} hint={t('mgr.loginHint')}><Input disabled={busy || disabled || full} maxLength={32} autoComplete="off" value={login} onChange={(e) => setLogin(e.target.value)} /></Field>
      </div>
      {full && <p className="text-xs text-charcoal/60">{t('mgr.full', { max })}</p>}
      <div className="flex justify-end"><Button disabled={busy || disabled || full || name.trim().length < 2 || login.trim().length < 3} onClick={() => void create()}><Icon name="plus" className="h-4 w-4" />{t('mgr.create')}</Button></div>
    </Card>
  )
}
