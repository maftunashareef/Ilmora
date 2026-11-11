import { describe, expect, it } from 'vitest'
import type { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { PasswordChangeGuard } from '../src/common/guards'
import { AuthController } from '../src/modules/auth/auth.controller'
import { MinistryController } from '../src/modules/ministry/ministry.controller'
import { StudentsController } from '../src/modules/students/students.controller'

/** Security review 10.11 №4: with a password issued by the Super Admin, only the change of it (and «who am I») is open. */
describe('PasswordChangeGuard', () => {
  const guard = new PasswordChangeGuard(new Reflector())
  const call = (cls: { prototype: object }, method: string, passwordChangeRequired?: boolean) =>
    guard.canActivate({
      getHandler: () => (cls.prototype as Record<string, unknown>)[method],
      getClass: () => cls,
      switchToHttp: () => ({ getRequest: () => ({ actor: { id: 'u', roles: ['MINISTRY'], passwordChangeRequired } }) }),
    } as unknown as ExecutionContext)

  it('closes every route with 403 password_change_required while the issued password is not changed', () => {
    for (const [cls, method] of [[MinistryController, 'all'], [MinistryController, 'export'], [StudentsController, 'get'], [MinistryController, 'institutions'], [AuthController, 'updateMe']] as const) {
      expect(() => call(cls, method, true)).toThrow(expect.objectContaining({ code: 'password_change_required' }))
    }
  })

  it('leaves open the change itself, «who am I» and the public sign-in routes; a changed password opens everything', () => {
    for (const method of ['changePassword', 'me', 'login', 'refresh', 'logout', 'mfaVerify']) {
      if (typeof (AuthController.prototype as unknown as Record<string, unknown>)[method] !== 'function') continue
      expect(call(AuthController, method, true)).toBe(true)
    }
    expect(call(MinistryController, 'all', false)).toBe(true)
    expect(call(MinistryController, 'all', undefined)).toBe(true)
  })
})
