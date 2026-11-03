import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { ROLES_KEY } from '../src/common/decorators'
import type { RequestActor } from '../src/infra/tenancy/tenant-context'
import { AttendanceController } from '../src/modules/attendance/attendance.controller'
import { AdminCenterController, asCenter } from '../src/modules/center/admin-center.controller'
import { CenterController } from '../src/modules/center/center.controller'
import type { CenterService } from '../src/modules/center/center.service'
import type { ManageService } from '../src/modules/manage/manage.service'

const roles = (target: object) => Reflect.getMetadata(ROLES_KEY, target) as string[] | undefined
const methods = (ctl: abstract new (...args: never[]) => unknown) => Object.getOwnPropertyNames(ctl.prototype).filter((n) => n !== 'constructor')

describe('Super Admin oversight of centers', () => {
  const owner: RequestActor = { id: 'u-owner', roles: ['PLATFORM_ADMIN'], centerId: null }

  it('keeps the center workspace with center administrators and gives the Super Admin a twin of every route', () => {
    expect(roles(CenterController)).toEqual(['CENTER_ADMIN'])
    expect(roles(AdminCenterController)).toEqual(['PLATFORM_ADMIN'])
    for (const name of methods(CenterController)) expect(methods(AdminCenterController)).toContain(name)
  })

  it('lets the Super Admin open, correct and move any lesson, like teachers and centers', () => {
    const proto = AttendanceController.prototype as unknown as Record<string, object>
    const staffRoutes = methods(AttendanceController).filter((n) => roles(proto[n])?.includes('TEACHER'))
    expect(staffRoutes.length).toBeGreaterThanOrEqual(8)
    for (const n of staffRoutes) expect(roles(proto[n])).toContain('PLATFORM_ADMIN')
  })

  it('scopes every call to the center named in the route, never to the admin account', async () => {
    const calls: { name: string; args: unknown[] }[] = []
    const spy = (name: string) => (...args: unknown[]) => { calls.push({ name, args }); return Promise.resolve(name) }
    const center = Object.fromEntries(['overview', 'updateProfile', 'qr', 'rotateQr', 'attendanceDay', 'teachers', 'addTeacher', 'updateTeacher', 'removeTeacher', 'students'].map((n) => [n, spy(n)])) as unknown as CenterService
    const manage = Object.fromEntries(['listCenterCourses', 'createCourse', 'updateCourse', 'deleteCourse', 'createGroup', 'myGroups', 'groupDetail', 'updateGroup', 'deleteGroup', 'generateGroupSessions'].map((n) => [n, spy(n)])) as unknown as ManageService
    const ctl = new AdminCenterController(center, manage)
    await ctl.overview('t1', owner, 'ce-1')
    await ctl.attendance('t1', owner, 'ce-1', '2026-11-03')
    await ctl.students('t1', owner, 'ce-1')
    await ctl.courses('t1', owner, 'ce-1')
    await ctl.createCourse('t1', owner, 'ce-1', { centerId: 'ce-other' } as never)
    await ctl.generate('t1', owner, 'ce-1', 'g-1', { days: 14 })
    expect(calls.map((c) => c.name)).toEqual(['overview', 'attendanceDay', 'students', 'listCenterCourses', 'createCourse', 'generateGroupSessions'])
    for (const { args } of calls) {
      expect(args[0]).toBe('t1')
      expect(args[1]).toEqual({ ...owner, centerId: 'ce-1' })
    }
    // A course created from the admin view belongs to that center whatever the body says.
    expect((calls[4].args[2] as { centerId: string }).centerId).toBe('ce-1')
    expect(asCenter(owner, 'ce-2')).toEqual({ id: 'u-owner', roles: ['PLATFORM_ADMIN'], centerId: 'ce-2' })
  })
})
