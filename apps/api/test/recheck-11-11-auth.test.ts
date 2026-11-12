import 'reflect-metadata'
import argon2 from 'argon2'
import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'
import type { NextFunction, Response } from 'express'
import { firstValueFrom, NEVER, Subject, toArray } from 'rxjs'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AuthenticatedRequest } from '../src/common/decorators'
import { uniqueConstraintOf } from '../src/common/errors'
import { MAX_STREAMS_PER_ACCOUNT, openStreams, sessionBound } from '../src/common/live-stream'
import { RequestContextMiddleware } from '../src/common/request-context.middleware'
import { totpAt, stepOf } from '../src/common/totp'
import { RedisService } from '../src/infra/redis/redis.service'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { scrub, scrubBody } from '../src/instrument'
import { AccountService, PASSWORD_HASH } from '../src/modules/auth/account.service'
import { AuthService } from '../src/modules/auth/auth.service'
import { MfaService } from '../src/modules/auth/mfa.service'
import type { OtpService } from '../src/modules/auth/otp.service'
import { RefundListQuery } from '../src/modules/enrollment/refunds.dto'
import { ManageController } from '../src/modules/manage/manage.controller'
import type { TenantsService } from '../src/modules/tenants/tenants.service'
import { DB_AVAILABLE, TestContext, testEnv } from './helpers'
import { notificationsStub } from './stubs'

/** Re-check 11.11 of the security review: sign-in and accounts (№35, №89–№92, №96, №97, sign-up limits for Google and SMS). */
describe('Re-check 11.11: sign-in, without a database', () => {
  it('№35: reads the unique constraint from Prisma 7 (the adapter\'s error) and from older engines (meta.target)', () => {
    const prisma7 = { code: 'P2002', meta: { modelName: 'Center', driverAdapterError: { cause: { kind: 'UniqueConstraintViolation', constraint: { index: 'Center_tenantId_slug_key' } } } } }
    expect(uniqueConstraintOf(prisma7)).toContain('slug')
    expect(uniqueConstraintOf({ code: 'P2002', meta: { driverAdapterError: { cause: { constraint: { fields: ['tenantId', 'slug'] } } } } })).toContain('slug')
    expect(uniqueConstraintOf({ code: 'P2002', meta: { target: ['tenantId', 'login'] } })).toBe('tenantId login')
    expect(uniqueConstraintOf({ code: 'P2002', meta: { target: 'User_tenantId_login_key' } })).not.toContain('slug')
    expect(uniqueConstraintOf(new Error('x'))).toBe('')
  })

  it('№96: passwords, tokens, secrets and phones never go to Sentry, whatever the key is called or however the body is held', () => {
    const body = { currentPassword: 'old-pass-1', newPassword: 'new-pass-2', idToken: 'g-token', challenge: 'c', recoveryCode: 'abcd-efgh', contactPhone: '+998901112233', nested: { refreshToken: 'r', clientSecret: 's' }, login: 'aziz', reason: 'ok' }
    const out = JSON.stringify(scrub(body))
    for (const secret of ['old-pass-1', 'new-pass-2', 'g-token', 'abcd-efgh', '+998901112233', '"r"', '"s"']) expect(out).not.toContain(secret)
    expect(out).toContain('aziz')
    expect(out).toContain('"reason":"ok"')
    // Sentry may keep the raw JSON text of the request.
    const asText = scrubBody(JSON.stringify(body)) as string
    expect(asText).not.toContain('new-pass-2')
    expect(asText).toContain('aziz')
    expect(scrubBody('password=hunter2&login=aziz')).toBe('[Filtered]')
  })

  it('№97: an unknown queue is 404, a page number past 10 000 is 400 — not 500', async () => {
    const queue = (name: string) => ({ name, getJob: async () => undefined })
    const controller = new ManageController({} as never, {} as never, queue('sms') as never, queue('sessions') as never, queue('outbox') as never)
    await expect(controller.retry('no-such-queue', '1')).rejects.toMatchObject({ code: 'not_found' })
    await expect(controller.retry('sms', '1')).resolves.toEqual({ ok: false })
    expect(validateSync(plainToInstance(RefundListQuery, { page: '100000000000000000000' }))).not.toHaveLength(0)
    expect(validateSync(plainToInstance(RefundListQuery, { page: '10000' }))).toHaveLength(0)
  })

  describe('№92: a live stream lives as long as its session', () => {
    const request = (userId: string, session: { expiresAt: number; stillCurrent: () => Promise<boolean> }) => {
      const listeners: (() => void)[] = []
      const req = { actor: { id: userId }, session, once: (_e: string, fn: () => void) => listeners.push(fn) } as unknown as AuthenticatedRequest
      return { req, close: () => listeners.forEach((fn) => fn()) }
    }

    it('ends when the account no longer matches the token (password changed, account disabled)', async () => {
      let current = true
      const { req } = request('u-stream-1', { expiresAt: Date.now() + 60_000, stillCurrent: async () => current })
      const events = new Subject<number>()
      const done = firstValueFrom(sessionBound(req, 'test', events, 20).pipe(toArray()))
      events.next(1)
      await new Promise((r) => setTimeout(r, 50))
      events.next(2)
      current = false
      expect(await done).toEqual([1, 2])
      expect(openStreams('test', 'u-stream-1')).toBe(0)
    })

    it('ends when the access token expires', async () => {
      const { req } = request('u-stream-2', { expiresAt: Date.now() + 30, stillCurrent: async () => true })
      expect(await firstValueFrom(sessionBound(req, 'test', NEVER, 60_000).pipe(toArray()))).toEqual([])
    })

    it(`holds at most ${MAX_STREAMS_PER_ACCOUNT} per account; a closed one gives its place back`, () => {
      const session = { expiresAt: Date.now() + 60_000, stillCurrent: async () => true }
      const opened = Array.from({ length: MAX_STREAMS_PER_ACCOUNT }, () => request('u-stream-3', session))
      const subs = opened.map(({ req }) => sessionBound(req, 'test', NEVER).subscribe())
      expect(() => sessionBound(request('u-stream-3', session).req, 'test', NEVER)).toThrow(expect.objectContaining({ code: 'rate_limited' }))
      // Another account is not affected.
      sessionBound(request('u-stream-4', session).req, 'test', NEVER).subscribe().unsubscribe()
      subs[0].unsubscribe()
      opened[1].close() // the client left: released once, whichever comes first
      subs[1].unsubscribe()
      expect(openStreams('test', 'u-stream-3')).toBe(MAX_STREAMS_PER_ACCOUNT - 2)
      expect(() => sessionBound(request('u-stream-3', session).req, 'test', NEVER).subscribe()).not.toThrow()
      subs.forEach((s) => s.unsubscribe())
    })
  })
})

describe.skipIf(!DB_AVAILABLE)('Re-check 11.11: sign-in and accounts', () => {
  const ctx = new TestContext()
  const db = ctx.prisma.client
  const env = testEnv({ TOTP_ENCRYPTION_KEY: 'test-totp-key-test-totp-key-test-totp-key-12', REDIS_MODE: 'off', RATE_LIMIT_REGISTER_PER_IP_HOUR: '3' })
  const redis = new RedisService(env)
  const mfa = new MfaService(ctx.prisma, ctx.tokens, ctx.audit, redis, env)
  const accounts = new AccountService(ctx.prisma, ctx.tokens, ctx.audit, redis, notificationsStub, env, mfa)
  const otp = { verify: async (_t: string, phone: string) => ({ phoneE164: phone }) } as unknown as OtpService
  const auth = new AuthService(ctx.prisma, otp, ctx.tokens, ctx.audit, accounts, env, mfa)
  let ipSeq = 0
  /** Every test signs up from its own address, so the per-address budget of one does not touch another. */
  const meta = () => ({ ip: `10.11.0.${++ipSeq}`, userAgent: 'vitest' })
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  const withPassword = async (label: string, roles: string[] = ['STUDENT']) => {
    const t = await ctx.makeTenant(label)
    const inT = <T>(fn: () => Promise<T>) => TenantContext.forTenant(t.tenantId, fn)
    const passwordHash = await argon2.hash('first-password-1', PASSWORD_HASH)
    const user = await inT(() => db.user.create({ data: { tenantId: t.tenantId, login: `${label}.user`, passwordHash, displayName: label, roles } as never }))
    return { ...t, inT, user: user as { id: string; login: string } }
  }

  /** The middleware's answer for a token: undefined when it passes, the error otherwise. */
  const mw = new RequestContextMiddleware(ctx.tokens, {} as TenantsService, ctx.prisma)
  const check = async (token: string) => {
    let error: unknown = 'none'
    await mw.use({ headers: { authorization: `Bearer ${token}` }, url: '/v1/me', originalUrl: '/v1/me' } as unknown as AuthenticatedRequest, {} as Response, ((e?: unknown) => { error = e }) as NextFunction)
    return error
  }

  it('№35: two centers of one name registered at once both get an account and a center', async () => {
    const t = await ctx.makeTenant('rc-35')
    const m = meta()
    const reg = (login: string) => TenantContext.forTenant(t.tenantId, () => accounts.register(t.tenantId, { role: 'CENTER', login, password: 'center-password-1', centerName: 'Bir xil markaz' }, m))
    await reg('center.one')
    const first = await TenantContext.forTenant(t.tenantId, () => db.center.findFirstOrThrow({ where: { tenantId: t.tenantId, name: 'Bir xil markaz' }, select: { slug: true } }))
    // The race made certain: the second registration looked for a free address before the first one saved its center.
    const lookup = vi.spyOn(accounts as unknown as { freeCenterSlug: () => Promise<string> }, 'freeCenterSlug').mockResolvedValueOnce(first.slug)
    await expect(reg('center.two')).resolves.toMatchObject({ accessToken: expect.any(String) })
    expect(lookup).toHaveBeenCalledTimes(2) // tried again, not «login taken»
    lookup.mockRestore()
    const centers = await TenantContext.forTenant(t.tenantId, () => db.center.findMany({ where: { tenantId: t.tenantId, name: 'Bir xil markaz' }, select: { slug: true } }))
    expect(new Set(centers.map((c) => c.slug)).size).toBe(2)
    // A login really taken is still «login taken».
    await expect(reg('center.two')).rejects.toMatchObject({ code: 'login_taken' })
  })

  it('№90: one\'s own password change ends every token signed before it at once; the new one works', async () => {
    const s = await withPassword('rc-90')
    const before = await s.inT(() => accounts.loginWithPassword(s.tenantId, { login: s.user.login, password: 'first-password-1' }, meta()))
    if (!('accessToken' in before)) throw new Error('expected a session')
    expect(await check(before.accessToken)).toBeUndefined() // the account is now in the cache
    const changed = await s.inT(() => accounts.changePassword({ id: s.user.id, tenantId: s.tenantId }, { currentPassword: 'first-password-1', newPassword: 'second-password-2' }, meta()))
    expect(await check(before.accessToken)).toMatchObject({ code: 'invalid_token' })
    expect(await check(changed.accessToken)).toBeUndefined()
    // A reset by SMS or by the Super Admin changes the password the same way: the database is the judge.
    await s.inT(() => db.user.update({ where: { id: s.user.id }, data: { passwordHash: 'another-hash' } }))
    expect(await check(changed.accessToken)).toBeUndefined() // within ACTOR_CHECK_MS of the cache…
    const { forgetAccountState } = await import('../src/common/request-context.middleware')
    forgetAccountState(s.user.id)
    expect(await check(changed.accessToken)).toMatchObject({ code: 'invalid_token' }) // …and refused once it is read
  })

  it('№91: guessing the current password in «Сменить пароль» is locked like the sign-in, and shares its lock', async () => {
    const s = await withPassword('rc-91')
    const change = (currentPassword: string) => s.inT(() => accounts.changePassword({ id: s.user.id, tenantId: s.tenantId }, { currentPassword, newPassword: 'second-password-2' }, meta()))
    for (let i = 0; i < env.LOGIN_MAX_FAILURES; i++) await expect(change(`wrong-password-${i}`)).rejects.toMatchObject({ code: 'wrong_password' })
    // Past the limit even the right password answers 429 — here and at the sign-in.
    await expect(change('first-password-1')).rejects.toMatchObject({ code: 'rate_limited' })
    await expect(s.inT(() => accounts.loginWithPassword(s.tenantId, { login: s.user.login, password: 'first-password-1' }, meta()))).rejects.toMatchObject({ code: 'rate_limited' })
  })

  it('№89: a sign-in step from before a password reset no longer links an authenticator app', async () => {
    const s = await withPassword('rc-89', ['MINISTRY'])
    const first = await s.inT(() => accounts.loginWithPassword(s.tenantId, { login: s.user.login, password: 'first-password-1' }, meta()))
    if (!('mfaRequired' in first)) throw new Error('expected a challenge')
    const { secret } = await s.inT(() => auth.mfaSetup(first.challenge))
    // The Super Admin resets the password (someone else knew the first one).
    const resetHash = await argon2.hash('reset-password-2', PASSWORD_HASH)
    await s.inT(() => db.user.update({ where: { id: s.user.id }, data: { passwordHash: resetHash, passwordIssuedAt: new Date() } }))
    await expect(s.inT(() => auth.mfaSetup(first.challenge))).rejects.toMatchObject({ code: 'invalid_challenge' })
    await expect(s.inT(() => auth.mfaConfirm(first.challenge, totpAt(secret, stepOf(new Date())), meta()))).rejects.toMatchObject({ code: 'invalid_challenge' })
    expect((await s.inT(() => db.user.findUniqueOrThrow({ where: { id: s.user.id } }))).totpEnabledAt).toBeNull()
    // With the new password the step starts again and works.
    const again = await s.inT(() => accounts.loginWithPassword(s.tenantId, { login: s.user.login, password: 'reset-password-2' }, meta()))
    if (!('mfaRequired' in again)) throw new Error('expected a challenge')
    const fresh = await s.inT(() => auth.mfaSetup(again.challenge))
    await expect(s.inT(() => auth.mfaConfirm(again.challenge, totpAt(fresh.secret, stepOf(new Date())), meta()))).resolves.toMatchObject({ recoveryCodes: expect.any(Array) })
  })

  it('new accounts by Google and by SMS count against the per-address sign-up limit; signing in to an existing account does not', async () => {
    const t = await ctx.makeTenant('rc-signup')
    const inT = <T>(fn: () => Promise<T>) => TenantContext.forTenant(t.tenantId, fn)
    const m = meta()
    const google = (n: number) => inT(() => accounts.loginWithGoogle(t.tenantId, { googleId: `g-signup-${n}`, email: `signup${n}@gmail.com`, emailVerified: true, displayName: `Signup ${n}` }, m))
    const sms = (phone: string) => inT(() => auth.verifyOtp(t.tenantId, { phone, code: '000000' }, m))
    // The limit is 3 an hour here: a password sign-up, a Google one and an SMS one.
    await inT(() => accounts.register(t.tenantId, { role: 'STUDENT', login: 'signup.password', password: 'student-password-1' }, m))
    await google(1)
    await sms('+998901230001')
    // The fourth new account from this address — by any way — is refused.
    await expect(google(2)).rejects.toMatchObject({ code: 'rate_limited' })
    await expect(sms('+998901230002')).rejects.toMatchObject({ code: 'rate_limited' })
    expect(await inT(() => db.user.count({ where: { tenantId: t.tenantId, OR: [{ googleId: 'g-signup-2' }, { phoneE164: '+998901230002' }] } }))).toBe(0)
    // Those who already have an account sign in as usual.
    await expect(google(1)).resolves.toMatchObject({ accessToken: expect.any(String) })
    await expect(sms('+998901230001')).resolves.toMatchObject({ accessToken: expect.any(String) })
    // Another address has its own budget.
    await expect(inT(() => accounts.loginWithGoogle(t.tenantId, { googleId: 'g-signup-3', email: 'signup3@gmail.com', emailVerified: true, displayName: 'Signup 3' }, meta()))).resolves.toMatchObject({ accessToken: expect.any(String) })
  })
})
