'use client'
import { useCallback, useEffect, useState } from 'react'
import type { AppNotification } from '@ilmora/shared'
import { useT } from '../i18n/useT'
import { api } from '../lib/api'
import { formatDate, formatTime } from '../lib/format'
import { notificationHref, type DashboardRole } from '../lib/notificationLinks'
import { useNavigate } from '../lib/router'
import { useStore } from '../store/useStore'
import { notificationText } from './NotificationBell'
import { Button, cx, EmptyState, Icon, PageTitle, Tabs } from './ui'

const PAGE = 50

/**
 * Every notification of the signed-in account, newest first: an unread filter, "mark all read", older pages on demand,
 * and each item opens the page it is about (and is marked read on the way).
 */
export function NotificationsPage({ role, eyebrow }: { role: DashboardRole; eyebrow: string }) {
  const { t, tr, lang } = useT()
  const nav = useNavigate()
  const unread = useStore((s) => s.unreadCount)
  const markRead = useStore((s) => s.markNotificationsRead)
  const [items, setItems] = useState<AppNotification[] | null>(null)
  const [more, setMore] = useState(false)
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async (before?: string) => {
    const r = await api<{ items: AppNotification[]; unreadCount: number }>(`/notifications?limit=${PAGE}${before ? `&before=${encodeURIComponent(before)}` : ''}`)
    setItems((prev) => (before && prev ? [...prev, ...r.items] : r.items))
    setMore(r.items.length === PAGE)
  }, [])
  useEffect(() => { void load().catch(() => setItems([])) }, [load])

  const open = (n: AppNotification) => {
    if (!n.readAt) {
      const at = new Date().toISOString()
      setItems((prev) => prev?.map((x) => (x.id === n.id ? { ...x, readAt: at } : x)) ?? null)
      void markRead([n.id]).catch(() => undefined)
    }
    nav(notificationHref(n, role))
  }
  const markAll = async () => {
    setBusy(true)
    try {
      await markRead()
      const at = new Date().toISOString()
      setItems((prev) => prev?.map((x) => (x.readAt ? x : { ...x, readAt: at })) ?? null)
    } finally { setBusy(false) }
  }
  const shown = (items ?? []).filter((n) => filter === 'all' || !n.readAt)

  return (
    <div>
      <PageTitle eyebrow={eyebrow} title={t('notif.title')} subtitle={t('notif.pageHint')} action={unread > 0 ? <Button variant="secondary" disabled={busy} onClick={() => void markAll()}><Icon name="check" className="h-4 w-4" />{t('notif.markAll')}</Button> : undefined} />
      <Tabs tabs={[{ id: 'all', label: t('notif.filter.all') }, { id: 'unread', label: t('notif.filter.unread'), count: unread }]} value={filter} onChange={setFilter} className="mb-4" />
      {items === null ? (
        <div className="py-10 text-center text-sm text-charcoal/55">{t('common.loading')}</div>
      ) : shown.length === 0 ? (
        <EmptyState title={t('notif.empty')} />
      ) : (
        <ul className="space-y-2">
          {shown.map((n) => (
            <li key={n.id}>
              <button type="button" onClick={() => open(n)} className={cx('card flex w-full items-start gap-3 p-4 text-left transition hover:-translate-y-0.5 hover:shadow-md', !n.readAt && 'border-forest/30 bg-sage/30')}>
                <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.readAt ? 'bg-charcoal/15' : 'bg-forest')} aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm leading-relaxed text-charcoal">{notificationText(n, lang, t, tr)}</span>
                  <span className="mt-1 block text-[11px] text-charcoal/45">{formatDate(n.createdAt, lang)} · {formatTime(n.createdAt, lang)} · {t('common.open')}</span>
                </span>
                <Icon name="arrowRight" className="mt-1 h-4 w-4 shrink-0 text-charcoal/35" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {more && filter === 'all' && items && items.length > 0 && (
        <div className="mt-4 text-center"><Button variant="secondary" onClick={() => void load(items[items.length - 1].createdAt).catch(() => undefined)}>{t('notif.loadMore')}</Button></div>
      )}
    </div>
  )
}
