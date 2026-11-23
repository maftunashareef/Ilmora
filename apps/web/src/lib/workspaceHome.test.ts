import { describe, expect, it } from 'vitest'
import { canOpen, homeFor, isCenterManagerOnly, managerOpens, workspaceOf } from './workspaceHome'

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
    expect(homeFor(['COMPANY_ADMIN'])).toBe('/company')
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
    expect(canOpen(['COMPANY_ADMIN'], '/company/vacancies')).toBe(true)
    expect(canOpen(['INSTITUTION_ADMIN'], '/company')).toBe(false)
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

describe('the center manager (№15, 19.11): students and the journal only', () => {
  it('lands on the students table, opens students, journal and notifications, nothing else of the center', () => {
    expect(homeFor(['CENTER_MANAGER'])).toBe('/center/students')
    for (const p of ['/center/students', '/center/students?archive=1', '/center/journal', '/center/notifications']) expect(canOpen(['CENTER_MANAGER'], p), p).toBe(true)
    for (const p of ['/center', '/center/courses', '/center/teachers', '/center/settings', '/center/attendance', '/admin', '/teacher']) expect(canOpen(['CENTER_MANAGER'], p), p).toBe(false)
    expect(managerOpens('/center/studentsX')).toBe(false)
  })
  it('the administrator keeps the whole workspace; only a manager with nothing above is narrowed', () => {
    expect(canOpen(['CENTER_ADMIN', 'CENTER_MANAGER'], '/center/settings')).toBe(true)
    expect(isCenterManagerOnly(['CENTER_MANAGER'])).toBe(true)
    expect(isCenterManagerOnly(['CENTER_MANAGER', 'CENTER_ADMIN'])).toBe(false)
    expect(isCenterManagerOnly(['CENTER_MANAGER', 'PLATFORM_ADMIN'])).toBe(false)
  })
})
