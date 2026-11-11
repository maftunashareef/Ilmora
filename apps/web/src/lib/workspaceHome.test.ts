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
    expect(homeFor(['MINISTRY'])).toBe('/ministry')
    expect(homeFor(['INSTITUTION_ADMIN'])).toBe('/institution')
    expect(homeFor(['COMPANY_ADMIN'])).toBe('/')
    expect(homeFor([])).toBe('/student')
  })
})

describe('canOpen', () => {
  it('knows the five workspaces', () => {
    expect(workspaceOf('/center/courses')).toBe('center')
    expect(workspaceOf('/ministry')).toBe('ministry')
    expect(workspaceOf('/ministry/institutions/abc')).toBe('ministry')
    expect(workspaceOf('/courses/abc')).toBeNull()
    // Public pages whose path only starts with a workspace's name are not workspaces.
    expect(workspaceOf('/teachers/t1')).toBeNull()
  })
  it('opens the institution workspace to its representative and the Super Admin only', () => {
    expect(workspaceOf('/institution/students')).toBe('institution')
    expect(canOpen(['INSTITUTION_ADMIN'], '/institution/graduates')).toBe(true)
    expect(canOpen(['INSTITUTION_ADMIN'], '/ministry')).toBe(false)
    expect(canOpen(['COMPANY_ADMIN'], '/institution')).toBe(false)
    expect(canOpen(['PLATFORM_ADMIN'], '/institution')).toBe(true)
  })
  it('opens the ministry workspace to the ministry and the Super Admin only', () => {
    expect(canOpen(['MINISTRY'], '/ministry/companies')).toBe(true)
    expect(canOpen(['MINISTRY'], '/admin')).toBe(false)
    expect(canOpen(['MINISTRY'], '/student')).toBe(false)
    expect(canOpen(['STUDENT'], '/ministry')).toBe(false)
    expect(canOpen(['PLATFORM_ADMIN'], '/ministry')).toBe(true)
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
    // A refund notification opens the queue on one request.
    expect(canOpen(['FINANCE_ADMIN'], '/admin/finance?tab=refunds&request=r1')).toBe(true)
    expect(canOpen(['FINANCE_ADMIN'], '/admin?x=/admin/finance')).toBe(false)
    expect(canOpen(['PLATFORM_ADMIN'], '/admin')).toBe(true)
  })
})
