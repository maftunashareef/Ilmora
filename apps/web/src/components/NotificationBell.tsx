'use client'
import { useEffect, useRef, useState } from 'react'
import type { AppNotification, L, Lang, TKey } from '@ilmora/shared'
import { dict } from '@ilmora/shared'
import { useT } from '../i18n/useT'
import { formatDate, formatDayMonth, formatTime } from '../lib/format'
import { dashboardRole, notificationHref, notificationsPath } from '../lib/notificationLinks'
import { Link, useNavigate } from '../lib/router'
import { subscribeToNotifications } from '../services/notifications'
import { useStore } from '../store/useStore'
import { Button, cx, Icon } from './ui'

const isL = (v: unknown): v is L => !!v && typeof v === 'object' && 'uz' in (v as object) && 'ru' in (v as object) && 'en' in (v as object)
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T/

/** Text of a notification in the reader's language: `notif.<type>` with the stored params rendered (titles, dates, times). */
export function notificationText(n: Pick<AppNotification, 'type' | 'params'>, lang: Lang, t: (k: TKey, vars?: Record<string, string | number>) => string, tr: (l: L | undefined | null) => string): string {
  const key = `notif.${n.type}` as TKey
  if (!(key in dict)) return n.type
  const vars: Record<string, string | number> = {}
  for (const [k, v] of Object.entries(n.params ?? {})) {
    if (v == null) continue
    if (isL(v)) vars[k] = tr(v)
    else if (typeof v === 'number') vars[k] = v
    else if (typeof v === 'string' && ISO_DATE.test(v)) vars[k] = formatDayMonth(v, lang)
    else if (typeof v === 'string' && ISO_INSTANT.test(v)) vars[k] = k === 'time' ? formatTime(v, lang) : formatDate(v, lang)
    else if (typeof v === 'string') vars[k] = v
  }
  return t(key, vars)
}

/** Bell with the unread count; opens the latest notifications and marks them read. Live through the notifications stream. */
export function NotificationBell() {
  const { t, tr, lang } = useT()
  const status = useStore((s) => s.auth.status)
  const items = useStore((s) => s.notifications)
  const unread = useStore((s) => s.unreadCount)
  const load = useStore((s) => s.loadNotifications)
  const markRead = useStore((s) => s.markNotificationsRead)
  const role = dashboardRole(useStore((s) => s.role))
  const nav = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (status !== 'authenticated') return
    void load().catch(() => undefined)
    const stop = subscribeToNotifications(() => void load().catch(() => undefined))
    return stop
  }, [status, load])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  if (status !== 'authenticated') return null
  const toggle = () => {
    const next = !open
    setOpen(next)
    if (next) void load().catch(() => undefined)
  }

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={toggle} aria-expanded={open} aria-haspopup="dialog" aria-label={`${t('notif.title')}${unread ? ` · ${t('notif.unread', { n: unread })}` : ''}`} className="relative flex h-9 w-9 items-center justify-center rounded-full border border-charcoal/12 bg-paper text-charcoal/70 transition hover:border-forest/40 hover:text-forest">
        <Icon name="bell" className="h-4 w-4" />
        {unread > 0 && <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-champagne px-1 text-[10px] font-semibold text-charcoal">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div role="dialog" aria-label={t('notif.title')} className="animate-rise absolute right-0 z-[70] mt-2 w-[22rem] max-w-[calc(100vw-2rem)] rounded-card border border-charcoal/10 bg-paper shadow-lift">
          <div className="flex items-center justify-between border-b border-charcoal/10 px-4 py-3">
            <span className="text-sm font-medium text-charcoal">{t('notif.title')}</span>
            {unread > 0 && <Button size="sm" variant="ghost" onClick={() => void markRead().catch(() => undefined)}>{t('notif.markAll')}</Button>}
          </div>
          <ul className="max-h-[24rem] overflow-y-auto">
            {items.length === 0 && <li className="px-4 py-6 text-center text-xs text-charcoal/50">{t('notif.empty')}</li>}
            {items.map((n) => (
              <li key={n.id} className={cx('border-b border-charcoal/5 px-4 py-3 text-[13px] leading-relaxed', n.readAt ? 'text-charcoal/65' : 'bg-sage/30 text-charcoal')}>
                <button type="button" className="w-full text-left" onClick={() => { if (!n.readAt) void markRead([n.id]).catch(() => undefined); if (role) { setOpen(false); nav(notificationHref(n, role)) } }}>
                  {notificationText(n, lang, t, tr)}
                  <span className="mt-1 block text-[11px] text-charcoal/45">{formatDate(n.createdAt, lang)} · {formatTime(n.createdAt, lang)}</span>
                </button>
              </li>
            ))}
          </ul>
          {role && <div className="border-t border-charcoal/10 px-4 py-2.5 text-center"><Link to={notificationsPath(role)} onClick={() => setOpen(false)} className="text-xs font-medium text-forest underline">{t('notif.viewAll')}</Link></div>}
        </div>
      )}
    </div>
  )
}
