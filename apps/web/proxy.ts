import { NextResponse, type NextRequest } from 'next/server'
import { contentSecurityPolicy, newNonce } from './security-headers'

const LOCALES = ['uz', 'ru', 'en'] as const
type Locale = (typeof LOCALES)[number]

/**
 * One image, two machines. APP_SURFACE (read at runtime) picks what this server answers:
 *  - 'public' (default): the site and the student/teacher workspaces; /admin goes to ADMIN_ORIGIN when set, else 404.
 *  - 'admin': only the admin workspace and the sign-in page; everything else lands on /admin.
 */
const SURFACE = process.env.APP_SURFACE === 'admin' ? 'admin' : 'public'
const ADMIN_ORIGIN = process.env.ADMIN_ORIGIN?.replace(/\/$/, '') ?? ''

/** Uzbek first: the language switcher sets NEXT_LOCALE; browser language is deliberately ignored. */
function preferred(req: NextRequest): Locale {
  const cookie = req.cookies.get('NEXT_LOCALE')?.value
  if (cookie && (LOCALES as readonly string[]).includes(cookie)) return cookie as Locale
  return 'uz'
}

const isAdminPath = (rest: string) => rest === '/admin' || rest.startsWith('/admin/')

/**
 * A page with its Content-Security-Policy (М-3): a fresh nonce per request. Next.js reads the policy from the request
 * headers and puts the nonce on its own scripts; the browser gets the same policy, so a script without it does not run.
 */
function page(req: NextRequest) {
  const csp = contentSecurityPolicy(newNonce())
  const headers = new Headers(req.headers)
  headers.set('Content-Security-Policy', csp)
  const res = NextResponse.next({ request: { headers } })
  res.headers.set('Content-Security-Policy', csp)
  return res
}

/** Adds the locale segment to bare paths ("/courses" → "/uz/courses") and keeps each surface to its own pages. */
export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl
  const first = pathname.split('/')[1]
  if (!(LOCALES as readonly string[]).includes(first)) {
    const url = req.nextUrl.clone()
    url.pathname = `/${preferred(req)}${pathname === '/' ? (SURFACE === 'admin' ? '/admin' : '') : pathname}`
    return NextResponse.redirect(url, 307)
  }

  const rest = pathname.slice(first.length + 1)
  if (SURFACE === 'admin') {
    if (isAdminPath(rest) || rest === '/login') return page(req)
    const url = req.nextUrl.clone()
    url.pathname = `/${first}/admin`
    url.search = ''
    return NextResponse.redirect(url, 307)
  }

  if (isAdminPath(rest)) {
    if (ADMIN_ORIGIN) return NextResponse.redirect(`${ADMIN_ORIGIN}${pathname}${search}`, 307)
    return new NextResponse('Not found', { status: 404 })
  }
  return page(req)
}

// `v1` is the same-origin API proxy (next.config.ts rewrites); it must never receive a locale prefix.
export const config = {
  matcher: ['/((?!api|v1|_next|brand|media|favicon.ico|robots.txt|sitemap.xml|manifest.webmanifest|.*\\.[a-zA-Z0-9]+$).*)'],
}
