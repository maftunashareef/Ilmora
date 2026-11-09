import { describe, expect, it } from 'vitest'
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
})
