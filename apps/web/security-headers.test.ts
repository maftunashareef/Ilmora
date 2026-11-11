import { afterEach, describe, expect, it, vi } from 'vitest'
import { contentSecurityPolicy, newNonce, securityHeaders } from './security-headers'

const header = (key: string) => (key === 'Content-Security-Policy' ? contentSecurityPolicy('n0nce') : (securityHeaders.find((h) => h.key === key)?.value ?? ''))
const directive = (policy: string, name: string) => policy.split('; ').find((d) => d.startsWith(`${name} `)) ?? ''

describe('security headers', () => {
  it('lets the site ask for the location (center check-in with a radius), and only for itself', () => {
    expect(header('Permissions-Policy')).toContain('geolocation=(self)')
    expect(header('Permissions-Policy')).not.toContain('geolocation=()')
  })

  it('lets lesson videos from YouTube and Vimeo play, and no other frames (Ж6)', () => {
    const frameSrc = header('Content-Security-Policy').split('; ').find((d) => d.startsWith('frame-src')) ?? ''
    for (const origin of ['https://www.youtube-nocookie.com', 'https://www.youtube.com', 'https://player.vimeo.com']) expect(frameSrc).toContain(origin)
    expect(frameSrc).not.toContain('*')
    expect(header('Content-Security-Policy')).toContain("frame-ancestors 'none'")
  })

  describe('scripts (М-3)', () => {
    it('a page runs only scripts with its nonce: no unsafe-inline', () => {
      const scripts = directive(contentSecurityPolicy('abc123'), 'script-src')
      expect(scripts).toContain("'nonce-abc123'")
      expect(scripts).toContain("'strict-dynamic'")
      expect(scripts).not.toContain('unsafe-inline')
    })

    it('a static file gets no nonce and nothing inline either', () => {
      const scripts = directive(contentSecurityPolicy(), 'script-src')
      expect(scripts).not.toContain('nonce-')
      expect(scripts).not.toContain('unsafe-inline')
    })

    it('every page request gets its own nonce', () => {
      const nonces = new Set(Array.from({ length: 50 }, () => newNonce()))
      expect(nonces.size).toBe(50)
      for (const n of nonces) expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/)
    })

    it('no Content-Security-Policy among the headers of every response: it is set per page', () => {
      expect(securityHeaders.some((h) => h.key === 'Content-Security-Policy')).toBe(false)
    })
  })

  describe('object storage', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
      vi.resetModules()
    })
    const csp = async (mediaBase?: string) => {
      if (mediaBase) vi.stubEnv('NEXT_PUBLIC_MEDIA_BASE_URL', mediaBase)
      vi.resetModules()
      const { contentSecurityPolicy: policy } = await import('./security-headers')
      const value = policy('n0nce')
      return (name: string) => value.split('; ').find((d) => d.startsWith(`${name} `)) ?? ''
    }

    it('lets the browser upload to the storage and show its images, and nothing else from there', async () => {
      const directive = await csp('https://s3.uzcstorage.uz/ilmora-media')
      expect(directive('connect-src').split(' ')).toContain('https://s3.uzcstorage.uz')
      expect(directive('img-src').split(' ')).toContain('https://s3.uzcstorage.uz')
      expect(directive('script-src')).not.toContain('uzcstorage')
      expect(directive('frame-src')).not.toContain('uzcstorage')
    })

    it('allows no storage host when no media address is built in', async () => {
      const directive = await csp()
      expect(directive('connect-src')).not.toContain('https://s3.')
      expect(directive('connect-src')).not.toMatch(/\s{2,}/)
    })
  })
})
