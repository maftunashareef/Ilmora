import Image from 'next/image'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from '@/lib/router'
import { useT } from '../../i18n/useT'
import { siteHref } from '../../lib/siteUrl'
import { useStore } from '../../store/useStore'
import type { Role } from '../../types'
import { NotificationBell } from '../NotificationBell'
import { cx, Icon } from '../ui'
import { LangSwitcher, RoleSwitcher } from './Switchers'

export interface DashNavItem { id: string; to: string; label: string; icon: string; end?: boolean }

export function DashboardShell({ title, subtitle, items, role, extra }: { title: string; subtitle?: string; items: DashNavItem[]; role: Role; extra?: ReactNode }) {
  const { t, lang } = useT()
  const site = useStore((s) => s.site)
  // The admin workspace may live on its own host; "back to the site" then has to leave it.
  const home = role === 'admin' ? siteHref(lang, '') || '/' : '/'
  const [open, setOpen] = useState(false)
  const loc = useLocation()
  useEffect(() => setOpen(false), [loc.pathname])

  const sidebar = (
    <nav aria-label={title} className="flex flex-1 flex-col gap-0.5">
      {items.map((it) => (
        <NavLink key={it.id} to={it.to} end={it.end} className={({ isActive }) => cx('flex items-center gap-3 rounded-control px-3 py-2.5 text-[13.5px] font-medium transition', isActive ? 'bg-forest text-ivory' : 'text-charcoal/70 hover:bg-sage hover:text-forest')}>
          <Icon name={it.icon} className="h-4 w-4 shrink-0" />
          <span className="truncate">{it.label}</span>
        </NavLink>
      ))}
    </nav>
  )

  return (
    <div className="flex min-h-screen bg-ivory">
      <a href="#dash-main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-control focus:bg-forest focus:px-4 focus:py-2 focus:text-ivory">{t('common.skipToContent')}</a>
      <aside className="hidden w-[264px] shrink-0 flex-col border-r border-charcoal/10 bg-paper/70 px-4 py-6 lg:flex">
        <Link
          to="/"
          className="mb-8 flex items-center rounded-control px-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2"
          aria-label={`${site.brand.name} — ${t('nav.home')}`}
        >
          <Image src="/brand/ilmora-logo-mark.png" alt={site.brand.name} width={925} height={432} sizes="104px" className="h-12 w-auto" />
        </Link>
        <div className="mb-4 px-2">
          <div className="eyebrow">{title}</div>
          {subtitle && <div className="mt-1 truncate text-sm text-charcoal/70">{subtitle}</div>}
        </div>
        {sidebar}
        {extra && <div className="mt-4">{extra}</div>}
        <div className="mt-6 border-t border-charcoal/10 pt-4">
          <a href={home} className="flex items-center gap-2 px-2 text-xs text-charcoal/55 hover:text-forest"><Icon name="arrowLeft" className="h-3.5 w-3.5" />{t('nav.backToSite')}</a>
          <p className="mt-3 px-2 text-[11px] leading-relaxed text-charcoal/40">{t('dash.demoNotice')}</p>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex h-[60px] items-center justify-between gap-3 border-b border-charcoal/10 bg-ivory/85 px-4 backdrop-blur-md md:px-8">
          <div className="flex items-center gap-3 lg:hidden">
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={t('nav.menu')} className="rounded-control p-2 text-charcoal"><Icon name={open ? 'x' : 'menu'} className="h-5 w-5" /></button>
            <span className="font-display text-lg text-charcoal">{title}</span>
          </div>
          <div className="hidden text-sm text-charcoal/55 lg:block">{t('role.viewingAs')} <span className="font-medium text-charcoal">{t(`role.${role}`)}</span></div>
          <div className="flex items-center gap-2">
            <div className="hidden sm:block"><LangSwitcher compact /></div>
            <NotificationBell />
            <RoleSwitcher />
          </div>
        </header>
        {open && (
          <div className="animate-fade border-b border-charcoal/10 bg-paper px-4 py-4 lg:hidden">
            {sidebar}
            {extra && <div className="mt-3">{extra}</div>}
            <div className="mt-3 flex items-center justify-between"><a href={home} className="text-xs text-charcoal/60">{t('nav.backToSite')}</a><LangSwitcher compact /></div>
          </div>
        )}
        <main id="dash-main" className="flex-1 px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto w-full max-w-6xl animate-fade">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
