import { describe, expect, it } from 'vitest'
import { withCenterAdmin, withoutCenterAdmin } from './centerAdmins'

describe('center admin role changes keep the rest of the roles', () => {
  it('adds the role without dropping teacher, student or finance roles, in a stable order', () => {
    expect(withCenterAdmin(['STUDENT'])).toEqual(['CENTER_ADMIN', 'STUDENT'])
    expect(withCenterAdmin(['TEACHER', 'STUDENT'])).toEqual(['CENTER_ADMIN', 'TEACHER', 'STUDENT'])
    expect(withCenterAdmin(['CENTER_ADMIN', 'FINANCE_ADMIN'])).toEqual(['FINANCE_ADMIN', 'CENTER_ADMIN'])
  })

  it('never sends the Super Admin role or unknown roles to the roles endpoint', () => {
    expect(withCenterAdmin(['PLATFORM_ADMIN', 'STUDENT', 'WIZARD'])).toEqual(['CENTER_ADMIN', 'STUDENT'])
    expect(withoutCenterAdmin(['PLATFORM_ADMIN', 'CENTER_ADMIN', 'TEACHER'])).toEqual(['TEACHER'])
  })

  it('removes the role and falls back to student so the list is never empty', () => {
    expect(withoutCenterAdmin(['CENTER_ADMIN', 'TEACHER'])).toEqual(['TEACHER'])
    expect(withoutCenterAdmin(['CENTER_ADMIN'])).toEqual(['STUDENT'])
    expect(withoutCenterAdmin([])).toEqual(['STUDENT'])
  })
})
