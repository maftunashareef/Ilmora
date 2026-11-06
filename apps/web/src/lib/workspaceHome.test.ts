import { describe, expect, it } from 'vitest'
import { canOpen, homeFor, workspaceOf } from './workspaceHome'

describe('homeFor', () => {
  it('sends every role to its own workspace', () => {
    expect(homeFor(['PLATFORM_ADMIN', 'FINANCE_ADMIN'])).toBe('/admin')
    expect(homeFor(['TEACHER', 'STUDENT'])).toBe('/teacher')
    expect(homeFor(['CENTER_ADMIN'])).toBe('/center')
    expect(homeFor(['CENTER_ADMIN', 'STUDENT'])).toBe('/center')
    expect(homeFor(['FINANCE_ADMIN'])).toBe('/admin/finance')
    expect(homeFor(['STUDENT'])).toBe('/student')
    expect(homeFor([])).toBe('/student')
  })
})

describe('canOpen', () => {
  it('knows the four workspaces', () => {
    expect(workspaceOf('/center/courses')).toBe('center')
    expect(workspaceOf('/courses/abc')).toBeNull()
  })
  it('lets a center administrator open the center workspace only', () => {
    expect(canOpen(['CENTER_ADMIN'], '/center')).toBe(true)
    expect(canOpen(['CENTER_ADMIN'], '/teacher')).toBe(false)
    expect(canOpen(['CENTER_ADMIN'], '/student')).toBe(false)
    expect(canOpen(['CENTER_ADMIN'], '/courses/abc')).toBe(true)
  })
  it('limits finance admins to the finance page of the admin workspace', () => {
    expect(canOpen(['FINANCE_ADMIN'], '/admin/finance')).toBe(true)
    expect(canOpen(['FINANCE_ADMIN'], '/admin/finance/payouts')).toBe(true)
    expect(canOpen(['FINANCE_ADMIN'], '/admin')).toBe(false)
    expect(canOpen(['PLATFORM_ADMIN'], '/admin')).toBe(true)
  })
})
