import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Env } from '../src/config/env'
import { ZodValidationPipe } from '../src/common/zod.pipe'
import type { PrismaService } from '../src/infra/prisma/prisma.service'
import { TenantContext, type RequestActor } from '../src/infra/tenancy/tenant-context'
import type { AuditInput, AuditService } from '../src/modules/audit/audit.service'
import type { AccountService } from '../src/modules/auth/account.service'
import type { MfaService } from '../src/modules/auth/mfa.service'
import type { TokenService } from '../src/modules/auth/token.service'
import { CenterManagersService } from '../src/modules/center/center-managers.service'
import { MinistryAccountsService } from '../src/modules/ministry/ministry-accounts.service'
import { UserRolesInput } from '../src/modules/manage/manage.schemas'
import { ManageService } from '../src/modules/manage/manage.service'
import type { SessionsService } from '../src/modules/sessions/sessions.service'
import type { SiteService } from '../src/modules/site/site.service'
import { DB_AVAILABLE, TestContext } from './helpers'
import { notificationsStub } from './stubs'

/**
 * Decision «2026-10 ILMORA — два Super Admin»: Super Admin (isOwner → PLATFORM_ADMIN + FINANCE_ADMIN) is granted and
 * revoked only by the owner-setup command on the server. PUT /admin/users/:id/roles can neither grant nor revoke it.
 */
const superAdmin: RequestActor = { id: 'sa', roles: ['PLATFORM_ADMIN', 'FINANCE_ADMIN'] }

describe('Super Admin only via owner-setup: the roles input', () => {
  const pipe = new ZodValidationPipe(UserRolesInput)
  it('does not accept PLATFORM_ADMIN', () => {
    expect(() => pipe.transform({ roles: ['PLATFORM_ADMIN'], reason: 'make owner' })).toThrow()
    expect(() => pipe.transform({ roles: ['STUDENT', 'PLATFORM_ADMIN'], reason: 'make owner' })).toThrow()
  })
  it('accepts the ordinary roles', () => {
    expect(pipe.transform({ roles: ['TEACHER', 'FINANCE_ADMIN'], reason: 'new duties' })).toEqual({ roles: ['TEACHER', 'FINANCE_ADMIN'], reason: 'new duties' })
  })
})

type Row = { id: string; tenantId: string; login: string | null; displayName: string; roles: string[]; centerId: string | null; isActive: boolean; isOwner: boolean; teacherProfile: { id: string } | null }

describe('Super Admin only via owner-setup: setRoles', () => {
  /** `inTx` is the row as the transaction reads it under the lock (owner-setup may have changed it since the first read). */
  const setup = (target: Partial<Row>, inTx: Partial<Row> = {}) => {
    const user: Row = { id: 'u1', tenantId: 't', login: 'u1', displayName: 'U', roles: ['STUDENT'], centerId: null, isActive: true, isOwner: false, teacherProfile: { id: 'tp' }, ...target }
    const locked = { ...user, ...inTx }
    const writes: Record<string, unknown>[] = []
    const revoked: unknown[] = []
    const audits: AuditInput[] = []
    const locks: string[] = []
    const tx = {
      $queryRawUnsafe: async (sql: string) => (locks.push(sql), []),
      user: { findFirst: async () => locked, update: async ({ data }: { data: Record<string, unknown> }) => (writes.push(data), { ...locked, ...data }) },
      refreshSession: { updateMany: async (a: unknown) => (revoked.push(a), { count: 1 }) },
      teacherProfile: { create: async () => ({}) },
    }
    const client = { user: { findFirst: async () => user }, center: { findFirst: async () => ({ id: 'c1' }) }, $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) }
    const audit = { record: async (a: AuditInput) => void audits.push(a) }
    const service = new ManageService({ client } as unknown as PrismaService, audit as unknown as AuditService, {} as unknown as SessionsService, {} as unknown as SiteService, notificationsStub, {} as unknown as Env)
    return { service, writes, revoked, audits, locks }
  }

  it('refuses to grant Super Admin to a non-owner, writes nothing and audits the attempt', async () => {
    const { service, writes, audits } = setup({})
    await expect(service.setRoles('t', superAdmin, 'u1', { roles: ['PLATFORM_ADMIN', 'STUDENT'], reason: 'make owner' } as never)).rejects.toMatchObject({ code: 'owner_server_only' })
    expect(writes).toEqual([])
    expect(audits).toEqual([expect.objectContaining({ action: 'user.roles.denied', entityId: 'u1', reason: 'make owner', after: { roles: ['PLATFORM_ADMIN', 'STUDENT'], code: 'owner_server_only' } })])
    const status = await service.setRoles('t', superAdmin, 'u1', { roles: ['PLATFORM_ADMIN'], reason: 'again' } as never).catch((e: { getStatus: () => number }) => e.getStatus())
    expect(status).toBe(403)
  })

  it('the center finds its managers without owners and finance admins', async () => {
    const wheres: unknown[] = []
    const client = { center: { findFirst: async () => ({ id: 'c1', status: 'ACTIVE' }) }, user: { findFirst: async ({ where }: { where: unknown }) => (wheres.push(where), null) } }
    const managers = new CenterManagersService({ client } as unknown as PrismaService, {} as AuditService, {} as AccountService, {} as TokenService)
    const centerAdmin: RequestActor = { id: 'ca', roles: ['CENTER_ADMIN'], centerId: 'c1' }
    await expect(managers.setActive('t', centerAdmin, 'owner', false)).rejects.toMatchObject({ code: 'not_found' })
    await expect(managers.resetPassword('t', centerAdmin, 'owner')).rejects.toMatchObject({ code: 'not_found' })
    for (const where of wheres) expect(where).toMatchObject({ roles: { has: 'CENTER_MANAGER' }, isOwner: false, NOT: { roles: { hasSome: ['PLATFORM_ADMIN', 'FINANCE_ADMIN'] } } })
    expect(wheres).toHaveLength(2)
  })

  it('blocking or unblocking a ministry or company account keeps its role', async () => {
    for (const kept of ['MINISTRY', 'COMPANY_ADMIN', 'INSTITUTION_ADMIN']) {
      const { service, writes } = setup({ roles: [kept] })
      // What the accounts page sends: only the site roles, here none.
      await service.setRoles('t', superAdmin, 'u1', { roles: [], isActive: false, reason: 'Blocked by the Super Admin' })
      await service.setRoles('t', superAdmin, 'u1', { roles: [], isActive: true, reason: 'Unblocked by the Super Admin' })
      expect(writes).toEqual([{ roles: [kept], centerId: null, isActive: false }, { roles: [kept], centerId: null, isActive: true }])
    }
    const { service, writes } = setup({ roles: ['COMPANY_ADMIN', 'STUDENT'] })
    await service.setRoles('t', superAdmin, 'u1', { roles: ['STUDENT', 'TEACHER'], reason: 'teaches too' })
    expect(writes[0].roles).toEqual(['STUDENT', 'TEACHER', 'COMPANY_ADMIN'])
  })

  it('an account is never left without roles', async () => {
    const { service, writes } = setup({})
    await expect(service.setRoles('t', superAdmin, 'u1', { roles: [], reason: 'nothing' })).rejects.toMatchObject({ code: 'no_roles' })
    expect(writes).toEqual([])
  })

  it('an owner or a finance admin is never a center administrator or manager', async () => {
    for (const [target, roles] of [
      [{ isOwner: true, roles: ['PLATFORM_ADMIN', 'FINANCE_ADMIN'] }, ['CENTER_MANAGER']],
      [{ isOwner: true, roles: ['PLATFORM_ADMIN', 'FINANCE_ADMIN'] }, ['CENTER_ADMIN']],
      [{}, ['FINANCE_ADMIN', 'CENTER_MANAGER']],
      [{}, ['FINANCE_ADMIN', 'CENTER_ADMIN']],
    ] as [Partial<Row>, ('CENTER_MANAGER' | 'CENTER_ADMIN' | 'FINANCE_ADMIN')[]][]) {
      const { service, writes } = setup(target)
      await expect(service.setRoles('t', superAdmin, 'u1', { roles, centerId: 'c1', reason: 'center role' })).rejects.toMatchObject({ code: 'privileged_center_role' })
      expect(writes).toEqual([])
    }
  })

  it('follows the row as locked in the transaction: an owner made meanwhile by owner-setup keeps the pair', async () => {
    const { service, writes, locks } = setup({}, { isOwner: true, roles: ['PLATFORM_ADMIN', 'FINANCE_ADMIN', 'STUDENT'] })
    await service.setRoles('t', superAdmin, 'u1', { roles: ['STUDENT', 'TEACHER'], reason: 'teaches' })
    expect(locks).toEqual(['SELECT id FROM "User" WHERE id = $1 FOR UPDATE'])
    expect([...(writes[0].roles as string[])].sort()).toEqual(['FINANCE_ADMIN', 'PLATFORM_ADMIN', 'STUDENT', 'TEACHER'])
  })

  it('self, delete and password reset answer with their own codes', async () => {
    const { service } = setup({ id: 'sa' })
    await expect(service.setRoles('t', superAdmin, 'u1', { roles: ['STUDENT'], reason: 'mine' })).rejects.toMatchObject({ code: 'self_roles' })
    const owner = setup({ isOwner: true, roles: ['PLATFORM_ADMIN', 'FINANCE_ADMIN'] })
    await expect(owner.service.deleteUser('t', superAdmin, 'u1', 'remove owner')).rejects.toMatchObject({ code: 'owner_protected' })
    const ministry = new MinistryAccountsService({ client: { user: { findFirst: async () => ({ id: 'u1', isOwner: true, login: 'o' }) } } } as unknown as PrismaService, {} as AuditService, {} as AccountService, {} as MfaService, {} as TokenService)
    await expect(ministry.resetAccountPassword('t', superAdmin, 'u1')).rejects.toMatchObject({ code: 'owner_protected' })
  })

  it('refuses to send PLATFORM_ADMIN for an owner too', async () => {
    const { service, writes } = setup({ isOwner: true, roles: ['PLATFORM_ADMIN', 'FINANCE_ADMIN'] })
    await expect(service.setRoles('t', superAdmin, 'u1', { roles: ['PLATFORM_ADMIN'], reason: 'keep' } as never)).rejects.toMatchObject({ code: 'owner_server_only' })
    expect(writes).toEqual([])
  })

  it('never revokes Super Admin: an owner keeps PLATFORM_ADMIN + FINANCE_ADMIN and the owner flag', async () => {
    const { service, writes, revoked } = setup({ isOwner: true, roles: ['PLATFORM_ADMIN', 'FINANCE_ADMIN', 'TEACHER'] })
    const r = await service.setRoles('t', superAdmin, 'u1', { roles: ['STUDENT'], reason: 'drop super admin' })
    expect(writes).toHaveLength(1)
    expect(writes[0]).not.toHaveProperty('isOwner')
    expect([...(writes[0].roles as string[])].sort()).toEqual(['FINANCE_ADMIN', 'PLATFORM_ADMIN', 'STUDENT'])
    expect(r.roles).toContain('PLATFORM_ADMIN')
    // TEACHER was taken away: the sessions end so the token loses it.
    expect(revoked).toHaveLength(1)
  })

  it('refuses to block an owner', async () => {
    const { service, writes } = setup({ isOwner: true, roles: ['PLATFORM_ADMIN', 'FINANCE_ADMIN'] })
    await expect(service.setRoles('t', superAdmin, 'u1', { roles: ['FINANCE_ADMIN'], isActive: false, reason: 'block owner' })).rejects.toMatchObject({ code: 'owner_protected' })
    expect(writes).toEqual([])
  })

  it('a non-owner with a stale PLATFORM_ADMIN in the column loses it and never becomes an owner', async () => {
    const { service, writes, revoked } = setup({ roles: ['PLATFORM_ADMIN', 'STUDENT'] })
    await service.setRoles('t', superAdmin, 'u1', { roles: ['STUDENT'], reason: 'clean up' })
    expect(writes[0]).toMatchObject({ roles: ['STUDENT'] })
    expect(writes[0]).not.toHaveProperty('isOwner')
    expect(revoked).toHaveLength(1)
  })

  it('ordinary role changes still work and are audited', async () => {
    const { service, writes, revoked, audits } = setup({})
    const r = await service.setRoles('t', superAdmin, 'u1', { roles: ['STUDENT', 'TEACHER', 'CENTER_ADMIN'], centerId: 'c1', reason: 'center admin' })
    expect(r).toMatchObject({ id: 'u1', roles: ['STUDENT', 'TEACHER', 'CENTER_ADMIN'], centerId: 'c1', isActive: true })
    expect(writes).toEqual([{ roles: ['STUDENT', 'TEACHER', 'CENTER_ADMIN'], centerId: 'c1', isActive: true }])
    expect(revoked).toEqual([])
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ action: 'user.roles', entityId: 'u1', reason: 'center admin', after: { isOwner: false } })
  })
})

describe.skipIf(!DB_AVAILABLE)('Super Admin only via owner-setup (database)', () => {
  const ctx = new TestContext()
  const manage = new ManageService(ctx.prisma, ctx.audit, {} as SessionsService, {} as SiteService, notificationsStub, ctx.env)
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  it('the API neither grants nor revokes the owner flag', async () => {
    const t = await ctx.makeTenant('sa-server-only')
    await TenantContext.forTenant(t.tenantId, async () => {
      const db = ctx.prisma.client
      const actor = await db.user.create({ data: { tenantId: t.tenantId, login: 'sa-actor', displayName: 'Actor', roles: ['PLATFORM_ADMIN', 'FINANCE_ADMIN'], isOwner: true } })
      const other = await db.user.create({ data: { tenantId: t.tenantId, login: 'sa-other', displayName: 'Other', roles: ['PLATFORM_ADMIN', 'FINANCE_ADMIN'], isOwner: true } })
      const plain = await db.user.create({ data: { tenantId: t.tenantId, login: 'sa-plain', displayName: 'Plain', roles: ['STUDENT'] } })
      const me: RequestActor = { id: actor.id, roles: ['PLATFORM_ADMIN', 'FINANCE_ADMIN'] }

      await expect(manage.setRoles(t.tenantId, me, plain.id, { roles: ['PLATFORM_ADMIN'], reason: 'make owner' } as never)).rejects.toMatchObject({ code: 'owner_server_only' })
      expect(await db.user.findUniqueOrThrow({ where: { id: plain.id } })).toMatchObject({ isOwner: false, roles: ['STUDENT'] })

      await manage.setRoles(t.tenantId, me, other.id, { roles: ['STUDENT'], reason: 'drop super admin' })
      const kept = await db.user.findUniqueOrThrow({ where: { id: other.id } })
      expect(kept.isOwner).toBe(true)
      expect([...kept.roles].sort()).toEqual(['FINANCE_ADMIN', 'PLATFORM_ADMIN', 'STUDENT'])

      await manage.setRoles(t.tenantId, me, plain.id, { roles: ['TEACHER', 'STUDENT'], reason: 'teaches now' })
      expect(await db.user.findUniqueOrThrow({ where: { id: plain.id } })).toMatchObject({ isOwner: false, roles: ['TEACHER', 'STUDENT'] })
      expect(await db.auditEvent.count({ where: { action: 'user.roles', entityId: plain.id } })).toBe(1)
    })
  })
})
