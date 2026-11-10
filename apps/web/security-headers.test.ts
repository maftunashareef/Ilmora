import { afterEach, describe, expect, it, vi } from 'vitest'
import { securityHeaders } from './security-headers'

const header = (key: string) => securityHeaders.find((h) => h.key === key)?.value ?? ''

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

  describe('object storage', () => {
    afterEach(() => {
      vi.unstubAllEnvs()
      vi.resetModules()
    })
    const csp = async (mediaBase?: string) => {
      if (mediaBase) vi.stubEnv('NEXT_PUBLIC_MEDIA_BASE_URL', mediaBase)
      vi.resetModules()
      const { securityHeaders: headers } = await import('./security-headers')
      const value = headers.find((h) => h.key === 'Content-Security-Policy')?.value ?? ''
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
