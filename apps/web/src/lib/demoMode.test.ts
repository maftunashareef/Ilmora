import { describe, expect, it } from 'vitest'
import { isDemoLoginEnabled } from './demoMode'

describe('offline demo sign-in switch', () => {
  it('is available while developing and testing', () => {
    expect(isDemoLoginEnabled({ NODE_ENV: 'development' })).toBe(true)
    expect(isDemoLoginEnabled({ NODE_ENV: 'test' })).toBe(true)
    expect(isDemoLoginEnabled({})).toBe(true)
  })

  it('is off in production builds by default', () => {
    expect(isDemoLoginEnabled({ NODE_ENV: 'production' })).toBe(false)
    expect(isDemoLoginEnabled({ NODE_ENV: 'production', NEXT_PUBLIC_ENABLE_DEMO_LOGIN: '' })).toBe(false)
  })

  it('only an exact "true" turns it on in production (demo deployments)', () => {
    expect(isDemoLoginEnabled({ NODE_ENV: 'production', NEXT_PUBLIC_ENABLE_DEMO_LOGIN: 'true' })).toBe(true)
    for (const value of ['1', 'yes', 'TRUE', 'false', ' true']) {
      expect(isDemoLoginEnabled({ NODE_ENV: 'production', NEXT_PUBLIC_ENABLE_DEMO_LOGIN: value })).toBe(false)
    }
  })
})
