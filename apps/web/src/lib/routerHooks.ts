'use client'
/**
 * The locale and navigation helpers of the react-router compatible layer (`router.tsx` keeps the components): the
 * active locale, locale-prefixed paths, and the `useNavigate`, `useParams`, `useLocation`, `useSearchParams` hooks.
 */
import { useParams as useNextParams, usePathname, useRouter, useSearchParams as useNextSearchParams } from 'next/navigation'
import { useMemo } from 'react'
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

/** Strip the locale segment: "/uz/courses/x" → "/courses/x", "/ru?cat=1" → "/?cat=1" */
export const stripLocale = (pathname: string): string => {
  if (!pathname) return '/'
  const clean = pathname.replace(/^https?:\/\/[^/]+/, '')
  const m = /^\/(?:uz|ru|en)(?:([/?#].*)|$)/.exec(clean)
  if (!m) return clean.startsWith('/') ? clean : `/${clean}`
  const rest = m[1] || '/'
  return rest.startsWith('/') ? rest : `/${rest}`
}

export const localizePath = (to: string, locale: string): string => {
  if (!to.startsWith('/') || to.startsWith('//')) return to
  if (/^\/(uz|ru|en)(\/|$|\?)/.test(to)) return to
  return to === '/' ? `/${locale}` : `/${locale}${to}`
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
