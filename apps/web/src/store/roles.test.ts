import { describe, expect, it } from 'vitest'
import { type AuthUser, roleOf } from './useStore'

const account = (roles: AuthUser['roles']) => ({ id: 'u1', login: 'x', phone: null, displayName: 'X', district: null, preferredLang: 'uz', reminders: false, roles, centerId: null, teacherProfileId: null }) as AuthUser

describe('the workspace an account lands in', () => {
  it('is visitor when signed out and student for plain students', () => {
    expect(roleOf(null)).toBe('visitor')
    expect(roleOf(account(['STUDENT']))).toBe('student')
  })

  it('gives center admins their own workspace', () => {
    expect(roleOf(account(['CENTER_ADMIN']))).toBe('center')
    expect(roleOf(account(['CENTER_ADMIN', 'STUDENT']))).toBe('center')
  })

  it('keeps the Teacher Studio for accounts that are both teacher and center admin (the center workspace opens from the account menu)', () => {
    expect(roleOf(account(['TEACHER']))).toBe('teacher')
    expect(roleOf(account(['CENTER_ADMIN', 'TEACHER']))).toBe('teacher')
  })

  it('always gives the Super Admin the admin workspace', () => {
    expect(roleOf(account(['PLATFORM_ADMIN']))).toBe('admin')
    expect(roleOf(account(['PLATFORM_ADMIN', 'TEACHER', 'CENTER_ADMIN']))).toBe('admin')
  })

  it('does not give finance admins a workspace of their own (unchanged: they land as students)', () => {
    expect(roleOf(account(['FINANCE_ADMIN']))).toBe('student')
  })
})
