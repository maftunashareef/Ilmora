'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useT } from '../../i18n/useT'
import { useLocation, useNavigate } from '../../lib/router'
import { stripLocale, useLocale } from '../../lib/router'
import { useStore } from '../../store/useStore'
import type { Role } from '../../types'
import { PasswordChangeDialog } from '../PasswordChange'
import { Button, cx, Icon } from '../ui'

export const LANGUAGE_OPTIONS: readonly { code: 'uz' | 'ru' | 'en'; label: string; short: 'UZ' | 'RU' | 'EN' }[] = [
  { code: 'uz', label: 'Özbekça', short: 'UZ' },
  { code: 'ru', label: 'Русский', short: 'RU' },
  { code: 'en', label: 'English', short: 'EN' },
] as const

/** Language lives in the URL (/uz, /ru, /en); switching re-routes to the same page in the new locale. */
/** The language for the next visit (read by the proxy on the first request). */
function rememberLocale(code: 'uz' | 'ru' | 'en') {
  document.cookie = `NEXT_LOCALE=${code}; path=/; max-age=31536000; samesite=lax`
}

export function LangSwitcher({ compact }: { compact?: boolean }) {
  const currentLocale = useLocale()
  const lang = useStore((s) => s.lang)
  const setLang = useStore((s) => s.setLang)
  const router = useRouter()
  const pathname = usePathname() ?? '/'
  const { t } = useT()

  const activeLang = currentLocale || lang

  const choose = (code: 'uz' | 'ru' | 'en') => {
    setLang(code)
    rememberLocale(code)
    const rest = stripLocale(pathname)
    const search = rest.includes('?') ? '' : (typeof window !== 'undefined' ? window.location.search : '')
    const hash = rest.includes('#') ? '' : (typeof window !== 'undefined' ? window.location.hash : '')
    router.push(`/${code}${rest === '/' ? '' : rest}${search}${hash}`)
  }

  return (
    <div role="group" aria-label={t('common.language')} className="inline-flex rounded-full border border-charcoal/12 bg-paper p-0.5">
      {LANGUAGE_OPTIONS.map((l) => (
        <button
          key={l.code}
          type="button"
          aria-pressed={activeLang === l.code}
          onClick={() => choose(l.code)}
          className={cx(
            'rounded-full font-medium transition',
            compact ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1 text-xs',
            activeLang === l.code ? 'bg-forest text-ivory font-semibold' : 'text-charcoal/60 hover:text-charcoal'
          )}
        >
          {l.short}
        </button>
      ))}
    </div>
  )
}

const WORKSPACE: Record<Role, string | null> = { visitor: null, student: '/student', teacher: '/teacher', center: '/center', admin: '/admin', ministry: '/ministry', institution: '/institution' }

/** Account menu: sign in / out and shortcuts to the workspaces the account can use. Kept under the old export name. */
export function RoleSwitcher({ align = 'right', showNameOnWide = true }: { align?: 'left' | 'right'; showNameOnWide?: boolean }) {
  const { t } = useT()
  const role = useStore((s) => s.role)
  const auth = useStore((s) => s.auth)
  const logout = useStore((s) => s.logout)
  const notify = useStore((s) => s.notify)
  const nav = useNavigate()
  const { pathname } = useLocation()
  const [open, setOpen] = useState(false)
  const [passwordOpen, setPasswordOpen] = useState(false)
  const closePassword = useCallback(() => setPasswordOpen(false), [])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  if (auth.status !== 'authenticated' || !auth.user) {
    return (
      <Button size="sm" variant="secondary" onClick={() => nav(`/login?next=${encodeURIComponent(pathname)}`)} disabled={auth.status === 'loading'}>
        <Icon name="user" className="h-3.5 w-3.5" /> {t('auth.signIn')}
      </Button>
    )
  }
  const user = auth.user
  const workspaces = (['admin', 'ministry', 'institution', 'teacher', 'center', 'student'] as Role[]).filter((r) => (r === 'admin' && user.roles.includes('PLATFORM_ADMIN')) || (r === 'ministry' && (user.roles.includes('MINISTRY') || user.roles.includes('PLATFORM_ADMIN'))) || (r === 'institution' && user.roles.includes('INSTITUTION_ADMIN')) || (r === 'teacher' && user.roles.includes('TEACHER')) || (r === 'center' && user.roles.includes('CENTER_ADMIN')) || (r === 'student' && user.roles.includes('STUDENT')))

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={user.displayName}
        className="inline-flex items-center gap-2 rounded-full border border-champagne/70 bg-champagne/15 py-1 pl-1 pr-3 text-xs font-medium text-charcoal transition hover:bg-champagne/30"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-forest text-ivory"><Icon name="user" className="h-3 w-3" /></span>
        {/* Phones (and wide screens, when the full menu needs the room) show only the avatar; the name is the button's label and is shown in the menu. */}
        <span data-account-name className={cx('hidden max-w-[10rem] truncate sm:inline', !showNameOnWide && 'xl:hidden')}>{user.displayName}</span>
        <Icon name="down" className="h-3 w-3 text-charcoal/50" />
      </button>
      {open && (
        <div role="dialog" aria-label={t('auth.account')} className={cx('animate-rise absolute z-[70] mt-2 w-[20rem] max-w-[calc(100vw-2rem)] rounded-card border border-charcoal/10 bg-paper p-4 shadow-lift', align === 'right' ? 'right-0' : 'left-0')}>
          <div className="eyebrow mb-1">{t('auth.account')}</div>
          <div className="text-sm font-medium text-charcoal">{user.displayName}</div>
          <div className="text-xs text-charcoal/55">{user.login ? `@${user.login}` : user.phone}</div>
          <div className="mt-3 grid gap-1.5">
            {workspaces.map((r) => (
              <button key={r} type="button" onClick={() => { setOpen(false); nav(WORKSPACE[r]!) }} className={cx('flex items-center justify-between rounded-control border px-3 py-2 text-left text-sm transition', role === r ? 'border-forest bg-sage/40' : 'border-charcoal/10 hover:border-forest/40')}>
                <span>{t(`role.${r}`)}</span>
                <Icon name="arrowRight" className="h-3.5 w-3.5 text-charcoal/40" />
              </button>
            ))}
          </div>
          {/* Accounts with a login sign in with a password and can change it here, in every workspace. */}
          {user.login && (
            <button type="button" onClick={() => { setOpen(false); setPasswordOpen(true) }} className="mt-3 flex w-full items-center gap-2 rounded-control px-1 py-1.5 text-left text-sm text-charcoal/75 transition hover:text-forest">
              <Icon name="lock" className="h-3.5 w-3.5" />{t('pwd.title')}
            </button>
          )}
          <div className="mt-4 flex items-center justify-between gap-2 border-t border-charcoal/10 pt-3">
            <span className="text-[11px] text-charcoal/45">{t('role.viewingAs')} {t(`role.${role}`)}</span>
            <Button size="sm" variant="ghost" className="text-charcoal/60" onClick={async () => { setOpen(false); await logout(); notify(t('auth.signedOut')); nav('/') }}>
              <Icon name="x" className="h-3.5 w-3.5" /> {t('auth.signOut')}
            </Button>
          </div>
        </div>
      )}
      {passwordOpen && <PasswordChangeDialog onClose={closePassword} />}
    </div>
  )
}
