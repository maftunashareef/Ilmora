import { OPERATOR } from '@ilmora/shared'
import Image from 'next/image'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from '@/lib/router'
import { useT } from '../../i18n/useT'
import { useStore } from '../../store/useStore'
import { cx, Icon } from '../ui'
import { LangSwitcher, RoleSwitcher } from './Switchers'

const WORKSPACE = { student: '/student', teacher: '/teacher', admin: '/admin' } as const

export function PublicShell() {
  const { t, tr } = useT()
  const site = useStore((s) => s.site)
  const role = useStore((s) => s.role)
  const [open, setOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const loc = useLocation()
  useEffect(() => setOpen(false), [loc.pathname])
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }) }, [loc.pathname])
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])
  const nav = site.nav.filter((n) => n.enabled)
  const ws = role !== 'visitor' ? WORKSPACE[role] : null
  // On the home page the header floats transparently over the hero film until the user scrolls.
  const isHome = loc.pathname === '/' && site.pages.home.some((s) => s.type === 'hero' && s.enabled)
  const overlay = isHome && !scrolled && !open

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-control focus:bg-forest focus:px-4 focus:py-2 focus:text-ivory">Skip to content</a>
      <div className="relative z-[60] border-b border-charcoal/10 bg-forest text-ivory/90">
        <div className="container-x flex items-center justify-between gap-4 py-1.5 text-[11px] tracking-wide">
          <span className="truncate">{t('home.demoBanner')}</span>
          <span className="hidden sm:inline text-ivory/60">{tr(site.brand.city)}</span>
        </div>
      </div>
      <header
        className={cx(
          'sticky top-0 z-50 border-b transition-[background-color,border-color,box-shadow] duration-500',
          overlay ? 'border-transparent bg-transparent' : 'border-charcoal/10 bg-ivory/85 backdrop-blur-md',
          scrolled && !overlay && 'shadow-[0_10px_30px_-24px_rgba(22,60,53,0.35)]',
          isHome && '-mb-[68px]',
        )}
      >
        <div className="container-x flex h-[68px] items-center justify-between gap-6">
          <Link
            to="/"
            className="relative flex h-11 items-center rounded-control focus:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2 sm:h-[52px]"
            aria-label={`${site.brand.name} — ${t('nav.home')}`}
          >
            {/* Transparent logo: green/gold strokes on the light header, ivory/gold strokes over the dark hero (cross-faded, no card). */}
            <Image src="/brand/ilmora-logo-mark.png" alt={site.brand.name} width={925} height={432} priority sizes="(min-width: 640px) 112px, 96px" className={cx('h-11 w-auto transition-opacity duration-500 sm:h-[52px]', overlay ? 'opacity-0' : 'opacity-100')} />
            <Image src="/brand/ilmora-logo-mark-light.png" alt="" aria-hidden width={925} height={432} priority sizes="(min-width: 640px) 112px, 96px" className={cx('absolute inset-y-0 left-0 h-11 w-auto transition-opacity duration-500 sm:h-[52px]', overlay ? 'opacity-100' : 'opacity-0')} />
          </Link>
          <nav className="hidden items-center gap-1.5 lg:flex" aria-label="Primary">
            {nav.map((n) => (
              <NavLink
                key={n.id}
                to={n.path}
                className={({ isActive }) =>
                  cx(
                    'whitespace-nowrap rounded-control px-3.5 py-2 text-[13px] font-medium transition-colors duration-300',
                    overlay ? (isActive ? 'text-champagne' : 'text-ivory/80 hover:text-ivory') : isActive ? 'text-forest font-semibold' : 'text-charcoal/70 hover:text-charcoal'
                  )
                }
              >
                {tr(n.label)}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2.5">
            <div className="hidden md:block"><LangSwitcher /></div>
            <RoleSwitcher />
            {ws ? (
              <Link to={ws} className={cx('hidden items-center gap-1.5 whitespace-nowrap rounded-control px-4 py-2 text-xs font-medium transition-all duration-200 md:inline-flex lg:hidden xl:inline-flex', overlay ? 'bg-ivory/15 text-ivory ring-1 ring-ivory/30 hover:bg-ivory/25' : 'bg-forest text-ivory hover:bg-forest/90')}>
                {t('nav.myWorkspace')} <Icon name="arrowRight" className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <Link to="/builder" className={cx('hidden items-center gap-1.5 whitespace-nowrap rounded-control px-4 py-2 text-xs font-semibold shadow-sm transition-all duration-200 md:inline-flex', overlay ? 'bg-champagne text-forest hover:bg-champagne/90' : 'bg-forest text-ivory hover:bg-forest/90')}>
                {tr(site.brand.primaryCta)} <Icon name="arrowRight" className="h-4 w-4" />
              </Link>
            )}
            <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={t('nav.menu')} className={cx('rounded-control p-2 transition-colors lg:hidden', overlay ? 'text-ivory hover:bg-white/10' : 'text-charcoal hover:bg-sage/50')}>
              <Icon name={open ? 'x' : 'menu'} className="h-5 w-5" />
            </button>
          </div>
        </div>
        {open && (
          <div className="animate-fade border-t border-charcoal/10 bg-ivory/95 backdrop-blur-lg lg:hidden">
            <div className="container-x flex flex-col gap-1.5 py-4">
              {nav.map((n) => (
                <NavLink key={n.id} to={n.path} className={({ isActive }) => cx('rounded-control px-3.5 py-2.5 text-[15px] font-medium transition-colors', isActive ? 'bg-sage text-forest font-semibold' : 'text-charcoal/80 hover:bg-paper')}>
                  {tr(n.label)}
                </NavLink>
              ))}
              {ws ? (
                <Link to={ws} className="mt-2 rounded-control bg-forest px-4 py-2.5 text-center text-sm font-medium text-ivory shadow-sm">{t('nav.myWorkspace')}</Link>
              ) : (
                <Link to="/builder" className="mt-2 rounded-control bg-forest px-4 py-2.5 text-center text-sm font-semibold text-ivory shadow-sm">{tr(site.brand.primaryCta)}</Link>
              )}
              <div className="mt-3 flex items-center justify-between pt-2 border-t border-charcoal/10"><span className="text-xs font-medium text-charcoal/60">{t('common.language')}</span><LangSwitcher /></div>
            </div>
          </div>
        )}
      </header>
      <main id="main" key={loc.pathname} className="page-in flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-charcoal/10 bg-sage/50">
        <div className="container-x grid gap-10 py-14 md:grid-cols-2 lg:grid-cols-[1.3fr_0.8fr_1fr_1fr]">
          <div className="reveal">
            <div className="font-display text-2xl tracking-[0.12em] text-charcoal">{site.brand.name}</div>
            <p className="mt-3 max-w-md text-[13px] leading-relaxed text-charcoal/60">{tr(site.brand.footerNote)}</p>
          </div>
          <div className="reveal">
            <div className="eyebrow mb-3">{t('nav.menu')}</div>
            <ul className="space-y-2 text-sm">
              {nav.map((n) => <li key={n.id}><Link to={n.path} className="text-charcoal/70 hover:text-forest">{tr(n.label)}</Link></li>)}
            </ul>
          </div>
          <div className="reveal">
            <div className="eyebrow mb-3">{t('footer.contacts')}</div>
            <ul className="space-y-2 text-sm text-charcoal/70">
              <li><a href={`tel:${OPERATOR.phone.replace(/\s/g, '')}`} className="hover:text-forest">{OPERATOR.phone}</a></li>
              <li><a href={`mailto:${OPERATOR.email}`} className="hover:text-forest">{OPERATOR.email}</a></li>
              <li className="text-charcoal/60">{tr(OPERATOR.address)}</li>
            </ul>
          </div>
          <div className="reveal">
            <div className="eyebrow mb-3">{t('footer.legal')}</div>
            <ul className="space-y-2 text-sm text-charcoal/70">
              <li><Link to="/oferta" className="hover:text-forest">{t('legal.offer')}</Link></li>
              <li><Link to="/privacy" className="hover:text-forest">{t('legal.privacy')}</Link></li>
            </ul>
            {role !== 'visitor' && (
              <>
                <div className="eyebrow mb-3 mt-6">{t('footer.workspaces')}</div>
                <ul className="space-y-2 text-sm text-charcoal/70">
                  {role === 'admin' && <li><Link to="/admin" className="hover:text-forest">{t('role.admin')}</Link></li>}
                  {(role === 'admin' || role === 'teacher') && <li><Link to="/teacher" className="hover:text-forest">{t('dash.teacherStudio')}</Link></li>}
                  <li><Link to="/student" className="hover:text-forest">{t('dash.studentSpace')}</Link></li>
                </ul>
              </>
            )}
            <p className="mt-4 text-[11px] leading-relaxed text-charcoal/45">{t('access.securityNote')}</p>
          </div>
        </div>
        <div className="border-t border-charcoal/10">
          <div className="container-x flex flex-wrap items-center justify-between gap-2 py-4 text-[11px] text-charcoal/45">
            <span>© 2026 {site.brand.name} · {OPERATOR.brandOwner}</span>
            <span>{tr(site.brand.city)}</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
