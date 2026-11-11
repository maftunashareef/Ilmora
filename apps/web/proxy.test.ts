import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { proxy } from './proxy'

const nonceOf = (csp: string | null) => csp?.match(/'nonce-([^']+)'/)?.[1]

describe('proxy: Content-Security-Policy of a page (М-3)', () => {
  it('sends the policy with a nonce to Next.js (request) and to the browser (response) — the same one', () => {
    const res = proxy(new NextRequest('http://localhost:3000/ru/courses'))
    const sent = res.headers.get('Content-Security-Policy')
    // NextResponse.next({ request: { headers } }) passes the request headers on as x-middleware-request-*.
    const toNext = res.headers.get('x-middleware-request-content-security-policy')
    expect(nonceOf(sent)).toBeTruthy()
    expect(toNext).toBe(sent)
    expect(sent?.split('; ').find((d) => d.startsWith('script-src'))).not.toContain('unsafe-inline')
  })

  it('a new nonce for every request', () => {
    const a = nonceOf(proxy(new NextRequest('http://localhost:3000/uz')).headers.get('Content-Security-Policy'))
    const b = nonceOf(proxy(new NextRequest('http://localhost:3000/uz')).headers.get('Content-Security-Policy'))
    expect(a).not.toBe(b)
  })

  it('a redirect to the locale needs no policy', () => {
    const res = proxy(new NextRequest('http://localhost:3000/courses'))
    expect(res.status).toBe(307)
    expect(res.headers.get('Content-Security-Policy')).toBeNull()
  })
})
