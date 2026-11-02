import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { AppError } from '../src/common/errors'
import { RedisService } from '../src/infra/redis/redis.service'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { AccountService } from '../src/modules/auth/account.service'
import { DB_AVAILABLE, TestContext, testEnv } from './helpers'
import { notificationsStub } from './stubs'

const meta = { ip: '127.0.0.1', userAgent: 'vitest' }

describe.skipIf(!DB_AVAILABLE)('login + password accounts and the owner rule', () => {
  const ctx = new TestContext()
  // Three failures lock a login; Redis off keeps the counter in memory for the test process.
  const env = testEnv({ REDIS_MODE: 'off', LOGIN_MAX_FAILURES: '3', LOGIN_LOCK_SECONDS: '60' })
  const accounts = new AccountService(ctx.prisma, ctx.tokens, ctx.audit, new RedisService(env), notificationsStub, env)
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  it('registers a student and a teacher, normalizes the login and opens a session with the right roles', async () => {
    const t = await ctx.makeTenant('pw-a')
    const inT = <T>(fn: () => Promise<T>) => TenantContext.forTenant(t.tenantId, fn)
    const student = await inT(() => accounts.register(t.tenantId, { role: 'STUDENT', login: '  Aziz.Student ', password: 'correct horse battery', displayName: 'Aziz' }, meta))
    expect(student.user.login).toBe('aziz.student')
    expect(student.user.roles).toEqual(['STUDENT'])
    expect(student.user.teacherProfileId).toBeNull()
    expect((await ctx.tokens.verifyAccess(student.accessToken)).roles).toEqual(['STUDENT'])

    const teacher = await inT(() => accounts.register(t.tenantId, { role: 'TEACHER', login: 'Ustoz_1', password: 'another strong one', displayName: 'Ustoz' }, meta))
    expect(teacher.user.roles).toEqual(['TEACHER'])
    expect(teacher.user.teacherProfileId).not.toBeNull()
    const profile = await inT(() => ctx.prisma.client.teacherProfile.findFirst({ where: { userId: teacher.user.id } }))
    expect(profile).toMatchObject({ slug: 'ustoz-1', name: 'Ustoz', centerId: null }) // slugs use dashes

    // the same login (any casing) cannot be registered twice; the lookup is also case-insensitive
    await expect(inT(() => accounts.register(t.tenantId, { role: 'STUDENT', login: 'AZIZ.STUDENT', password: 'whatever works 1' }, meta))).rejects.toMatchObject({ code: 'login_taken' })
    const again = await inT(() => accounts.loginWithPassword(t.tenantId, { login: 'AZIZ.student', password: 'correct horse battery' }, meta))
    expect(again.user.id).toBe(student.user.id)
  })

  it('rejects privileged roles at registration and never stores a plaintext password', async () => {
    const t = await ctx.makeTenant('pw-b')
    const inT = <T>(fn: () => Promise<T>) => TenantContext.forTenant(t.tenantId, fn)
    await expect(inT(() => accounts.register(t.tenantId, { role: 'PLATFORM_ADMIN' as never, login: 'sneaky', password: 'long enough password' }, meta))).rejects.toMatchObject({ code: 'invalid_role' })
    const r = await inT(() => accounts.register(t.tenantId, { role: 'STUDENT', login: 'plain', password: 'long enough password' }, meta))
    const row = await inT(() => ctx.prisma.client.user.findUnique({ where: { id: r.user.id } }))
    expect(row?.passwordHash).toMatch(/^\$argon2id\$/)
    expect(row?.passwordHash).not.toContain('long enough password')
  })

  it('answers wrong passwords and unknown logins identically, then locks the login after repeated failures', async () => {
    const t = await ctx.makeTenant('pw-c')
    const inT = <T>(fn: () => Promise<T>) => TenantContext.forTenant(t.tenantId, fn)
    await inT(() => accounts.register(t.tenantId, { role: 'STUDENT', login: 'locked', password: 'the right password' }, meta))
    const wrong = await inT(() => accounts.loginWithPassword(t.tenantId, { login: 'locked', password: 'nope nope nope' }, meta)).catch((e: unknown) => e)
    const unknown = await inT(() => accounts.loginWithPassword(t.tenantId, { login: 'nobody-here', password: 'nope nope nope' }, meta)).catch((e: unknown) => e)
    expect(wrong).toMatchObject({ code: 'invalid_credentials' })
    expect(unknown).toMatchObject({ code: 'invalid_credentials' })
    expect((wrong as AppError).getStatus()).toBe(401)
    expect((unknown as AppError).getStatus()).toBe(401)
    await expect(inT(() => accounts.loginWithPassword(t.tenantId, { login: 'locked', password: 'still wrong' }, meta))).rejects.toMatchObject({ code: 'invalid_credentials' })
    await expect(inT(() => accounts.loginWithPassword(t.tenantId, { login: 'locked', password: 'still wrong' }, meta))).rejects.toMatchObject({ code: 'invalid_credentials' })
    // third failure reached the limit: even the correct password is refused until the lock expires
    await expect(inT(() => accounts.loginWithPassword(t.tenantId, { login: 'locked', password: 'the right password' }, meta))).rejects.toSatisfy((e) => (e as AppError).getStatus() === 429)
  })

  it('derives Super Admin from the owner flag only, and every owner gets it', async () => {
    const t = await ctx.makeTenant('pw-d')
    const sys = <T>(fn: () => Promise<T>) => TenantContext.system(fn)
    // a forged roles column does not grant admin claims
    const forged = await sys(() => ctx.prisma.client.user.create({ data: { tenantId: t.tenantId, login: 'forged', displayName: 'Forged', roles: ['PLATFORM_ADMIN', 'FINANCE_ADMIN', 'STUDENT'] } }))
    expect(await accounts.effectiveRoles(forged)).toEqual(['FINANCE_ADMIN', 'STUDENT'])
    const session = await TenantContext.forTenant(t.tenantId, () => accounts.openSession({ ...forged, teacherProfile: null }, meta))
    expect((await ctx.tokens.verifyAccess(session.accessToken)).roles).not.toContain('PLATFORM_ADMIN')

    // owners get Super Admin even if the column lacks it — two owners, both of them
    const first = await sys(() => ctx.prisma.client.user.create({ data: { tenantId: t.tenantId, login: 'owner', displayName: 'Owner', roles: ['STUDENT'], isOwner: true } }))
    const second = await sys(() => ctx.prisma.client.user.create({ data: { tenantId: t.tenantId, login: 'owner2', displayName: 'Owner 2', roles: [], isOwner: true } }))
    expect(await accounts.effectiveRoles(first)).toEqual(['STUDENT', 'PLATFORM_ADMIN', 'FINANCE_ADMIN'])
    expect(await accounts.effectiveRoles(second)).toEqual(['PLATFORM_ADMIN', 'FINANCE_ADMIN'])
    const ownerSession = await TenantContext.forTenant(t.tenantId, () => accounts.openSession({ ...second, teacherProfile: null }, meta))
    expect((await ctx.tokens.verifyAccess(ownerSession.accessToken)).roles).toContain('PLATFORM_ADMIN')
    expect(await accounts.effectiveRoles(forged)).not.toContain('PLATFORM_ADMIN')

    // losing the flag loses the claims at the next refresh
    const demoted = await sys(() => ctx.prisma.client.user.update({ where: { id: second.id }, data: { isOwner: false } }))
    expect(await accounts.effectiveRoles(demoted)).not.toContain('PLATFORM_ADMIN')
  })
})
