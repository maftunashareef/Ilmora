import argon2 from 'argon2'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ROLES_KEY } from '../src/common/decorators'
import { ZodValidationPipe } from '../src/common/zod.pipe'
import { RedisService } from '../src/infra/redis/redis.service'
import { TenantContext, type RequestActor } from '../src/infra/tenancy/tenant-context'
import { AccountService } from '../src/modules/auth/account.service'
import { MfaService } from '../src/modules/auth/mfa.service'
import { MinistryAccountsService } from '../src/modules/ministry/ministry-accounts.service'
import { MinistryAdminController } from '../src/modules/ministry/ministry-admin.controller'
import { MinistryAccountInput } from '../src/modules/ministry/ministry.schemas'
import { DB_AVAILABLE, TestContext, testEnv } from './helpers'
import { notificationsStub } from './stubs'

describe('Ministry accounts: access and input', () => {
  it('are managed by the Super Admin only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, MinistryAdminController)).toEqual(['PLATFORM_ADMIN'])
  })
  it('take a name, an optional position and e-mail; never roles or a password', () => {
    const pipe = new ZodValidationPipe(MinistryAccountInput)
    expect(pipe.transform({ login: 'vazirlik.1', name: ' Alisher  Navoiy ', email: '' })).toEqual({ login: 'vazirlik.1', name: 'Alisher Navoiy', email: null })
    expect(() => pipe.transform({ login: 'x1', name: 'A B', roles: ['PLATFORM_ADMIN'] })).toThrow()
    expect(() => pipe.transform({ login: 'x1x', name: 'A B', password: 'mine' })).toThrow()
  })
})

describe.skipIf(!DB_AVAILABLE)('Ministry accounts (ТЗ 4.4)', () => {
  const ctx = new TestContext()
  const env = testEnv({ TOTP_ENCRYPTION_KEY: 'test-totp-key-test-totp-key-test-totp-key-12', REDIS_MODE: 'off' })
  const redis = new RedisService(env)
  const mfa = new MfaService(ctx.prisma, ctx.tokens, ctx.audit, redis, env)
  const accounts = new AccountService(ctx.prisma, ctx.tokens, ctx.audit, redis, notificationsStub, env, mfa)
  const service = new MinistryAccountsService(ctx.prisma, ctx.audit, accounts, mfa, ctx.tokens)
  const meta = { ip: '127.0.0.1', userAgent: 'vitest' }
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  const setup = async (label: string) => {
    const t = await ctx.makeTenant(label)
    const inT = <T>(fn: () => Promise<T>) => TenantContext.forTenant(t.tenantId, fn)
    const owner = await inT(() => ctx.prisma.client.user.create({ data: { tenantId: t.tenantId, login: `owner-${label}`, displayName: 'Owner', roles: ['STUDENT'], isOwner: true } }))
    const admin: RequestActor = { id: owner.id, roles: ['PLATFORM_ADMIN'] }
    return { ...t, inT, owner, admin }
  }

  it('creates an account with the MINISTRY role and a strong temporary password, shown once', async () => {
    const { tenantId, inT } = await setup('min-create')
    await inT(async () => {
      const { account, temporaryPassword } = await service.create(tenantId, { login: 'Vazirlik.Bir', name: 'Alisher Navoiy', jobTitle: 'Bosh mutaxassis' })
      expect(account).toMatchObject({ login: 'vazirlik.bir', name: 'Alisher Navoiy', active: true, appLinked: false })
      expect(temporaryPassword).toMatch(/^[A-Za-z2-9]{16}$/)
      const row = await ctx.prisma.client.user.findUniqueOrThrow({ where: { id: account.id } })
      expect(row.roles).toEqual(['MINISTRY'])
      expect(row.passwordHash).not.toContain(temporaryPassword)
      expect(await argon2.verify(row.passwordHash!, temporaryPassword)).toBe(true)
      // The temporary password signs in to the authenticator step, not to a session.
      expect(await accounts.loginWithPassword(tenantId, { login: 'vazirlik.bir', password: temporaryPassword }, meta)).toMatchObject({ mfaRequired: true, stage: 'setup' })
      await expect(service.create(tenantId, { login: 'vazirlik.bir', name: 'Boshqa' })).rejects.toMatchObject({ code: 'login_taken' })
      expect((await service.list()).map((a) => a.login)).toEqual(['vazirlik.bir'])
      expect(await ctx.prisma.client.auditEvent.count({ where: { action: 'ministry.account.create', entityId: account.id } })).toBe(1)
    })
  })

  it('disabling ends the sessions and the sign-in; a password reset ends the sessions too', async () => {
    const { tenantId, inT } = await setup('min-disable')
    await inT(async () => {
      const { account, temporaryPassword } = await service.create(tenantId, { login: 'vazirlik.ikki', name: 'Ikki' })
      await ctx.tokens.issueRefresh(account.id, tenantId, meta)
      expect((await service.setActive(tenantId, account.id, false)).active).toBe(false)
      expect(await ctx.prisma.client.refreshSession.count({ where: { userId: account.id, revokedAt: null } })).toBe(0)
      await expect(accounts.loginWithPassword(tenantId, { login: 'vazirlik.ikki', password: temporaryPassword }, meta)).rejects.toMatchObject({ code: 'invalid_credentials' })
      await service.setActive(tenantId, account.id, true)
      await ctx.tokens.issueRefresh(account.id, tenantId, meta)
      const reset = await service.resetPassword(tenantId, account.id)
      expect(reset.temporaryPassword).not.toBe(temporaryPassword)
      expect(await ctx.prisma.client.refreshSession.count({ where: { userId: account.id, revokedAt: null } })).toBe(0)
      await expect(accounts.loginWithPassword(tenantId, { login: 'vazirlik.ikki', password: temporaryPassword }, meta)).rejects.toMatchObject({ code: 'invalid_credentials' })
    })
  })

  it('touches ministry accounts only: a student is «not found»', async () => {
    const { tenantId, inT, admin } = await setup('min-scope')
    await inT(async () => {
      const student = await ctx.makeStudent(tenantId)
      await expect(service.setActive(tenantId, student.id, false)).rejects.toMatchObject({ code: 'not_found' })
      await expect(service.resetPassword(tenantId, student.id)).rejects.toMatchObject({ code: 'not_found' })
      await expect(service.update(student.id, { name: 'X Y' })).rejects.toMatchObject({ code: 'not_found' })
      await expect(service.resetSecondFactor(tenantId, admin, student.id)).rejects.toMatchObject({ code: 'not_found' })
    })
  })

  it('resets the second factor of a ministry account or another Super Admin — never one’s own', async () => {
    const { tenantId, inT, owner, admin } = await setup('min-mfa')
    await inT(async () => {
      const { account } = await service.create(tenantId, { login: 'vazirlik.uch', name: 'Uch' })
      await ctx.prisma.client.user.update({ where: { id: account.id }, data: { totpSecretEnc: 'x.y.z', totpEnabledAt: new Date() } })
      await ctx.prisma.client.totpRecoveryCode.create({ data: { tenantId, userId: account.id, codeHash: 'h' } })
      await service.resetSecondFactor(tenantId, admin, account.id)
      expect(await ctx.prisma.client.user.findUniqueOrThrow({ where: { id: account.id } })).toMatchObject({ totpSecretEnc: null, totpEnabledAt: null })
      expect(await ctx.prisma.client.totpRecoveryCode.count({ where: { userId: account.id } })).toBe(0)
      await expect(service.resetSecondFactor(tenantId, admin, owner.id)).rejects.toMatchObject({ code: 'forbidden' })
      const other = await ctx.prisma.client.user.create({ data: { tenantId, login: 'owner-two', displayName: 'Owner 2', roles: ['STUDENT'], isOwner: true } })
      await expect(service.resetSecondFactor(tenantId, admin, other.id)).resolves.toBeUndefined()
    })
  })
})
