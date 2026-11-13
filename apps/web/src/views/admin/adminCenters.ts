'use client'
import { useCallback, useEffect, useState } from 'react'
import type { CenterStatus } from '@ilmora/shared'
import { useT } from '../../i18n/useT'
import { api, isApiError } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import { useStore } from '../../store/useStore'
import type { Center } from '../../types'

export type AdminCenterRow = Center & { status: CenterStatus; address: string | null; phone: string | null; blockReason: string | null; pendingName?: string | null; createdAt: string; counts: { courses: number; teachers: number; admins: number }; owner: { id: string; login: string | null; displayName: string } | null }

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
  /** A new name an approved center asked for: applied or discarded by the Super Admin. */
  const reviewName = async (c: AdminCenterRow, approve: boolean) => {
    setBusy(c.id)
    try {
      await api(`/admin/centers/${c.id}/name`, { method: 'POST', body: { approve } })
      notify(t('admin.centers.statusChanged'))
      await reload()
    } catch (err) { notify(isApiError(err) ? apiErrorText(err, lang) : String(err), 'warn') } finally { setBusy(null) }
  }
  return { list, busy, reload, setStatus, reviewName }
}

export const centerStatusTone = (st: CenterStatus) => (st === 'ACTIVE' ? 'forest' : st === 'PENDING' ? 'champagne' : st === 'REJECTED' ? 'muted' : 'danger')
