import 'reflect-metadata'
import argon2 from 'argon2'
import { Reflector } from '@nestjs/core'
import type { NextFunction, Response } from 'express'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ROLES_KEY, type AuthenticatedRequest } from '../src/common/decorators'
import { sha256 } from '../src/common/crypto'
import { RequestContextMiddleware } from '../src/common/request-context.middleware'
import { normalizeRecoveryCode, stepOf, totpAt } from '../src/common/totp'
import { RedisService } from '../src/infra/redis/redis.service'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { AccountService, PASSWORD_HASH } from '../src/modules/auth/account.service'
import { AuthService } from '../src/modules/auth/auth.service'
import { MFA_MAX_FAILURES, MfaService } from '../src/modules/auth/mfa.service'
import { EnrollmentController } from '../src/modules/enrollment/enrollment.controller'
import { SavedController } from '../src/modules/enrollment/saved.controller'
import { ManageService } from '../src/modules/manage/manage.service'
import type { SessionsService } from '../src/modules/sessions/sessions.service'
import type { SiteService } from '../src/modules/site/site.service'
import type { TenantsService } from '../src/modules/tenants/tenants.service'
import { DB_AVAILABLE, TestContext, testEnv } from './helpers'
import { notificationsStub } from './stubs'

describe('Student-only routes (security review 10.11 №32)', () => {
  it('cart, checkout, renewal and saved items are for students only', () => {
    const reflector = new Reflector()
    expect(reflector.get(ROLES_KEY, EnrollmentController)).toEqual(['STUDENT'])
    expect(reflector.get(ROLES_KEY, SavedController)).toEqual(['STUDENT'])
  })
})

describe.skipIf(!DB_AVAILABLE)('Small fixes of the security review 10.11: sign-in, roles, isolation (№27–№37)', () => {
  const ctx = new TestContext()
  const db = ctx.prisma.client
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())
  const meta = { ip: '127.0.0.1', userAgent: 'vitest' }

  const env = testEnv({ TOTP_ENCRYPTION_KEY: 'test-totp-key-test-totp-key-test-totp-key-12', REDIS_MODE: 'off' })
  const redis = new RedisService(env)
  const mfa = new MfaService(ctx.prisma, ctx.tokens, ctx.audit, redis, env)
  const accounts = new AccountService(ctx.prisma, ctx.tokens, ctx.audit, redis, notificationsStub, env, mfa)
  const auth = new AuthService(ctx.prisma, {} as never, ctx.tokens, ctx.audit, accounts, env, mfa)

  /** A ministry account with the app linked; returns its secret and the first session. */
  const ministry = async (label: string) => {
    const t = await ctx.makeTenant(label)
    const inT = <T>(fn: () => Promise<T>) => TenantContext.forTenant(t.tenantId, fn)
    const passwordHash = await argon2.hash('ministry-password-1', PASSWORD_HASH)
    await inT(() => db.user.create({ data: { tenantId: t.tenantId, login: 'min.user', passwordHash, displayName: 'min', roles: ['MINISTRY'] } }))
    const login = async () => {
      const r = await inT(() => accounts.loginWithPassword(t.tenantId, { login: 'min.user', password: 'ministry-password-1' }, meta))
      if (!('mfaRequired' in r)) throw new Error('expected a challenge')
      return r.challenge
    }
    const first = await login()
    const { secret } = await inT(() => auth.mfaSetup(first))
    const done = await inT(() => auth.mfaConfirm(first, totpAt(secret, stepOf(new Date())), meta))
    return { ...t, inT, login, secret, done }
  }

  it('№27: the same code sent twice at once opens one session', async () => {
    const m = await ministry('d1-replay')
    const challenge = await m.login()
    const code = totpAt(m.secret, stepOf(new Date()) + 1)
    const results = await Promise.allSettled([1, 2, 3].map(() => m.inT(() => auth.mfaVerify(challenge, code, meta))))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
  })

  it('№28: a session opened with the code ends after 12 hours, however often it is renewed', async () => {
    const m = await ministry('d1-session')
    const renewed = await auth.refresh(m.done.refresh.raw, meta)
    await m.inT(() => db.refreshSession.updateMany({ where: { userId: m.done.user.id }, data: { createdAt: new Date(Date.now() - 13 * 3_600_000) } }))
    await expect(auth.refresh(renewed.refresh.raw, meta)).rejects.toMatchObject({ code: 'invalid_refresh' })
  })

  it('№37: recovery codes are kept keyed, not as a bare SHA-256; codes stored the old way still work once', async () => {
    const m = await ministry('d1-recovery')
    const userId = m.done.user.id
    const code = m.done.recoveryCodes[0]
    const stored = await m.inT(() => db.totpRecoveryCode.findMany({ where: { userId } }))
    expect(stored.map((r) => r.codeHash)).not.toContain(sha256(normalizeRecoveryCode(code)))
    await m.inT(() => db.totpRecoveryCode.create({ data: { tenantId: m.tenantId, userId, codeHash: sha256('oldcode2') } }))
    expect((await m.inT(async () => auth.mfaVerify(await m.login(), 'oldc-ode2', meta))).user.id).toBe(userId)
    await expect(m.inT(async () => auth.mfaVerify(await m.login(), 'oldc-ode2', meta))).rejects.toMatchObject({ code: 'invalid_code' })
  })

  it('№36: no edit crosses into another organization, moves a row there, or touches a deleted row', async () => {
    const a = await ctx.makeTenant('d1-iso-a')
    const b = await ctx.makeTenant('d1-iso-b')
    // updateManyAndReturn is filtered by the tenant like updateMany.
    const changed = await TenantContext.forTenant(a.tenantId, () => db.course.updateManyAndReturn({ where: { id: { in: [a.course.id, b.course.id] } }, data: { priceMinor: 1n } }))
    expect(changed.map((c) => c.id)).toEqual([a.course.id])
    expect((await TenantContext.system(() => db.course.findUniqueOrThrow({ where: { id: b.course.id } }))).priceMinor).toBe(50_000_00n)
    // tenantId in an update payload is refused.
    await expect(TenantContext.forTenant(a.tenantId, () => db.course.update({ where: { id: a.course.id }, data: { tenantId: b.tenantId } }))).rejects.toThrow(/another tenant/)
    await expect(TenantContext.forTenant(a.tenantId, () => db.course.updateMany({ where: { id: a.course.id }, data: { tenantId: b.tenantId } }))).rejects.toThrow(/another tenant/)
    // A soft-deleted course is not edited by its id.
    await TenantContext.forTenant(a.tenantId, () => db.course.update({ where: { id: a.course2.id }, data: { deletedAt: new Date() } }))
    await expect(TenantContext.forTenant(a.tenantId, () => db.course.update({ where: { id: a.course2.id }, data: { priceMinor: 1n } }))).rejects.toMatchObject({ code: 'P2025' })
  })

  it('№31: no checkout or renewal before the student accepts the current offer', async () => {
    const t = await ctx.makeTenant('d1-offer')
    const student = await ctx.makeStudent(t.tenantId)
    await TenantContext.system(() => db.user.update({ where: { id: student.id }, data: { offerVersion: 'old' } }))
    await expect(ctx.checkout(t.tenantId, student.id, t.pkg.id, [t.group.id, t.group2.id])).rejects.toMatchObject({ code: 'offer_required' })
  })

  it('№29: a disabled account or one with other roles loses access without waiting for its token to expire', async () => {
    const t = await ctx.makeTenant('d1-actor')
    const student = await ctx.makeStudent(t.tenantId)
    const middleware = () => new RequestContextMiddleware(ctx.tokens, {} as TenantsService, ctx.prisma)
    const run = async (mw: RequestContextMiddleware, token: string) => {
      let error: unknown = 'none'
      const req = { headers: { authorization: `Bearer ${token}` }, url: '/v1/me', originalUrl: '/v1/me' } as unknown as AuthenticatedRequest
      await mw.use(req, {} as Response, ((err?: unknown) => { error = err }) as NextFunction)
      return error
    }
    const token = await ctx.tokens.signAccess({ id: student.id, tenantId: t.tenantId, roles: ['STUDENT'] })
    expect(await run(middleware(), token)).toBeUndefined()
    // A token claiming more than the account has.
    const forged = await ctx.tokens.signAccess({ id: student.id, tenantId: t.tenantId, roles: ['STUDENT', 'CENTER_ADMIN'] })
    expect(await run(middleware(), forged)).toMatchObject({ code: 'invalid_token' })
    await TenantContext.system(() => db.user.update({ where: { id: student.id }, data: { isActive: false } }))
    expect(await run(middleware(), token)).toMatchObject({ code: 'invalid_token' })
  })

  it('review 11.11: a token whose center or organisation changed, or issued before a password reset, is refused; a token issued after a change of roles passes at once', async () => {
    const t = await ctx.makeTenant('d1-claims')
    const student = await ctx.makeStudent(t.tenantId)
    const mw = new RequestContextMiddleware(ctx.tokens, {} as TenantsService, ctx.prisma)
    const run = async (token: string) => {
      let error: unknown = 'none'
      await mw.use({ headers: { authorization: `Bearer ${token}` }, url: '/v1/me', originalUrl: '/v1/me' } as unknown as AuthenticatedRequest, {} as Response, ((err?: unknown) => { error = err }) as NextFunction)
      return error
    }
    const sign = (extra: object = {}) => ctx.tokens.signAccess({ id: student.id, tenantId: t.tenantId, roles: ['STUDENT'], ...extra })
    expect(await run(await sign())).toBeUndefined()
    // Roles granted: the cached state says STUDENT, the new token says STUDENT + TEACHER — read again, not refused.
    await TenantContext.system(() => db.user.update({ where: { id: student.id }, data: { roles: ['STUDENT', 'TEACHER'] } }))
    expect(await run(await sign({ roles: ['STUDENT', 'TEACHER'] }))).toBeUndefined()
    // Another center than the token says (the account is read again within ACTOR_CHECK_MS — a fresh process here).
    await TenantContext.system(() => db.user.update({ where: { id: student.id }, data: { centerId: t.center.id } }))
    let stale: unknown = 'none'
    await new RequestContextMiddleware(ctx.tokens, {} as TenantsService, ctx.prisma).use({ headers: { authorization: `Bearer ${await sign({ roles: ['STUDENT', 'TEACHER'] })}` }, url: '/v1/me', originalUrl: '/v1/me' } as unknown as AuthenticatedRequest, {} as Response, ((e?: unknown) => { stale = e }) as NextFunction)
    expect(stale).toMatchObject({ code: 'invalid_token' })
    expect(await run(await sign({ roles: ['STUDENT', 'TEACHER'], centerId: t.center.id }))).toBeUndefined()
    // The Super Admin reset the password: a token without «change it first» no longer works.
    await TenantContext.system(() => db.user.update({ where: { id: student.id }, data: { passwordIssuedAt: new Date() } }))
    const fresh = new RequestContextMiddleware(ctx.tokens, {} as TenantsService, ctx.prisma)
    let err: unknown = 'none'
    await fresh.use({ headers: { authorization: `Bearer ${await sign({ roles: ['STUDENT', 'TEACHER'], centerId: t.center.id })}` }, url: '/v1/me', originalUrl: '/v1/me' } as unknown as AuthenticatedRequest, {} as Response, ((e?: unknown) => { err = e }) as NextFunction)
    expect(err).toMatchObject({ code: 'invalid_token' })
  })

  it('review 11.11: a Super Admin deletes a user whose teacher profile was deleted before', async () => {
    const t = await ctx.makeTenant('d1-delprofile')
    await TenantContext.system(() => db.teacherProfile.update({ where: { id: t.teacher.id }, data: { deletedAt: new Date() } }))
    const manage = new ManageService(ctx.prisma, ctx.audit, {} as SessionsService, {} as SiteService, notificationsStub, ctx.env)
    await TenantContext.forTenant(t.tenantId, () => manage.deleteUser(t.tenantId, { id: 'admin', roles: ['PLATFORM_ADMIN'], centerId: null }, t.teacherUser.id, 'test'))
    expect(((await TenantContext.system(() => db.teacherProfile.findFirstOrThrow({ where: { id: t.teacher.id }, includeDeleted: true } as never))) as { userId: string | null }).userId).toBeNull()
  })

  it('review 11.11: changing the password does not restart the 12 hours of a session opened with the code', async () => {
    const m = await ministry('d1-pwchange')
    const user = await m.inT(() => db.user.findFirstOrThrow({ where: { login: 'min.user' } }))
    await m.inT(() => db.refreshSession.updateMany({ where: { userId: user.id }, data: { createdAt: new Date(Date.now() - 11 * 3_600_000) } }))
    const changed = await m.inT(() => accounts.changePassword({ id: user.id, tenantId: m.tenantId }, { currentPassword: 'ministry-password-1', newPassword: 'ministry-password-2' }, meta))
    const started = await m.inT(() => db.refreshSession.findFirstOrThrow({ where: { userId: user.id, revokedAt: null }, select: { createdAt: true } }))
    expect(Date.now() - started.createdAt.getTime()).toBeGreaterThan(10.9 * 3_600_000)
    await m.inT(() => db.refreshSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { createdAt: new Date(Date.now() - 13 * 3_600_000) } }))
    await expect(auth.refresh(changed.refresh.raw, meta)).rejects.toMatchObject({ code: 'invalid_refresh' })
  })

  it('review 11.11: wrong codes sent at once are counted before they are checked — the lock holds', async () => {
    const m = await ministry('d1-burst')
    const challenge = await m.login()
    const burst = await Promise.allSettled(Array.from({ length: MFA_MAX_FAILURES + 5 }, () => m.inT(() => auth.mfaVerify(challenge, '000001', meta))))
    const limited = burst.filter((r) => r.status === 'rejected' && (r.reason as { code?: string }).code === 'rate_limited')
    expect(limited.length).toBeGreaterThanOrEqual(5)
  })

  it('№30: a deleted account keeps no Google link: the same Google account can register again', async () => {
    const t = await ctx.makeTenant('d1-google')
    const student = await ctx.makeStudent(t.tenantId)
    await TenantContext.system(() => db.user.update({ where: { id: student.id }, data: { googleId: `g-${student.id}` } }))
    const manage = new ManageService(ctx.prisma, ctx.audit, {} as SessionsService, {} as SiteService, notificationsStub, ctx.env)
    await TenantContext.forTenant(t.tenantId, () => manage.deleteUser(t.tenantId, { id: 'admin', roles: ['PLATFORM_ADMIN'], centerId: null }, student.id, 'test'))
    const row = await TenantContext.system(() => db.user.findFirstOrThrow({ where: { id: student.id }, includeDeleted: true } as never))
    expect(row).toMatchObject({ googleId: null, isActive: false })
  })
})
