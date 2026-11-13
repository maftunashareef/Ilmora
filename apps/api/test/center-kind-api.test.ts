import 'reflect-metadata'
import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ZodValidationPipe } from '../src/common/zod.pipe'
import { type RequestActor, TenantContext } from '../src/infra/tenancy/tenant-context'
import type { AttendanceService } from '../src/modules/attendance/attendance.service'
import { RegisterDto } from '../src/modules/auth/auth.dto'
import { AccountService } from '../src/modules/auth/account.service'
import { CatalogService } from '../src/modules/catalog/catalog.service'
import { CenterService } from '../src/modules/center/center.service'
import { CenterInput, CenterProfileInput } from '../src/modules/manage/manage.schemas'
import { ManageService } from '../src/modules/manage/manage.service'
import type { RedisService } from '../src/infra/redis/redis.service'
import type { SessionsService } from '../src/modules/sessions/sessions.service'
import type { SiteService } from '../src/modules/site/site.service'
import { DB_AVAILABLE, TestContext } from './helpers'
import { mfaStub, notificationsStub } from './stubs'

/** The kind of a center in the API (the «Центры» page: a student looks for the courses of one kind of school). */
describe('Center kind: what the API accepts', () => {
  const base = { role: 'CENTER', login: 'center.one', password: 'center-password-1', centerName: 'Bir markaz' }
  it('registration takes a known kind or none; anything else is refused', () => {
    // Only the kind is looked at here; the other fields of a registration are checked elsewhere.
    const kindErrors = (body: object) => validateSync(plainToInstance(RegisterDto, body)).filter((e) => e.property === 'centerKind')
    expect(kindErrors({ ...base, centerKind: 'UNIVERSITY' })).toHaveLength(0)
    expect(kindErrors(base)).toHaveLength(0)
    expect(kindErrors({ ...base, centerKind: 'ACADEMY' })).toHaveLength(1)
    // A student's registration ignores it.
    expect(kindErrors({ ...base, role: 'STUDENT', centerKind: 'ACADEMY' })).toHaveLength(0)
  })

  it('the center and the Super Admin set a known kind only', () => {
    const profile = new ZodValidationPipe(CenterProfileInput)
    expect(profile.transform({ kind: 'COLLEGE' })).toEqual({ kind: 'COLLEGE' })
    expect(() => profile.transform({ kind: 'ACADEMY' })).toThrow()
    const admin = new ZodValidationPipe(CenterInput)
    const center = { name: 'Bir', district: { uz: 'a', ru: 'a', en: 'a' }, description: { uz: 'a', ru: 'a', en: 'a' } }
    expect(admin.transform({ ...center, kind: 'SCHOOL' })).toMatchObject({ kind: 'SCHOOL' })
    expect(() => admin.transform({ ...center, kind: 'ACADEMY' })).toThrow()
  })
})

describe.skipIf(!DB_AVAILABLE)('Center kind: registration, settings, catalog', () => {
  const ctx = new TestContext()
  const db = ctx.prisma.client
  const accounts = new AccountService(ctx.prisma, ctx.tokens, ctx.audit, {} as RedisService, notificationsStub, ctx.env, mfaStub)
  const centers = new CenterService(ctx.prisma, ctx.audit, {} as unknown as AttendanceService, notificationsStub)
  const manage = new ManageService(ctx.prisma, ctx.audit, {} as SessionsService, {} as SiteService, notificationsStub, ctx.env)
  const catalog = new CatalogService(ctx.prisma)
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  it('a center registers with its kind; without one it is a learning center', async () => {
    const t = await ctx.makeTenant('kind-register')
    await TenantContext.forTenant(t.tenantId, async () => {
      const reg = (login: string, centerKind?: 'UNIVERSITY') => accounts.register(t.tenantId, { role: 'CENTER', login, password: 'center-password-1', centerName: `Markaz ${login}`, centerKind }, {})
      const uni = await reg('kind.uni', 'UNIVERSITY')
      const plain = await reg('kind.plain')
      expect((await db.center.findUniqueOrThrow({ where: { id: uni.user.centerId! } })).kind).toBe('UNIVERSITY')
      expect((await db.center.findUniqueOrThrow({ where: { id: plain.user.centerId! } })).kind).toBe('TRAINING_CENTER')
    })
  })

  it('the center changes its kind in the settings (audited); the Super Admin sets it too; the catalog answers it', async () => {
    const t = await ctx.makeTenant('kind-settings')
    await TenantContext.forTenant(t.tenantId, async () => {
      const admin = await db.user.create({ data: { tenantId: t.tenantId, login: `kind-admin-${t.tenantId.slice(0, 6)}`, displayName: 'Admin', roles: ['CENTER_ADMIN'], centerId: t.center.id } })
      const actor: RequestActor = { id: admin.id, roles: ['CENTER_ADMIN'], centerId: t.center.id }
      const saved = await centers.updateProfile(t.tenantId, actor, { kind: 'TECHNIKUM' })
      expect(saved).toMatchObject({ kind: 'TECHNIKUM' })
      const audit = await db.auditEvent.findFirstOrThrow({ where: { action: 'center.profile', entityId: t.center.id }, orderBy: { createdAt: 'desc' } })
      expect(audit).toMatchObject({ before: { kind: 'TRAINING_CENTER' }, after: { kind: 'TECHNIKUM' } })

      const center = await db.center.findUniqueOrThrow({ where: { id: t.center.id } })
      await manage.upsertCenter(t.tenantId, { name: center.name, kind: 'UNIVERSITY', district: center.district as never, description: center.description as never }, center.id)
      // Without a kind the Super Admin's save keeps the one the center has.
      await manage.upsertCenter(t.tenantId, { name: center.name, district: center.district as never, description: center.description as never }, center.id)
      expect((await manage.listCenters(t.tenantId)).find((c) => c.id === center.id)).toMatchObject({ kind: 'UNIVERSITY' })

      const pub = await catalog.publicCatalog(t.tenantId)
      expect(pub.centers.find((c) => c.id === center.id)).toMatchObject({ kind: 'UNIVERSITY' })
    })
  })
})
