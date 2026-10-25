import { NextResponse, type NextRequest } from 'next/server'

export function GET(req: NextRequest) {
  const cookie = req.cookies.get('NEXT_LOCALE')?.value
  const locale = cookie && ['uz', 'ru', 'en'].includes(cookie) ? cookie : 'uz'
  const url = req.nextUrl.clone()
  url.pathname = `/${locale}/auth/google/callback`
  return NextResponse.redirect(url, 307)
}
