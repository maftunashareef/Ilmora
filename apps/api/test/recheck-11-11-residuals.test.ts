import 'reflect-metadata'
import { Body, Controller, type ExecutionContext, type INestApplication, Module, Post } from '@nestjs/common'
import { APP_FILTER, APP_GUARD, NestFactory } from '@nestjs/core'
import { ThrottlerModule } from '@nestjs/throttler'
import request from 'supertest'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { normalizeUzPhone, registrySearchKey } from '@ilmora/shared'
import { isAuthThrottled, isLoginThrottled, LoginThrottle, Public } from '../src/common/decorators'
import { AppError } from '../src/common/errors'
import { AppExceptionFilter } from '../src/common/filters/app-exception.filter'
import { AppThrottlerGuard } from '../src/common/guards'
import { throttlers } from '../src/common/throttlers'
import { validateEnv } from '../src/config/env'
import { RedisService } from '../src/infra/redis/redis.service'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { AccountService } from '../src/modules/auth/account.service'
import { AuthController } from '../src/modules/auth/auth.controller'
import { AuthService } from '../src/modules/auth/auth.service'
import { MfaService } from '../src/modules/auth/mfa.service'
import { OtpService } from '../src/modules/auth/otp.service'
import { CompaniesService } from '../src/modules/companies/companies.service'
import { EnrollmentController } from '../src/modules/enrollment/enrollment.controller'
import { SubscriptionService } from '../src/modules/enrollment/subscription.service'
import { InstitutionsService } from '../src/modules/institutions/institutions.service'
import { ManageService } from '../src/modules/manage/manage.service'
import type { SessionsService } from '../src/modules/sessions/sessions.service'
import type { SiteService } from '../src/modules/site/site.service'
import { DB_AVAILABLE, TestContext, testEnv } from './helpers'
import { notificationsStub } from './stubs'

/** The residues of the 11.11 recheck behind «⚠️ частично» on №4, №12, №17, №19: №73, №74, №75, №76, №82, №84. */

describe('№75: limits per address no longer shut a center’s Wi-Fi', () => {
  let app: INestApplication | undefined
  afterEach(async () => { await app?.close(); app = undefined })
  const route = (cls: object, name: string) => ({ getHandler: () => (cls as { prototype: Record<string, unknown> }).prototype[name], getClass: () => cls }) as unknown as ExecutionContext

  it('sign-in counts per address and login; checkout and password change count per account', () => {
    expect(isLoginThrottled(route(AuthController, 'login'))).toBe(true)
    expect(isAuthThrottled(route(EnrollmentController, 'checkout'))).toBe(false)
    expect(isAuthThrottled(route(AuthController, 'changePassword'))).toBe(false)
  })

  const start = async (perIp: number) => {
    @Controller('auth')
    class LoginOnly {
      @Public()
      @LoginThrottle(3)
      @Post('login')
      login(@Body() _b: unknown) { return { ok: true } }
    }
    @Module({
      imports: [ThrottlerModule.forRoot({ throttlers: throttlers(testEnv({ RATE_LIMIT_AUTH_PER_MINUTE: '1000', RATE_LIMIT_LOGIN_PER_IP_MINUTE: String(perIp) })) })],
      controllers: [LoginOnly],
      providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }, { provide: APP_FILTER, useClass: AppExceptionFilter }],
    })
    class LoginModule {}
    const created = await NestFactory.create(LoginModule, { logger: false })
    await created.init()
    app = created
    return created
  }
  const login = (a: INestApplication, name: string) => request(a.getHttpServer()).post('/auth/login').send({ login: name, password: 'x' })

  it('one login guessed too often is shut — for that login only; the others on the same address go on', async () => {
    const a = await start(1000)
    for (let i = 0; i < 3; i++) expect((await login(a, 'aziz')).status).toBe(201)
    const shut = await login(a, 'aziz')
    expect(shut.status).toBe(429)
    // The answer tells the real wait — the 5-minute block, not «60 s».
    expect(Number(shut.headers['retry-after'])).toBeGreaterThan(60)
    expect(shut.body.error.details.retryAfterSeconds).toBe(Number(shut.headers['retry-after']))
    for (let i = 0; i < 20; i++) expect((await login(a, `student-${i}`)).status).toBe(201)
    expect((await login(a, ' AZIZ ')).status).toBe(429)
  })

  it('the wide per-address limit still stops one address trying many logins', async () => {
    const a = await start(5)
    for (let i = 0; i < 5; i++) await login(a, `guess-${i}`)
    expect((await login(a, 'guess-x')).status).toBe(429)
  })
})

describe('№82: a long seat hold is not taken in production', () => {
  const prod = (over: Record<string, string | undefined> = {}) => validateEnv({
    ...process.env, NODE_ENV: 'production', CORS_ORIGINS: 'https://ilmora.uz', COOKIE_SECURE: 'true', REDIS_MODE: 'redis', SMS_PROVIDER: 'console',
    SMS_ALLOW_CONSOLE_IN_PRODUCTION: 'true', TOTP_ENCRYPTION_KEY: 'test-totp-key-test-totp-key-test-totp-key-12', ...over,
  })

  it('PAYMENT_EXPIRES_HOURS=168 holds seats an hour in production; development keeps what is set', () => {
    expect(prod({ PAYMENT_EXPIRES_HOURS: '168' }).PAYMENT_EXPIRES_HOURS).toBe(1)
    expect(prod({}).PAYMENT_EXPIRES_HOURS).toBe(1)
    expect(testEnv({ PAYMENT_EXPIRES_HOURS: '168' }).PAYMENT_EXPIRES_HOURS).toBe(168)
  })
})

describe.skipIf(!DB_AVAILABLE)('The 11.11 recheck residues: password reset, sandbox holds, deleted representatives', () => {
  const ctx = new TestContext()
  const env = testEnv({ TOTP_ENCRYPTION_KEY: 'test-totp-key-test-totp-key-test-totp-key-12', REDIS_MODE: 'off' })
  const redis = new RedisService(env)
  const mfa = new MfaService(ctx.prisma, ctx.tokens, ctx.audit, redis, env)
  const accounts = new AccountService(ctx.prisma, ctx.tokens, ctx.audit, redis, notificationsStub, env, mfa)
  const otpStub = { verify: async (_t: string, phone: string, code: string) => { if (code !== '123456') throw AppError.invalid('invalid_code', 'x'); const p = normalizeUzPhone(phone); return { phoneE164: p.ok ? p.e164 : phone } } } as unknown as OtpService
  const auth = new AuthService(ctx.prisma, otpStub, ctx.tokens, ctx.audit, accounts, env, mfa)
  const meta = { ip: '127.0.0.1', userAgent: 'vitest' }
  const phone = () => `+99890${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  it('№73, №74: «Забыли пароль?» says plainly when the number is not a sign-in phone or its account has no password', async () => {
    const t = await ctx.makeTenant('res-reset')
    await TenantContext.forTenant(t.tenantId, async () => {
      // No account signs in with this number (accounts made with a login have none linked).
      await expect(auth.resetPasswordBySms(t.tenantId, { phone: phone(), code: '123456', newPassword: 'new-password-1' }, meta)).rejects.toMatchObject({ code: 'phone_not_linked', status: 404 })
      // An account opened by SMS, no login, never a password: nothing to reset — it signs in by SMS.
      const p = phone()
      const smsOnly = await ctx.prisma.client.user.create({ data: { tenantId: t.tenantId, phoneE164: p, phoneVerifiedAt: new Date(), displayName: p, roles: ['STUDENT'] } })
      await expect(auth.resetPasswordBySms(t.tenantId, { phone: p, code: '123456', newPassword: 'new-password-1' }, meta)).rejects.toMatchObject({ code: 'no_password_to_reset' })
      expect((await ctx.prisma.client.user.findUniqueOrThrow({ where: { id: smsOnly.id } })).passwordHash).toBeNull()
      // An SMS account that set a password before resets it as usual.
      await ctx.prisma.client.user.update({ where: { id: smsOnly.id }, data: { passwordHash: 'x' } })
      expect(await auth.resetPasswordBySms(t.tenantId, { phone: p, code: '123456', newPassword: 'new-password-1' }, meta)).toMatchObject({ user: expect.objectContaining({ id: smsOnly.id }) })
    })
  })

  it('№76: in production without an SMS provider no code is issued — 503, not «sent»', async () => {
    const t = await ctx.makeTenant('res-sms')
    const sms = { enqueue: async () => undefined }
    const prodOtp = new OtpService(ctx.prisma, redis, sms as never, { ...env, NODE_ENV: 'production', SMS_PROVIDER: 'console' })
    await TenantContext.forTenant(t.tenantId, async () => {
      const p = phone()
      await expect(prodOtp.request(t.tenantId, p, 'ru', { ip: '127.0.0.1' })).rejects.toMatchObject({ code: 'sms_unavailable', status: 503 })
      expect(await ctx.prisma.client.otpCode.count({ where: { phoneE164: p } })).toBe(0)
    })
  })

  it('№82: a Payme test order keeps its seats while listed; any other expires after its hour', async () => {
    const t = await ctx.makeTenant('res-sandbox')
    const a = await ctx.makeStudent(t.tenantId)
    const b = await ctx.makeStudent(t.tenantId)
    const { payment: test } = await ctx.checkout(t.tenantId, a.id, t.pkg.id, [t.group.id, t.group2.id])
    const { payment: live } = await ctx.checkout(t.tenantId, b.id, t.pkg.id, [t.group.id, t.group2.id])
    await TenantContext.forTenant(t.tenantId, async () => {
      await ctx.prisma.client.payment.updateMany({ where: { id: { in: [test.id, live.id] } }, data: { expiresAt: new Date(Date.now() - 60_000) } })
      const subs = new SubscriptionService(ctx.prisma, ctx.audit, notificationsStub, testEnv({ PAYME_SANDBOX_PAYMENT_IDS: test.id }))
      expect(await subs.expirePending(t.tenantId)).toBe(1)
      const state = async (id: string) => (await ctx.prisma.client.payment.findUniqueOrThrow({ where: { id } })).state
      expect(await state(test.id)).toBe('PENDING')
      expect(await state(live.id)).toBe('EXPIRED')
    })
  })

  it('№83: a hijacker released by the Super Admin cannot take the company straight back from its real owner', async () => {
    const t = await ctx.makeTenant('res-reclaim')
    const db = ctx.prisma.client
    const companies = new CompaniesService(ctx.prisma, ctx.audit, notificationsStub, {} as never)
    const account = async (name: string) => ({ id: (await db.user.create({ data: { tenantId: t.tenantId, login: `${name}-${Date.now()}`, displayName: name, roles: ['COMPANY_ADMIN'] } })).id, roles: ['COMPANY_ADMIN'] as const })
    await TenantContext.forTenant(t.tenantId, async () => {
      // An old record: created a month ago, so «14 days since creation» has long passed.
      const co = await db.company.create({ data: { tenantId: t.tenantId, stir: '409999993', name: 'Haqiqiy Co', searchKey: registrySearchKey('Haqiqiy Co'), createdAt: new Date(Date.now() - 30 * 86_400_000) } })
      const hijacker = await account('hijacker')
      await companies.create(t.tenantId, hijacker as never, { stir: '409999993', name: 'Soxta' })
      expect((await db.company.findUniqueOrThrow({ where: { id: co.id } })).claimedAt).not.toBeNull()
      await companies.release(t.tenantId, co.id, 'hijacked')
      expect((await db.company.findUniqueOrThrow({ where: { id: co.id } })).claimedAt).toBeNull()
      // The real company claims it; the hijacker, with a new account, types the same STIR at once.
      const owner = await account('owner')
      await companies.create(t.tenantId, owner as never, { stir: '409999993', name: 'Haqiqiy Co' })
      const again = await account('hijacker2')
      await expect(companies.create(t.tenantId, again as never, { stir: '409999993', name: 'Soxta' })).rejects.toMatchObject({ code: 'company_registered' })
      expect((await db.user.findUniqueOrThrow({ where: { id: owner.id } })).companyId).toBe(co.id)
      // A draft its representative really left: abandoned 14 days after the claim, not before.
      await db.company.update({ where: { id: co.id }, data: { claimedAt: new Date(Date.now() - 15 * 86_400_000) } })
      await companies.create(t.tenantId, again as never, { stir: '409999993', name: 'Yangi' })
      expect((await db.user.findUniqueOrThrow({ where: { id: again.id } })).companyId).toBe(co.id)
    })
  })

  it('№84: deleting a representative lets the institution or company go; «Отвязать» finds a deleted one', async () => {
    const t = await ctx.makeTenant('res-delete')
    const db = ctx.prisma.client
    const manage = new ManageService(ctx.prisma, ctx.audit, {} as SessionsService, {} as SiteService, notificationsStub, ctx.env)
    const institutions = new InstitutionsService(ctx.prisma, ctx.audit, notificationsStub)
    const companies = new CompaniesService(ctx.prisma, ctx.audit, notificationsStub, {} as never)
    const admin = { id: 'admin', roles: ['PLATFORM_ADMIN' as const], centerId: null }
    await TenantContext.forTenant(t.tenantId, async () => {
      const region = await db.region.create({ data: { tenantId: t.tenantId, code: `r${Date.now()}`, name: { uz: 'R', ru: 'R', en: 'R' } } })
      const inst = await db.institution.create({ data: { tenantId: t.tenantId, type: 'TECHNIKUM', name: 'Rasmiy texnikum', searchKey: registrySearchKey('Rasmiy texnikum'), regionId: region.id, source: 'IMPORT', status: 'APPROVED', approvedAt: new Date(), claimedAt: new Date() } })
      const co = await db.company.create({ data: { tenantId: t.tenantId, stir: '409999991', name: 'Soft Co', searchKey: registrySearchKey('Soft Co'), status: 'APPROVED', approvedAt: new Date() } })
      const instRep = await db.user.create({ data: { tenantId: t.tenantId, login: `inst-${Date.now()}`, displayName: 'Rep', roles: ['INSTITUTION_ADMIN'], institutionId: inst.id } })
      const coRep = await db.user.create({ data: { tenantId: t.tenantId, login: `co-${Date.now()}`, displayName: 'Rep', roles: ['COMPANY_ADMIN'], companyId: co.id } })
      await manage.deleteUser(t.tenantId, admin, instRep.id, 'test')
      await manage.deleteUser(t.tenantId, admin, coRep.id, 'test')
      expect(await db.institution.findUniqueOrThrow({ where: { id: inst.id }, select: { status: true, approvedAt: true } })).toEqual({ status: 'UNCLAIMED', approvedAt: null })
      expect((await db.company.findUniqueOrThrow({ where: { id: co.id } })).status).toBe('DRAFT')
      const gone = await TenantContext.system(() => db.user.findMany({ where: { id: { in: [instRep.id, coRep.id] } }, select: { institutionId: true, companyId: true }, includeDeleted: true } as never))
      expect(gone).toEqual([{ institutionId: null, companyId: null }, { institutionId: null, companyId: null }])

      // A record held by an account deleted before this fix: «Отвязать» lets it go instead of answering 404.
      await db.institution.update({ where: { id: inst.id }, data: { status: 'APPROVED', approvedAt: new Date() } })
      const old = await db.user.create({ data: { tenantId: t.tenantId, login: `old-${Date.now()}`, displayName: 'Old', roles: ['INSTITUTION_ADMIN'], institutionId: inst.id, deletedAt: new Date(), isActive: false } })
      await institutions.release(t.tenantId, inst.id, 'deleted account')
      expect((await db.institution.findUniqueOrThrow({ where: { id: inst.id } })).status).toBe('UNCLAIMED')
      expect((await TenantContext.system(() => db.user.findFirst({ where: { id: old.id }, select: { institutionId: true }, includeDeleted: true } as never)))).toEqual({ institutionId: null })
      await db.company.update({ where: { id: co.id }, data: { status: 'APPROVED', approvedAt: new Date() } })
      await db.user.create({ data: { tenantId: t.tenantId, login: `oldco-${Date.now()}`, displayName: 'Old', roles: ['COMPANY_ADMIN'], companyId: co.id, deletedAt: new Date(), isActive: false } })
      await companies.release(t.tenantId, co.id, 'deleted account')
      expect((await db.company.findUniqueOrThrow({ where: { id: co.id } })).status).toBe('DRAFT')
    })
  })
})
