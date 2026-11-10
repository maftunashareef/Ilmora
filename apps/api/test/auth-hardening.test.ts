import 'reflect-metadata'
import type { ExecutionContext } from '@nestjs/common'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { AppError } from '../src/common/errors'
import { isAuthThrottled } from '../src/common/decorators'
import { AppThrottlerGuard } from '../src/common/guards'
import { RedisService } from '../src/infra/redis/redis.service'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { AccountService } from '../src/modules/auth/account.service'
import { MfaService } from '../src/modules/auth/mfa.service'
import { AuthController } from '../src/modules/auth/auth.controller'
import { AuthService } from '../src/modules/auth/auth.service'
import type { TokenService } from '../src/modules/auth/token.service'
import { ManageController } from '../src/modules/manage/manage.controller'
import { NotificationsController } from '../src/modules/notifications/notifications.controller'
import { DB_AVAILABLE, TestContext, testEnv } from './helpers'
import { notificationsStub, mfaStub } from './stubs'

const meta = { ip: '127.0.0.1', userAgent: 'vitest' }
const route = (cls: new (...a: never[]) => unknown, name: string) => ({ getHandler: () => (cls.prototype as Record<string, unknown>)[name], getClass: () => cls }) as unknown as ExecutionContext

describe('Ж1: the strict sign-in limit counts sign-in routes only, per client, never per phone typed in the body', () => {
  it('applies to sign-in, codes and registration, not to the workspace (which used to throw people out)', () => {
    for (const name of ['login', 'register', 'google', 'requestOtp', 'verifyOtp']) expect(isAuthThrottled(route(AuthController, name))).toBe(true)
    expect(isAuthThrottled(route(ManageController, 'mine'))).toBe(false)
    expect(isAuthThrottled(route(NotificationsController, 'list'))).toBe(false)
  })

  it('keys a visitor by address whatever phone the body names, and a signed-in user by account', async () => {
    const guard = Object.create(AppThrottlerGuard.prototype) as AppThrottlerGuard
    const tracker = (req: Record<string, unknown>) => (guard as unknown as { getTracker: (r: Record<string, unknown>) => Promise<string> }).getTracker(req)
    expect(await tracker({ ip: '10.0.0.7', body: { phone: '+998901111111' } })).toBe('ip:10.0.0.7')
    expect(await tracker({ ip: '10.0.0.7', body: { phone: '+998902222222' } })).toBe('ip:10.0.0.7')
    expect(await tracker({ ip: '10.0.0.7', actor: { id: 'u-1' } })).toBe('u:u-1')
  })
})

describe('Ж3: a Google token is accepted only when it was issued to our app', () => {
  afterEach(() => vi.unstubAllGlobals())
  const accounts = { loginWithGoogle: vi.fn(async () => ({ ok: true })) } as unknown as AccountService
  const service = (clientId?: string) => new AuthService({} as never, {} as never, {} as unknown as TokenService, {} as never, accounts, testEnv({ NODE_ENV: 'test', GOOGLE_CLIENT_ID: clientId ?? '' }), mfaStub)
  const tokeninfo = (aud: string) => vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ sub: 'g-1', email: 'a@b.uz', email_verified: true, name: 'A', aud }), { status: 200 })))

  it('refuses a token issued to another Google app', async () => {
    tokeninfo('someone-elses-app.apps.googleusercontent.com')
    await expect(service('ilmora.apps.googleusercontent.com').authenticateGoogle('t', { idToken: 'real-token' }, meta)).rejects.toMatchObject({ code: 'google_client_mismatch' })
    expect(accounts.loginWithGoogle).not.toHaveBeenCalled()
  })

  it('turns Google sign-in off when the server has no client id, instead of accepting any token', async () => {
    tokeninfo('anything')
    await expect(service().authenticateGoogle('t', { idToken: 'real-token' }, meta)).rejects.toMatchObject({ code: 'google_unconfigured' })
    expect(accounts.loginWithGoogle).not.toHaveBeenCalled()
  })

  it('accepts a token for our app', async () => {
    tokeninfo('ilmora.apps.googleusercontent.com')
    await expect(service('ilmora.apps.googleusercontent.com').authenticateGoogle('t', { idToken: 'real-token' }, meta)).resolves.toBeTruthy()
  })
})

describe('Ж8: sign-in, registration and codes answer only the site itself', () => {
  const env = testEnv({ CORS_ORIGINS: 'https://ilmora.uz' })
  const called: string[] = []
  const auth = { authenticateGoogle: async () => { called.push('google'); return result }, requestOtp: async () => { called.push('otp'); return { ok: true } }, verifyOtp: async () => { called.push('verify'); return result } }
  const accounts = { register: async () => { called.push('register'); return result }, loginWithPassword: async () => { called.push('login'); return result } }
  const result = { accessToken: 'a', expiresInSeconds: 1, user: {}, refresh: { raw: 'r', expiresAt: new Date() } }
  const tokens = { cookieOptions: () => ({}), flagCookieOptions: () => ({}) }
  const ctl = new AuthController(auth as never, accounts as never, tokens as never, env)
  const res = { cookie: () => undefined } as never
  const ci = { ip: '1.2.3.4', userAgent: 'x' } as never
  const req = (origin?: string) => ({ headers: origin ? { origin } : {} }) as never
  const calls = (r: never, xrw: string | undefined): (() => Promise<unknown>)[] => [
    () => ctl.login(r, 't', { login: 'a', password: 'b' } as never, ci, xrw, res),
    () => ctl.register(r, 't', {} as never, ci, xrw, res),
    () => ctl.google(r, 't', {} as never, ci, xrw, res),
    () => ctl.requestOtp(r, 't', { phone: '+998901234567' } as never, ci, xrw),
    () => ctl.verifyOtp(r, 't', {} as never, ci, xrw, res),
  ]

  it('refuses a form posted from another site (no custom header) and a request from a foreign origin', async () => {
    for (const call of calls(req('https://ilmora.uz'), undefined)) await expect(Promise.resolve().then(() => call())).rejects.toMatchObject({ details: { code: 'csrf' } })
    for (const call of calls(req('https://evil.example'), 'ilmora')) await expect(Promise.resolve().then(() => call())).rejects.toMatchObject({ details: { code: 'csrf' } })
    expect(called).toEqual([])
  })

  it('lets the site itself in', async () => {
    for (const call of calls(req('https://ilmora.uz'), 'ilmora')) await call()
    expect(called).toEqual(['login', 'register', 'google', 'otp', 'verify'])
  })
})

describe.skipIf(!DB_AVAILABLE)('Ж7, Ж15: password sign-in lock against PostgreSQL', () => {
  const ctx = new TestContext()
  const env = testEnv({ REDIS_MODE: 'off', LOGIN_MAX_FAILURES: '3', LOGIN_LOCK_SECONDS: '60' })
  const accounts = new AccountService(ctx.prisma, ctx.tokens, ctx.audit, new RedisService(env), notificationsStub, env, new MfaService(ctx.prisma, ctx.tokens, ctx.audit, new RedisService(env), env))
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  it('one phone written in different ways shares one lock (Ж7)', async () => {
    const t = await ctx.makeTenant('lock')
    const inT = <T>(fn: () => Promise<T>) => TenantContext.forTenant(t.tenantId, fn)
    const n = String(Math.floor(Math.random() * 9_000_000) + 1_000_000)
    const spellings = [`+998 93 ${n}`, `998-93-${n}`, `93${n}`, `(93) ${n.slice(0, 3)} ${n.slice(3)}`]
    for (const login of spellings.slice(0, 3)) await expect(inT(() => accounts.loginWithPassword(t.tenantId, { login, password: 'wrong wrong' }, meta))).rejects.toMatchObject({ code: 'invalid_credentials' })
    await expect(inT(() => accounts.loginWithPassword(t.tenantId, { login: spellings[3], password: 'wrong wrong' }, meta))).rejects.toSatisfy((e) => (e as AppError).getStatus() === 429)
  })

  it('a disabled account answers the right password exactly like a wrong one (Ж15)', async () => {
    const t = await ctx.makeTenant('dis')
    const inT = <T>(fn: () => Promise<T>) => TenantContext.forTenant(t.tenantId, fn)
    const login = `off${Math.floor(Math.random() * 1e6)}`
    const opened = await inT(() => accounts.register(t.tenantId, { role: 'STUDENT', login, password: 'the right password' }, meta))
    await TenantContext.system(() => ctx.prisma.client.user.update({ where: { id: opened.user.id }, data: { isActive: false } }), { tenantId: t.tenantId })
    const right = await inT(() => accounts.loginWithPassword(t.tenantId, { login, password: 'the right password' }, meta)).catch((e: unknown) => e)
    const wrong = await inT(() => accounts.loginWithPassword(t.tenantId, { login, password: 'not the password' }, meta)).catch((e: unknown) => e)
    expect(right).toMatchObject({ code: 'invalid_credentials' })
    expect((right as AppError).getStatus()).toBe((wrong as AppError).getStatus())
  })
})
