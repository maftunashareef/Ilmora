import { NextResponse, type NextRequest } from 'next/server'

export function GET(req: NextRequest) {
  let locale: string | undefined

  const stateParam = req.nextUrl.searchParams.get('state')
  if (stateParam) {
    try {
      const decoded = decodeURIComponent(stateParam)
      const parsed = JSON.parse(decoded)
      if (parsed?.lang && ['uz', 'ru', 'en'].includes(parsed.lang)) {
        locale = parsed.lang
      }
    } catch {
      // state wasn't JSON
    }
  }

  if (!locale) {
    const cookie = req.cookies.get('NEXT_LOCALE')?.value
    if (cookie && ['uz', 'ru', 'en'].includes(cookie)) {
      locale = cookie
    }
  }

  locale = locale || 'uz'
  const url = req.nextUrl.clone()
  url.pathname = `/${locale}/auth/google/callback`
  const res = NextResponse.redirect(url, 307)
  res.cookies.set('NEXT_LOCALE', locale, { path: '/', maxAge: 31536000, sameSite: 'lax' })
  return res
}
