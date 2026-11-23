import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { normalizeUzPhone } from '@ilmora/shared'
import { AppError } from '../src/common/errors'
import { RedisService } from '../src/infra/redis/redis.service'
import { TenantContext, type RequestActor } from '../src/infra/tenancy/tenant-context'
import { AccountService } from '../src/modules/auth/account.service'
import { AuthService } from '../src/modules/auth/auth.service'
import { MfaService } from '../src/modules/auth/mfa.service'
import type { OtpService } from '../src/modules/auth/otp.service'
import { MinistryAccountsService } from '../src/modules/ministry/ministry-accounts.service'
import { DB_AVAILABLE, TestContext, testEnv } from './helpers'
import { notificationsStub } from './stubs'

/** Security review 10.11 №4: «забыл пароль» by an SMS code, and a password reset by the Super Admin for any account. */
describe.skipIf(!DB_AVAILABLE)('Forgotten passwords', () => {
  const ctx = new TestContext()
  const env = testEnv({ TOTP_ENCRYPTION_KEY: 'test-totp-key-test-totp-key-test-totp-key-12', REDIS_MODE: 'off' })
  const redis = new RedisService(env)
  const mfa = new MfaService(ctx.prisma, ctx.tokens, ctx.audit, redis, env)
  const accounts = new AccountService(ctx.prisma, ctx.tokens, ctx.audit, redis, notificationsStub, env, mfa)
  /** The SMS code is «123456» for any phone (OtpService itself is tested apart). */
  const otp = { verify: async (_t: string, phone: string, code: string) => { if (code !== '123456') throw AppError.invalid('invalid_code', 'x'); const p = normalizeUzPhone(phone); return { phoneE164: p.ok ? p.e164 : phone } } } as unknown as OtpService
  const auth = new AuthService(ctx.prisma, otp, ctx.tokens, ctx.audit, accounts, env, mfa)
  const admins = new MinistryAccountsService(ctx.prisma, ctx.audit, accounts, mfa, ctx.tokens)
  const meta = { ip: '127.0.0.1', userAgent: 'vitest' }
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  const setup = async (label: string) => {
    const t = await ctx.makeTenant(label)
    const inT = <T>(fn: () => Promise<T>) => TenantContext.forTenant(t.tenantId, fn)
    const phone = () => `+99890${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`
    const account = async (login: string, data: object = {}) => {
      const r = await inT(() => accounts.register(t.tenantId, { role: 'STUDENT', login, password: 'old-password-1' }, meta))
      const p = phone()
      await inT(() => ctx.prisma.client.user.update({ where: { id: r.user.id }, data: { phoneE164: p, ...data } }))
      return { id: r.user.id, login, phone: p }
    }
    return { ...t, inT, account }
  }

  it('«забыл пароль»: the SMS code to the account’s phone sets a new password, every old session ends, this one opens', async () => {
    const s = await setup('pw-sms')
    await s.inT(async () => {
      const me = await s.account(`sms${Math.floor(Math.random() * 1e6)}`)
      const old = await ctx.tokens.issueRefresh(me.id, s.tenantId, meta)
      await expect(auth.resetPasswordBySms(s.tenantId, { phone: me.phone, code: '000000', newPassword: 'new-password-1' }, meta)).rejects.toMatchObject({ code: 'invalid_code' })
      await expect(auth.resetPasswordBySms(s.tenantId, { phone: me.phone, code: '123456', newPassword: me.login }, meta)).rejects.toMatchObject({ code: 'password_is_login' })
      const done = await auth.resetPasswordBySms(s.tenantId, { phone: me.phone, code: '123456', newPassword: 'new-password-1' }, meta)
      expect(done.user).toMatchObject({ id: me.id, passwordChangeRequired: false })
      expect(await ctx.prisma.client.refreshSession.findFirstOrThrow({ where: { tokenHash: { not: '' }, userId: me.id, revokedAt: { not: null } } })).toBeTruthy()
      await expect(ctx.tokens.rotate(old.raw, meta)).rejects.toBeTruthy()
      await expect(accounts.loginWithPassword(s.tenantId, { login: me.login, password: 'old-password-1' }, meta)).rejects.toMatchObject({ code: 'invalid_credentials' })
      expect(await accounts.loginWithPassword(s.tenantId, { login: me.login, password: 'new-password-1' }, meta)).toMatchObject({ user: { id: me.id } })
      expect(await ctx.prisma.client.auditEvent.count({ where: { action: 'auth.password.reset', entityId: me.id } })).toBe(1)
      await expect(auth.resetPasswordBySms(s.tenantId, { phone: '+998901234500', code: '123456', newPassword: 'new-password-1' }, meta)).rejects.toMatchObject({ code: 'phone_not_linked', status: 404 })
    })
  })

  it('the ministry, the Super Admins and the finance admins never reset by SMS — with the authenticator key or without it', async () => {
    const s = await setup('pw-sms-mfa')
    // Review 11.11: without TOTP_ENCRYPTION_KEY the SMS path used to open for the owners and finance.
    const noKeyEnv = { ...testEnv({ REDIS_MODE: 'off' }), TOTP_ENCRYPTION_KEY: undefined }
    const noKeyMfa = new MfaService(ctx.prisma, ctx.tokens, ctx.audit, redis, noKeyEnv)
    const noKey = new AuthService(ctx.prisma, otp, ctx.tokens, ctx.audit, new AccountService(ctx.prisma, ctx.tokens, ctx.audit, redis, notificationsStub, noKeyEnv, noKeyMfa), noKeyEnv, noKeyMfa)
    await s.inT(async () => {
      for (const data of [{ roles: ['MINISTRY'] }, { roles: ['FINANCE_ADMIN'] }, { isOwner: true }]) {
        const acc = await s.account(`mfa${Math.floor(Math.random() * 1e6)}`, data)
        for (const a of [auth, noKey]) await expect(a.resetPasswordBySms(s.tenantId, { phone: acc.phone, code: '123456', newPassword: 'new-password-1' }, meta)).rejects.toMatchObject({ code: 'password_reset_by_admin' })
      }
    })
  })

  it('the Super Admin resets any account’s password: shown once, sessions end, a change is due at the next sign-in', async () => {
    const s = await setup('pw-admin')
    await s.inT(async () => {
      const owner = await s.account(`own${Math.floor(Math.random() * 1e6)}`, { isOwner: true })
      const sa = { id: owner.id, roles: ['PLATFORM_ADMIN'] } as RequestActor
      const me = await s.account(`stu${Math.floor(Math.random() * 1e6)}`)
      await ctx.tokens.issueRefresh(me.id, s.tenantId, meta)
      const { temporaryPassword } = await admins.resetAccountPassword(s.tenantId, sa, me.id)
      expect(temporaryPassword).toMatch(/^[A-Za-z2-9]{16}$/)
      expect(await ctx.prisma.client.refreshSession.count({ where: { userId: me.id, revokedAt: null } })).toBe(0)
      const signedIn = await accounts.loginWithPassword(s.tenantId, { login: me.login, password: temporaryPassword }, meta)
      expect(signedIn).toMatchObject({ user: { passwordChangeRequired: true } })
      expect((await ctx.tokens.verifyAccess((signedIn as { accessToken: string }).accessToken)).pwc).toBe(true)
      const changed = await accounts.changePassword({ id: me.id, tenantId: s.tenantId }, { currentPassword: temporaryPassword, newPassword: 'my-own-password' }, meta)
      expect(changed.user.passwordChangeRequired).toBe(false)
      expect(await ctx.prisma.client.auditEvent.count({ where: { action: 'account.reset_password', entityId: me.id } })).toBe(1)

      await expect(admins.resetAccountPassword(s.tenantId, sa, owner.id)).rejects.toMatchObject({ code: 'forbidden' })
      const other = await s.account(`own2${Math.floor(Math.random() * 1e6)}`, { isOwner: true })
      await expect(admins.resetAccountPassword(s.tenantId, sa, other.id)).rejects.toMatchObject({ code: 'owner_protected' })
      const smsOnly = await ctx.makeStudent(s.tenantId)
      await expect(admins.resetAccountPassword(s.tenantId, sa, smsOnly.id)).rejects.toMatchObject({ code: 'no_login' })
      await expect(admins.resetAccountPassword(s.tenantId, sa, 'nobody')).rejects.toMatchObject({ code: 'not_found' })
    })
  })
})
