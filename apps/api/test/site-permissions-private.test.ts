import 'reflect-metadata'
import type { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { sampleData } from '@ilmora/shared'
import { describe, expect, it } from 'vitest'
import { AuthGuard } from '../src/common/guards'
import { CatalogController } from '../src/modules/catalog/catalog.controller'
import { MyPermissionsController } from '../src/modules/catalog/my-permissions.controller'
import { SiteService } from '../src/modules/site/site.service'

/** Ж17: the role-permission matrix is not part of the public site; a signed-in account reads its own role's switches. */
const PERMISSIONS = {
  teacher: { editCourses: true, editPrices: false, editSchedules: true, publishDirectly: false, customizeChannel: true, manageGroups: true, uploadResources: false },
  student: { saveItems: true, switchGroups: false, downloadResources: true },
}
const { packages: _packages, ...stored } = sampleData.site
void _packages
const site = new SiteService({
  client: {
    siteConfig: { findUnique: async () => ({ data: { ...stored, permissions: PERMISSIONS }, version: 7 }) },
    package: { findMany: async () => [] },
  },
} as never, {} as never)
const actor = (...roles: string[]) => ({ id: 'u1', tenantId: 't1', roles }) as never

describe('Ж17: the public site carries no role-permission matrix', () => {
  it('GET /public/site answers without `permissions`, the rest of the template intact', async () => {
    const body = await new CatalogController({} as never, site, {} as never).site_('t1')
    expect(body).not.toHaveProperty('permissions')
    expect(JSON.stringify(body)).not.toContain('publishDirectly')
    expect(body).toMatchObject({ version: 7, brand: stored.brand, features: stored.features })
  })

  it('the server\'s own read (teacher switches for saves and uploads) and the Super Admin read keep the whole matrix', async () => {
    expect((await site.get('t1')).permissions).toEqual(PERMISSIONS)
    expect((await site.get('t1', true)).permissions).toEqual(PERMISSIONS)
  })
})

describe('Ж17: GET /me/permissions — only the caller\'s own role', () => {
  const ctl = new MyPermissionsController(site)

  it('a teacher gets the teacher switches only', async () => {
    expect(await ctl.permissions('t1', actor('TEACHER'))).toEqual({ teacher: PERMISSIONS.teacher })
  })

  it('a student gets the student switches only', async () => {
    expect(await ctl.permissions('t1', actor('STUDENT'))).toEqual({ student: PERMISSIONS.student })
  })

  it('a center, a company, an institution and the ministry get none', async () => {
    for (const role of ['CENTER_ADMIN', 'CENTER_MANAGER', 'COMPANY_ADMIN', 'INSTITUTION_ADMIN', 'MINISTRY']) expect(await ctl.permissions('t1', actor(role)), role).toEqual({})
  })

  it('the Super Admin, who edits the matrix, gets both', async () => {
    expect(await ctl.permissions('t1', actor('PLATFORM_ADMIN'))).toEqual(PERMISSIONS)
  })

  it('is not public: without a session the auth guard answers 401', () => {
    const handler = MyPermissionsController.prototype.permissions
    const ctx = { getHandler: () => handler, getClass: () => MyPermissionsController, switchToHttp: () => ({ getRequest: () => ({}) }) } as unknown as ExecutionContext
    let status: number | undefined
    try { new AuthGuard(new Reflector()).canActivate(ctx) } catch (err) { status = (err as { getStatus?: () => number }).getStatus?.() }
    expect(status).toBe(401)
  })
})
