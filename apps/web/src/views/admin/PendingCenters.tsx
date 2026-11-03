'use client'
import { useCallback, useEffect, useState } from 'react'
import type { CenterStatus } from '@ilmora/shared'
import { Button, Card, Eyebrow, Icon, LinkButton } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { api, isApiError } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import { formatDate } from '../../lib/format'
import { Link } from '../../lib/router'
import { useStore } from '../../store/useStore'
import type { Center } from '../../types'

export type AdminCenterRow = Center & { status: CenterStatus; address: string | null; phone: string | null; blockReason: string | null; createdAt: string; counts: { courses: number; teachers: number; admins: number }; owner: { id: string; login: string | null; displayName: string } | null }

/** The Super Admin's center list with the status actions (approve, reject with a reason, block, unblock). */
export function useAdminCenters() {
  const { t, lang } = useT()
  const notify = useStore((s) => s.notify)
  const [list, setList] = useState<AdminCenterRow[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const reload = useCallback(() => api<AdminCenterRow[]>('/admin/centers').then(setList).catch((err) => notify(isApiError(err) ? apiErrorText(err, lang) : String(err), 'warn')), [notify, lang])
  useEffect(() => { void reload() }, [reload])
  const setStatus = async (c: AdminCenterRow, status: CenterStatus) => {
    let reason: string | undefined
    if (status === 'BLOCKED' || status === 'REJECTED') {
      const answer = prompt(t(status === 'REJECTED' ? 'admin.centers.rejectReason' : 'admin.centers.reason'))
      if (answer === null) return // the prompt was cancelled: nothing changes
      reason = answer.trim() || undefined
    }
    setBusy(c.id)
    try {
      await api(`/admin/centers/${c.id}/status`, { method: 'PATCH', body: { status, ...(reason ? { reason } : {}) } })
      notify(t('admin.centers.statusChanged'))
      await reload()
    } catch (err) { notify(isApiError(err) ? apiErrorText(err, lang) : String(err), 'warn') } finally { setBusy(null) }
  }
  return { list, busy, reload, setStatus }
}

export const centerStatusTone = (st: CenterStatus) => (st === 'ACTIVE' ? 'forest' : st === 'PENDING' ? 'champagne' : st === 'REJECTED' ? 'muted' : 'danger')

/** Registrations waiting for a decision, with approve and reject at hand; shown on the admin overview and the centers page. */
export function PendingCentersPanel({ list, busy, setStatus, linkToAll }: { list: AdminCenterRow[] | null; busy: string | null; setStatus: (c: AdminCenterRow, status: CenterStatus) => Promise<void>; linkToAll?: boolean }) {
  const { t, tr, lang } = useT()
  const pending = (list ?? []).filter((c) => c.status === 'PENDING')
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <Eyebrow>{t('admin.centers.requests')} · {pending.length}</Eyebrow>
        {linkToAll && <Link to="/admin/centers" className="text-xs font-medium text-forest underline">{t('admin.centers')}</Link>}
      </div>
      {list === null ? (
        <div className="py-6 text-center text-sm text-charcoal/55">{t('common.loading')}</div>
      ) : pending.length === 0 ? (
        <Card className="p-4 text-sm text-charcoal/55">{t('admin.centers.noRequests')}</Card>
      ) : (
        <ul className="space-y-2">
          {pending.map((c) => (
            <li key={c.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="h-10 w-1.5 shrink-0 rounded-full" style={{ background: c.tone }} />
                <div className="min-w-0 flex-1">
                  <Link to={`/admin/centers/${c.id}`} className="text-sm font-medium text-charcoal hover:text-forest">{c.name}</Link>
                  <div className="text-xs text-charcoal/55">{formatDate(c.createdAt, lang)}{tr(c.district) ? ` · ${tr(c.district)}` : ''}{c.owner ? ` · ${t('admin.centers.registeredBy', { name: c.owner.login ? `@${c.owner.login}` : c.owner.displayName })}` : ''}</div>
                </div>
                <Button size="sm" disabled={busy === c.id} onClick={() => void setStatus(c, 'ACTIVE')}><Icon name="check" className="h-3.5 w-3.5" />{t('admin.centers.approve')}</Button>
                <Button size="sm" variant="danger" disabled={busy === c.id} onClick={() => void setStatus(c, 'REJECTED')}><Icon name="x" className="h-3.5 w-3.5" />{t('admin.centers.reject')}</Button>
                <LinkButton size="sm" variant="ghost" to={`/admin/centers/${c.id}`}><Icon name="external" className="h-3.5 w-3.5" />{t('admin.centers.openDashboard')}</LinkButton>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
