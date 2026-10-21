'use client'
/**
 * Small react-router compatible layer over next/navigation so the existing pages keep their
 * `Link`, `NavLink`, `useNavigate`, `useParams`, `useLocation`, `useSearchParams`, `Navigate`
 * and `Outlet` usage. Internal links are prefixed with the active locale segment (/uz, /ru, /en).
 */
import NextLink from 'next/link'
import { useParams as useNextParams, usePathname, useRouter, useSearchParams as useNextSearchParams } from 'next/navigation'
import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { isLang } from '@ilmora/shared'

export const LOCALES = ['uz', 'ru', 'en'] as const
export type Locale = (typeof LOCALES)[number]

export function useLocale(): Locale {
  const params = useNextParams<{ locale?: string }>()
  const pathname = usePathname()
  const fromParams = params?.locale
  if (fromParams && isLang(fromParams)) return fromParams
  const seg = pathname?.split('/')[1]
  return seg && isLang(seg) ? seg : 'uz'
}

/** Strip the locale segment: "/uz/courses/x" → "/courses/x" */
export const stripLocale = (pathname: string): string => {
  const m = /^\/(uz|ru|en)(\/.*)?$/.exec(pathname)
  return m ? m[2] || '/' : pathname
}

export const localizePath = (to: string, locale: string): string => {
  if (!to.startsWith('/') || to.startsWith('//')) return to
  if (/^\/(uz|ru|en)(\/|$|\?)/.test(to)) return to
  return to === '/' ? `/${locale}` : `/${locale}${to}`
}

type LinkProps = Omit<React.ComponentProps<typeof NextLink>, 'href'> & { to: string }

export function Link({ to, children, ...rest }: LinkProps) {
  const locale = useLocale()
  return (
    <NextLink href={localizePath(to, locale)} {...rest}>
      {children}
    </NextLink>
  )
}

type NavLinkClass = string | ((state: { isActive: boolean }) => string)

export function NavLink({ to, end, className, children, ...rest }: Omit<LinkProps, 'className' | 'children'> & { end?: boolean; className?: NavLinkClass; children?: ReactNode | ((state: { isActive: boolean }) => ReactNode) }) {
  const locale = useLocale()
  const pathname = stripLocale(usePathname() ?? '/')
  const target = stripLocale(to)
  const isActive = end ? pathname === target : pathname === target || pathname.startsWith(target.endsWith('/') ? target : `${target}/`) || (target === '/' && pathname === '/')
  return (
    <NextLink href={localizePath(to, locale)} className={typeof className === 'function' ? className({ isActive }) : className} aria-current={isActive ? 'page' : undefined} {...rest}>
      {typeof children === 'function' ? children({ isActive }) : children}
    </NextLink>
  )
}

export function useNavigate() {
  const router = useRouter()
  const locale = useLocale()
  return useMemo(
    () => (to: string | number, opts?: { replace?: boolean }) => {
      if (typeof to === 'number') {
        if (to < 0) router.back()
        else router.forward()
        return
      }
      const href = localizePath(to, locale)
      if (opts?.replace) router.replace(href)
      else router.push(href)
    },
    [router, locale],
  )
}

export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T {
  const params = useNextParams()
  return useMemo(() => {
    const out: Record<string, string | undefined> = {}
    for (const [k, v] of Object.entries(params ?? {})) out[k] = Array.isArray(v) ? v.join('/') : v
    return out as T
  }, [params])
}

export function useLocation() {
  const pathname = usePathname() ?? '/'
  const sp = useNextSearchParams()
  const search = sp?.toString() ? `?${sp.toString()}` : ''
  return useMemo(() => ({ pathname: stripLocale(pathname), fullPathname: pathname, search, hash: '', key: pathname + search }), [pathname, search])
}

export function useSearchParams(): [URLSearchParams, (next: URLSearchParams | Record<string, string>, opts?: { replace?: boolean }) => void] {
  const sp = useNextSearchParams()
  const router = useRouter()
  const pathname = usePathname() ?? '/'
  const params = useMemo(() => new URLSearchParams(sp?.toString() ?? ''), [sp])
  const set = useMemo(
    () => (next: URLSearchParams | Record<string, string>, opts?: { replace?: boolean }) => {
      const qs = (next instanceof URLSearchParams ? next : new URLSearchParams(next)).toString()
      const href = qs ? `${pathname}?${qs}` : pathname
      if (opts?.replace === false) router.push(href)
      else router.replace(href)
    },
    [router, pathname],
  )
  return [params, set]
}

export function Navigate({ to, replace = true }: { to: string; replace?: boolean }) {
  const navigate = useNavigate()
  useEffect(() => {
    navigate(to, { replace })
  }, [navigate, to, replace])
  return null
}

const OutletContext = createContext<ReactNode>(null)

/** Layout components render `<Outlet />`; Next passes the nested route as `children` through this provider. */
export function OutletProvider({ children, outlet }: { children: ReactNode; outlet: ReactNode }) {
  return <OutletContext.Provider value={outlet}>{children}</OutletContext.Provider>
}

export function Outlet() {
  return <>{useContext(OutletContext)}</>
}
