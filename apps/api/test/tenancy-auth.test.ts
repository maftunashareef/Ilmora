import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { REFRESH_RACE_MS } from '../src/modules/auth/token.service'
import { DB_AVAILABLE, TestContext } from './helpers'

describe.skipIf(!DB_AVAILABLE)('tenant isolation (Prisma extension)', () => {
  const ctx = new TestContext()
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  it('queries inside tenant A never see tenant B rows, even with explicit ids', async () => {
    const a = await ctx.makeTenant('iso-a')
    const b = await ctx.makeTenant('iso-b')
    const inA = <T>(fn: () => Promise<T>) => TenantContext.forTenant(a.tenantId, fn)
    expect(await inA(() => ctx.prisma.client.course.findMany({}))).toHaveLength(2)
    expect(await inA(() => ctx.prisma.client.course.findFirst({ where: { id: b.course.id } }))).toBeNull()
    expect(await inA(() => ctx.prisma.client.course.findUnique({ where: { id: b.course.id } }))).toBeNull()
    expect(await inA(() => ctx.prisma.client.course.count({}))).toBe(2)
    // updates are scoped too: touching a foreign row affects nothing
    const res = await inA(() => ctx.prisma.client.group.updateMany({ where: { id: b.group.id }, data: { capacity: 99 } }))
    expect(res.count).toBe(0)
    expect((await TenantContext.forTenant(b.tenantId, () => ctx.prisma.client.group.findFirst({ where: { id: b.group.id } })))?.capacity).toBe(2)
  })

  it('creates inherit the tenant from the context and fail without one', async () => {
    const a = await ctx.makeTenant('iso-c')
    const created = await TenantContext.forTenant(a.tenantId, () => ctx.prisma.client.category.create({ data: { slug: 'x', name: {} } as never }))
    expect(created.tenantId).toBe(a.tenantId)
    await expect(ctx.prisma.client.course.findMany({})).rejects.toThrow(/tenant context/i)
  })

  it('a tenantId sent in the data never moves a new row into another organization (Ж12)', async () => {
    const a = await ctx.makeTenant('iso-e')
    const b = await ctx.makeTenant('iso-f')
    const created = await TenantContext.forTenant(a.tenantId, () => ctx.prisma.client.category.create({ data: { tenantId: b.tenantId, slug: 'smuggled', name: {} } }))
    expect(created.tenantId).toBe(a.tenantId)
    const many = await TenantContext.forTenant(a.tenantId, () => ctx.prisma.client.category.createManyAndReturn({ data: [{ tenantId: b.tenantId, slug: 'smuggled-2', name: {} }] }))
    expect(many.map((r) => r.tenantId)).toEqual([a.tenantId])
    expect(await TenantContext.forTenant(b.tenantId, () => ctx.prisma.client.category.count({ where: { slug: { startsWith: 'smuggled' } } }))).toBe(0)
  })

  it('soft delete hides rows from normal reads but keeps them for includeDeleted', async () => {
    const a = await ctx.makeTenant('iso-d')
    await TenantContext.forTenant(a.tenantId, async () => {
      await ctx.prisma.client.course.update({ where: { id: a.course2.id }, data: { deletedAt: new Date() } })
      expect(await ctx.prisma.client.course.count({})).toBe(1)
      expect(await ctx.prisma.client.course.count({ includeDeleted: true } as never)).toBe(2)
    })
  })
})

describe.skipIf(!DB_AVAILABLE)('refresh token rotation and reuse detection', () => {
  const ctx = new TestContext()
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  it('rotates once; reusing the old value revokes the whole family', async () => {
    const t = await ctx.makeTenant('rt')
    const user = await ctx.makeStudent(t.tenantId, 80_001)
    const first = await ctx.tokens.issueRefresh(user.id, t.tenantId, { ip: '127.0.0.1' })
    const second = await ctx.tokens.rotate(first.raw, {})
    expect(second.userId).toBe(user.id)
    expect(second.raw).not.toBe(first.raw)
    // Two tabs at once: within REFRESH_RACE_MS the old value gets its own new one, nobody is signed out (Н5).
    const tab = await ctx.tokens.rotate(first.raw, {})
    expect(tab.raw).not.toBe(second.raw)
    // Later, replaying the first token is reuse → family revoked, including the fresh second token.
    await TenantContext.forTenant(t.tenantId, () => ctx.prisma.client.refreshSession.updateMany({ where: { userId: user.id, rotatedAt: { not: null } }, data: { rotatedAt: new Date(Date.now() - REFRESH_RACE_MS - 1000) } }))
    await expect(ctx.tokens.rotate(first.raw, {})).rejects.toMatchObject({ code: 'invalid_refresh' })
    await expect(ctx.tokens.rotate(tab.raw, {})).rejects.toMatchObject({ code: 'invalid_refresh' })
    await expect(ctx.tokens.rotate(second.raw, {})).rejects.toMatchObject({ code: 'invalid_refresh' })
    const sessions = await TenantContext.forTenant(t.tenantId, () => ctx.prisma.client.refreshSession.findMany({ where: { userId: user.id } }))
    expect(sessions.every((s) => s.revokedAt || s.rotatedAt)).toBe(true)
    expect(sessions.some((s) => s.revokedReason === 'reuse-detected')).toBe(true)
  })

  it('concurrent rotations of the same token (tabs at once) rotate it once and give every tab its own value', async () => {
    const t = await ctx.makeTenant('rt2')
    const user = await ctx.makeStudent(t.tenantId, 80_002)
    const first = await ctx.tokens.issueRefresh(user.id, t.tenantId, {})
    const results = await Promise.all([ctx.tokens.rotate(first.raw, {}), ctx.tokens.rotate(first.raw, {}), ctx.tokens.rotate(first.raw, {})])
    expect(new Set(results.map((r) => r.raw)).size).toBe(3)
    const sessions = await TenantContext.forTenant(t.tenantId, () => ctx.prisma.client.refreshSession.findMany({ where: { userId: user.id } }))
    expect(sessions.filter((s) => s.revokedAt)).toHaveLength(0)
    expect(sessions.filter((s) => s.replacedById)).toHaveLength(1)
  })

  it('signs and verifies access tokens with tenant and role claims', async () => {
    const token = await ctx.tokens.signAccess({ id: 'u1', tenantId: 't1', roles: ['STUDENT'], passwordHash: null })
    const claims = await ctx.tokens.verifyAccess(token)
    expect(claims).toMatchObject({ sub: 'u1', tid: 't1', roles: ['STUDENT'] })
    await expect(ctx.tokens.verifyAccess(`${token}x`)).rejects.toMatchObject({ code: 'invalid_token' })
  })
})
