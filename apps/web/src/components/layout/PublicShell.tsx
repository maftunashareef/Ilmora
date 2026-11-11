import { OPERATOR } from '@ilmora/shared'
import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from '@/lib/router'
import { useT } from '../../i18n/useT'
import { useCanSaveCourses, useHydrated } from '../../store/selectors'
import { useStore } from '../../store/useStore'
import { cx, Icon } from '../ui'
import { LangSwitcher, RoleSwitcher } from './Switchers'

const WORKSPACE = { student: '/student', teacher: '/teacher', center: '/center', admin: '/admin', ministry: '/ministry', institution: '/institution' } as const

/** Saved courses and the cart, side by side. Counts appear after mount because visitors' lists live in localStorage. */
function HeaderShortcuts({ overlay }: { overlay: boolean }) {
  const { t } = useT()
  const hydrated = useHydrated()
  const canSave = useCanSaveCourses()
  const role = useStore((s) => s.role)
  const savedCount = useStore((s) => s.students.find((x) => x.id === s.currentStudentId)?.savedCourseIds.length ?? 0)
  const cartCount = useStore((s) => s.students.find((x) => x.id === s.currentStudentId)?.builder.groupIds.length ?? 0)
  const items = [
    ...(canSave ? [{ to: '/favorites', icon: 'bookmark', label: t('nav.favorites'), count: savedCount }] : []),
    ...(role === 'visitor' || role === 'student' ? [{ to: '/builder', icon: 'cart', label: t('nav.cart'), count: cartCount }] : []),
  ]
  return (
    <>
      {items.map((i) => {
        const count = hydrated ? i.count : 0
        return (
          <Link
            key={i.to}
            to={i.to}
            aria-label={count > 0 ? `${i.label} (${count})` : i.label}
            title={i.label}
            className={cx('relative inline-flex h-9 w-9 items-center justify-center rounded-control transition-colors', overlay ? 'text-ivory hover:bg-white/10' : 'text-charcoal hover:bg-sage')}
          >
            <Icon name={i.icon} className="h-[18px] w-[18px]" />
            {count > 0 && <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-champagne px-1 text-[10px] font-bold leading-none text-forest">{count}</span>}
          </Link>
        )
      })}
    </>
  )
}

/** Small line icons for the footer contact list (decorative; the text next to each says what it is). */
function ContactIcon({ kind }: { kind: 'pin' | 'phone' | 'mail' }) {
  const paths = {
    pin: <><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.4" /></>,
    phone: <path d="M6.6 3.5h2.6l1.3 4-2 1.3a12 12 0 0 0 6.7 6.7l1.3-2 4 1.3v2.6a2 2 0 0 1-2.2 2A17 17 0 0 1 4.6 5.7a2 2 0 0 1 2-2.2z" />,
    mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="m4 7 8 6 8-6" /></>,
  }
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 h-4 w-4 shrink-0 text-forest" aria-hidden="true">{paths[kind]}</svg>
}

/** full: the whole menu with the account name; avatar: the whole menu, account shown as its avatar only; compact: menu button. */
type MenuMode = 'full' | 'avatar' | 'compact'

/**
 * Whether the full menu fits on one row beside the logo and the controls on the right. Its labels are set by the admin and
 * differ by language, so this is measured rather than assumed. The signed-in account name gives way first (only the avatar
 * shows); if the menu still does not fit, the header keeps the menu button it uses on smaller screens instead of running
 * past the edge.
 */
function useMenuFits() {
  const row = useRef<HTMLDivElement>(null)
  const probe = useRef<HTMLDivElement>(null)
  const nameProbe = useRef<HTMLSpanElement>(null)
  const right = useRef<HTMLDivElement>(null)
  const [mode, setMode] = useState<MenuMode>('full')
  useEffect(() => {
    const r = row.current, p = probe.current, n = nameProbe.current, c = right.current
    const logo = r?.firstElementChild
    if (!r || !p || !n || !c || !logo) return
    const gap = (e: Element) => parseFloat(getComputedStyle(e).columnGap) || 0
    const check = () => {
      const cs = getComputedStyle(r)
      const space = r.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)
      // Controls that stay when the full menu shows; the call-to-action and the menu button give way to it.
      const kept = [...c.children].filter((e) => !(e as HTMLElement).dataset.compactOnly && getComputedStyle(e).display !== 'none')
      const controls = kept.reduce((w, e) => w + e.getBoundingClientRect().width, 0) + Math.max(0, kept.length - 1) * gap(c)
      // The account name, measured whether or not it is shown right now, so the choice does not flip back and forth.
      const name = c.querySelector<HTMLElement>('[data-account-name]')
      const nameGap = name?.parentElement ? gap(name.parentElement) : 0
      const shownName = name && getComputedStyle(name).display !== 'none' ? name.getBoundingClientRect().width + nameGap : 0
      const fullName = name ? Math.min(n.scrollWidth, parseFloat(getComputedStyle(name).maxWidth) || Infinity) + nameGap : 0
      const withoutName = logo.getBoundingClientRect().width + p.scrollWidth + controls - shownName + 2 * gap(r)
      setMode(withoutName + fullName <= space ? 'full' : withoutName <= space ? 'avatar' : 'compact')
    }
    check()
    const ro = new ResizeObserver(check)
    for (const e of [r, p, n, c, logo]) ro.observe(e)
    void document.fonts?.ready.then(check)
    return () => ro.disconnect()
  }, [])
  return { fits: mode !== 'compact', showName: mode === 'full', row, probe, nameProbe, right }
}

export function PublicShell() {
  const { t, tr } = useT()
  const { fits, showName, row, probe, nameProbe, right } = useMenuFits()
  const accountName = useStore((s) => (s.auth.status === 'authenticated' ? s.auth.user?.displayName ?? '' : ''))
  const site = useStore((s) => s.site)
  const role = useStore((s) => s.role)
  const isCenterAdmin = useStore((s) => s.auth.user?.roles.includes('CENTER_ADMIN') ?? false)
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
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100] focus:rounded-control focus:bg-forest focus:px-4 focus:py-2 focus:text-ivory">{t('common.skipToContent')}</a>
      <header
        className={cx(
          'sticky top-0 z-50 border-b transition-[background-color,border-color,box-shadow] duration-500',
          overlay ? 'border-transparent bg-transparent' : 'border-charcoal/10 bg-ivory/85 backdrop-blur-md',
          scrolled && !overlay && 'shadow-[0_10px_30px_-24px_rgba(22,60,53,0.35)]',
          isHome && '-mb-[68px]',
        )}
      >
        {/* Tight spacing on wide screens so the eight-item menu (with Universities) stays on one row in Uzbek and Russian. */}
        <div ref={row} className="container-x relative flex h-[68px] items-center justify-between gap-4 xl:gap-3">
          <Link
            to="/"
            className="relative flex h-11 shrink-0 items-center rounded-control focus:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2 sm:h-[52px]"
            aria-label={`${site.brand.name} — ${t('nav.home')}`}
          >
            {/* Transparent logo: green/gold strokes on the light header, ivory/gold strokes over the dark hero (cross-faded, no card). */}
            <Image src="/brand/ilmora-logo-mark.png" alt={site.brand.name} width={925} height={432} priority sizes="(min-width: 640px) 112px, 96px" className={cx('h-11 w-auto transition-opacity duration-500 sm:h-[52px]', overlay ? 'opacity-0' : 'opacity-100')} />
            <Image src="/brand/ilmora-logo-mark-light.png" alt="" aria-hidden width={925} height={432} priority sizes="(min-width: 640px) 112px, 96px" className={cx('absolute inset-y-0 left-0 h-11 w-auto transition-opacity duration-500 sm:h-[52px]', overlay ? 'opacity-100' : 'opacity-0')} />
          </Link>
          <nav className={cx('hidden items-center gap-0.5', fits && 'xl:flex')} aria-label={t('nav.primary')}>
            {nav.map((n) => (
              <NavLink
                key={n.id}
                to={n.path}
                className={({ isActive }) =>
                  cx(
                    'whitespace-nowrap rounded-control px-1.5 py-2 text-[13px] font-medium transition-colors duration-300',
                    overlay ? (isActive ? 'text-champagne' : 'text-ivory/80 hover:text-ivory') : isActive ? 'text-forest font-semibold' : 'text-charcoal/70 hover:text-charcoal'
                  )
                }
              >
                {tr(n.label)}
              </NavLink>
            ))}
          </nav>
          {/* Invisible copy of the menu, measured to decide whether the full menu fits (see useMenuFits). */}
          <div aria-hidden="true" className="pointer-events-none invisible absolute inset-0 overflow-hidden">
            <div ref={probe} className="flex w-max gap-0.5 whitespace-nowrap">
              {nav.map((n) => <span key={n.id} className="px-1.5 py-2 text-[13px] font-semibold">{tr(n.label)}</span>)}
            </div>
            <span ref={nameProbe} className="absolute left-0 top-0 whitespace-nowrap text-xs font-medium">{accountName}</span>
          </div>
          <div ref={right} className="flex shrink-0 items-center gap-2.5 xl:gap-2">
            <div className="hidden md:block"><LangSwitcher /></div>
            <HeaderShortcuts overlay={overlay} />
            <RoleSwitcher showNameOnWide={showName} />
            {/* The workspaces are also in the account menu and the builder is in the main menu, so these give way to the full menu. */}
            {ws ? (
              <Link to={ws} data-compact-only className={cx('hidden items-center gap-1.5 whitespace-nowrap rounded-control px-4 py-2 text-xs font-medium transition-all duration-200 md:inline-flex', fits && 'xl:hidden', overlay ? 'bg-ivory/15 text-ivory ring-1 ring-ivory/30 hover:bg-ivory/25' : 'bg-forest text-ivory hover:bg-forest/90')}>
                {t('nav.myWorkspace')} <Icon name="arrowRight" className="h-3.5 w-3.5" />
              </Link>
            ) : (
              <Link to="/builder" data-compact-only className={cx('hidden items-center gap-1.5 whitespace-nowrap rounded-control px-4 py-2 text-xs font-semibold shadow-sm transition-all duration-200 md:inline-flex', fits && 'xl:hidden', overlay ? 'bg-champagne text-forest hover:bg-champagne/90' : 'bg-forest text-ivory hover:bg-forest/90')}>
                {tr(site.brand.primaryCta)} <Icon name="arrowRight" className="h-4 w-4" />
              </Link>
            )}
            <button type="button" data-compact-only onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={t('nav.menu')} className={cx('rounded-control p-2 transition-colors', fits && 'xl:hidden', overlay ? 'text-ivory hover:bg-white/10' : 'text-charcoal hover:bg-sage/50')}>
              <Icon name={open ? 'x' : 'menu'} className="h-5 w-5" />
            </button>
          </div>
        </div>
        {open && (
          <div className={cx('animate-fade border-t border-charcoal/10 bg-ivory/95 backdrop-blur-lg', fits && 'xl:hidden')}>
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
      {/* overflow-x: clip (not hidden) keeps slide-in reveals from widening the page without creating a scroll container. */}
      <main id="main" key={loc.pathname} className="page-in flex-1 overflow-x-clip">
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
            {/* City from the site settings (Admin → Theme → brand), the registered address and contacts from the operator details. */}
            <ul className="space-y-3 text-sm text-charcoal/70">
              <li className="flex gap-2.5">
                <ContactIcon kind="pin" />
                <span>
                  <span className="sr-only">{t('footer.location')}: </span>
                  <span className="block font-medium text-charcoal">{tr(site.brand.city) || t('footer.city')}</span>
                  <span className="mt-0.5 block text-[13px] text-charcoal/60">{tr(OPERATOR.address)}</span>
                </span>
              </li>
              <li className="flex gap-2.5"><ContactIcon kind="phone" /><a href={`tel:${OPERATOR.phone.replace(/\s/g, '')}`} className="hover:text-forest"><span className="sr-only">{t('footer.phone')}: </span>{OPERATOR.phone}</a></li>
              <li className="flex gap-2.5"><ContactIcon kind="mail" /><a href={`mailto:${OPERATOR.email}`} className="break-all hover:text-forest"><span className="sr-only">{t('footer.email')}: </span>{OPERATOR.email}</a></li>
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
                  {isCenterAdmin && <li><Link to="/center" className="hover:text-forest">{t('dash.center')}</Link></li>}
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
