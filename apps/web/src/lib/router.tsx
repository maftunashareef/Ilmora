'use client'
/**
 * Small react-router compatible layer over next/navigation so the existing pages keep their `Link`, `NavLink`,
 * `Navigate` and `Outlet` usage; the hooks (`useNavigate`, `useParams`, `useLocation`, `useSearchParams`) and the
 * locale path helpers are in `routerHooks.ts`. Internal links are prefixed with the active locale segment (/uz, /ru, /en).
 */
import NextLink from 'next/link'
import { usePathname } from 'next/navigation'
import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { localizePath, stripLocale, useLocale, useNavigate } from './routerHooks'

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
