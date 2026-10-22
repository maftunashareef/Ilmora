import { NextResponse, type NextRequest } from 'next/server'

const LOCALES = ['uz', 'ru', 'en'] as const
type Locale = (typeof LOCALES)[number]

/** Uzbek first: the language switcher sets NEXT_LOCALE; browser language is deliberately ignored. */
function preferred(req: NextRequest): Locale {
  const cookie = req.cookies.get('NEXT_LOCALE')?.value
  if (cookie && (LOCALES as readonly string[]).includes(cookie)) return cookie as Locale
  return 'uz'
}

/** Adds the locale segment to bare paths ("/courses" → "/uz/courses"); everything else passes through. */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  const first = pathname.split('/')[1]
  if ((LOCALES as readonly string[]).includes(first)) return NextResponse.next()
  const url = req.nextUrl.clone()
  url.pathname = `/${preferred(req)}${pathname === '/' ? '' : pathname}`
  return NextResponse.redirect(url, 307)
}

// `v1` is the same-origin API proxy (next.config.ts rewrites); it must never receive a locale prefix.
export const config = {
  matcher: ['/((?!api|v1|_next|brand|media|favicon.ico|robots.txt|sitemap.xml|manifest.webmanifest|.*\\.[a-zA-Z0-9]+$).*)'],
}
