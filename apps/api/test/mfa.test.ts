import argon2 from 'argon2'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { base32Decode, base32Encode, matchTotp, newRecoveryCodes, normalizeRecoveryCode, otpauthUrl, stepOf, totpAt } from '../src/common/totp'
import { RedisService } from '../src/infra/redis/redis.service'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { AccountService, PASSWORD_HASH } from '../src/modules/auth/account.service'
import { AuthService } from '../src/modules/auth/auth.service'
import { MFA_LOCK_FIRST_SECONDS, MFA_MAX_FAILURES, MfaService } from '../src/modules/auth/mfa.service'
import { DB_AVAILABLE, TestContext, testEnv } from './helpers'
import { notificationsStub } from './stubs'

describe('TOTP (RFC 6238)', () => {
  // RFC 6238, appendix B: the SHA-1 secret is the ASCII string «12345678901234567890»; 6 digits = the last 6 of the 8.
  const secret = base32Encode(Buffer.from('12345678901234567890'))
  it('matches the RFC test vectors', () => {
    expect(secret).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ')
    for (const [seconds, code] of [[59, '287082'], [1111111109, '081804'], [1234567890, '005924'], [2000000000, '279037']] as const) {
      expect(totpAt(secret, stepOf(new Date(seconds * 1000)))).toBe(code)
    }
  })

  it('base32 round-trips and accepts lower case and spaces', () => {
    const raw = Buffer.from([0, 1, 2, 250, 251, 252, 253, 254, 255])
    expect(base32Decode(base32Encode(raw))).toEqual(raw)
    expect(base32Decode('gezd gnbv')).toEqual(base32Decode('GEZDGNBV'))
  })

  it('accepts a code within ±30 s and nothing else', () => {
    const at = new Date(1_800_000_000_000)
    const now = stepOf(at)
    expect(matchTotp(secret, totpAt(secret, now), at)).toBe(now)
    expect(matchTotp(secret, totpAt(secret, now - 1), at)).toBe(now - 1)
    expect(matchTotp(secret, totpAt(secret, now + 1), at)).toBe(now + 1)
    expect(matchTotp(secret, totpAt(secret, now - 2), at)).toBeNull()
    expect(matchTotp(secret, '12345', at)).toBeNull()
    expect(matchTotp(secret, 'abcdef', at)).toBeNull()
  })

  it('builds the link the apps read and recovery codes «xxxx-xxxx»', () => {
    expect(otpauthUrl('ILMORA', 'min.user', 'ABC')).toBe('otpauth://totp/ILMORA%3Amin.user?secret=ABC&issuer=ILMORA&algorithm=SHA1&digits=6&period=30')
    const codes = newRecoveryCodes()
    expect(codes).toHaveLength(10)
    expect(new Set(codes).size).toBe(10)
    for (const c of codes) expect(c).toMatch(/^[a-z2-7]{4}-[a-z2-7]{4}$/)
    expect(normalizeRecoveryCode(' ABCD-efgh ')).toBe('abcdefgh')
  })
})

describe.skipIf(!DB_AVAILABLE)('Second factor for the ministry and the Super Admins', () => {
  const ctx = new TestContext()
  const env = testEnv({ TOTP_ENCRYPTION_KEY: 'test-totp-key-test-totp-key-test-totp-key-12', REDIS_MODE: 'off' })
  const noKeyEnv = testEnv({ REDIS_MODE: 'off' })
  const make = (e: typeof env) => {
    const redis = new RedisService(e)
    const mfa = new MfaService(ctx.prisma, ctx.tokens, ctx.audit, redis, e)
    const accounts = new AccountService(ctx.prisma, ctx.tokens, ctx.audit, redis, notificationsStub, e, mfa)
    const auth = new AuthService(ctx.prisma, {} as never, ctx.tokens, ctx.audit, accounts, e, mfa)
    return { mfa, accounts, auth }
  }
  const withKey = make(env)
  const withoutKey = make({ ...noKeyEnv, TOTP_ENCRYPTION_KEY: undefined })
  const meta = { ip: '127.0.0.1', userAgent: 'vitest' }
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  const setup = async (label: string) => {
    const t = await ctx.makeTenant(label)
    const inT = <T>(fn: () => Promise<T>) => TenantContext.forTenant(t.tenantId, fn)
    const passwordHash = await argon2.hash('ministry-password-1', PASSWORD_HASH)
    const user = (login: string, extra: object) => inT(() => ctx.prisma.client.user.create({ data: { tenantId: t.tenantId, login, passwordHash, displayName: login, ...extra } as never }))
    await user('min.user', { roles: ['MINISTRY'] })
    await user('the.owner', { roles: ['STUDENT'], isOwner: true })
    await user('a.student', { roles: ['STUDENT'], phoneE164: '+998901112233' })
    const login = (svc: ReturnType<typeof make>, name: string) => inT(() => svc.accounts.loginWithPassword(t.tenantId, { login: name, password: 'ministry-password-1' }, meta))
    return { ...t, inT, login }
  }

  /** Links the app the way a person would: login → QR secret → first code. */
  const enroll = async (s: Awaited<ReturnType<typeof setup>>, name: string) => {
    const first = await s.login(withKey, name)
    if (!('mfaRequired' in first)) throw new Error('expected a challenge')
    const { secret } = await s.inT(() => withKey.auth.mfaSetup(first.challenge))
    const done = await s.inT(() => withKey.auth.mfaConfirm(first.challenge, totpAt(secret, stepOf(new Date())), meta))
    return { secret, done }
  }

  it('the password alone gives the ministry no session: first sign-in links the app, then a session and 10 recovery codes', async () => {
    const s = await setup('mfa-setup')
    const first = await s.login(withKey, 'min.user')
    expect(first).toMatchObject({ mfaRequired: true, stage: 'setup', expiresInSeconds: 300 })
    expect('accessToken' in first).toBe(false)
    if (!('mfaRequired' in first)) return
    // The pass is no access token.
    await expect(ctx.tokens.verifyAccess(first.challenge)).rejects.toMatchObject({ code: 'invalid_token' })
    // Before the QR code, and with a wrong code: refused.
    await expect(s.inT(() => withKey.auth.mfaConfirm(first.challenge, '000000', meta))).rejects.toMatchObject({ code: 'mfa_setup_first' })
    const { secret, otpauthUrl } = await s.inT(() => withKey.auth.mfaSetup(first.challenge))
    expect(otpauthUrl).toContain('otpauth://totp/ILMORA%3Amin.user')
    const stored = await s.inT(() => ctx.prisma.client.user.findFirstOrThrow({ where: { login: 'min.user' } }))
    expect(stored.totpSecretEnc).toBeTruthy()
    expect(stored.totpSecretEnc).not.toContain(secret)
    const wrong = totpAt(secret, stepOf(new Date()) + 5)
    await expect(s.inT(() => withKey.auth.mfaConfirm(first.challenge, wrong, meta))).rejects.toMatchObject({ code: 'invalid_code' })
    const done = await s.inT(() => withKey.auth.mfaConfirm(first.challenge, totpAt(secret, stepOf(new Date())), meta))
    expect(done.accessToken).toBeTruthy()
    expect(done.user.roles).toEqual(['MINISTRY'])
    expect(done.recoveryCodes).toHaveLength(10)
    expect(await s.inT(() => ctx.prisma.client.totpRecoveryCode.count({ where: { userId: done.user.id } }))).toBe(10)
    await expect(s.inT(() => withKey.auth.mfaSetup(first.challenge))).rejects.toMatchObject({ code: 'mfa_already_enabled' })
  })

  it('later sign-ins need a code; one code opens one session; a recovery code works once', async () => {
    const s = await setup('mfa-verify')
    const { secret, done } = await enroll(s, 'min.user')
    const next = await s.login(withKey, 'min.user')
    expect(next).toMatchObject({ mfaRequired: true, stage: 'verify' })
    if (!('mfaRequired' in next)) return
    // The code used at enrolment cannot be used again.
    await expect(s.inT(() => withKey.auth.mfaVerify(next.challenge, totpAt(secret, stepOf(new Date())), meta))).rejects.toMatchObject({ code: 'invalid_code' })
    const ok = await s.inT(() => withKey.auth.mfaVerify(next.challenge, totpAt(secret, stepOf(new Date()) + 1), meta))
    expect(ok.user.id).toBe(done.user.id)
    const recovery = done.recoveryCodes[0].toUpperCase()
    expect((await s.inT(() => withKey.auth.mfaVerify(next.challenge, recovery, meta))).user.id).toBe(done.user.id)
    await expect(s.inT(() => withKey.auth.mfaVerify(next.challenge, recovery, meta))).rejects.toMatchObject({ code: 'invalid_code' })
    // A setup pass does not work for the verify step, and the other way round.
    await expect(s.inT(() => withKey.auth.mfaSetup(next.challenge))).rejects.toMatchObject({ code: 'invalid_challenge' })
  })

  it('Н-5: 5 wrong codes lock the step for 15 minutes, the next lock that day for 30; a right code clears both', async () => {
    const s = await setup('mfa-lock')
    const { secret } = await enroll(s, 'min.user')
    const next = await s.login(withKey, 'min.user')
    if (!('mfaRequired' in next)) throw new Error('expected a challenge')
    const userId = (await s.inT(() => ctx.prisma.client.user.findFirstOrThrow({ where: { login: 'min.user' } }))).id
    const memory = (withKey.mfa as unknown as { memory: Map<string, { value: number; expires: number }> }).memory
    const wrong = () => s.inT(() => withKey.auth.mfaVerify(next.challenge, '000001', meta))
    const series = async (retryAfterSeconds: number) => {
      for (let i = 0; i < MFA_MAX_FAILURES; i++) await expect(wrong()).rejects.toMatchObject({ code: 'invalid_code' })
      await expect(wrong()).rejects.toMatchObject({ code: 'rate_limited', details: { retryAfterSeconds } })
      // While locked even a right code is refused.
      await expect(s.inT(() => withKey.auth.mfaVerify(next.challenge, totpAt(secret, stepOf(new Date()) + 1), meta))).rejects.toMatchObject({ code: 'rate_limited' })
    }
    const unlock = () => memory.set(`mfa:lock:${userId}`, { value: 1, expires: Date.now() - 1 })
    await series(MFA_LOCK_FIRST_SECONDS)
    unlock()
    await series(MFA_LOCK_FIRST_SECONDS * 2)
    unlock()
    await expect(s.inT(() => withKey.auth.mfaVerify(next.challenge, totpAt(secret, stepOf(new Date()) + 1), meta))).resolves.toMatchObject({ accessToken: expect.any(String) })
    expect(memory.has(`mfa:locks:${userId}`)).toBe(false)
    expect(await s.inT(() => ctx.prisma.client.auditEvent.count({ where: { action: 'auth.mfa.locked', entityId: userId } }))).toBe(2)
  })

  it('refuses the SMS code and Google for such accounts, and refreshes only sessions opened with the code', async () => {
    const s = await setup('mfa-bypass')
    const ministry = await s.inT(() => ctx.prisma.client.user.findFirstOrThrow({ where: { login: 'min.user' } }))
    expect(() => withKey.mfa.refuseOtherSignIn(ministry)).toThrow(expect.objectContaining({ code: 'mfa_password_login' }))
    const student = await s.inT(() => ctx.prisma.client.user.findFirstOrThrow({ where: { login: 'a.student' } }))
    expect(() => withKey.mfa.refuseOtherSignIn(student)).not.toThrow()
    // The finance admin settles payments by hand: the app code too, once the key is set (security review №1).
    expect(withKey.mfa.enforced({ roles: ['FINANCE_ADMIN'], isOwner: false })).toBe(true)
    expect(withoutKey.mfa.enforced({ roles: ['FINANCE_ADMIN'], isOwner: false })).toBe(false)
    expect(withKey.mfa.enforced({ roles: ['CENTER_ADMIN', 'TEACHER'], isOwner: false })).toBe(false)

    // A session opened before the app was linked does not survive a refresh.
    const old = await s.inT(() => ctx.tokens.issueRefresh(ministry.id, s.tenantId, meta))
    await expect(withKey.auth.refresh(old.raw, meta)).rejects.toMatchObject({ code: 'invalid_refresh' })
    const { done } = await enroll(s, 'min.user')
    await expect(withKey.auth.refresh(done.refresh.raw, meta)).resolves.toMatchObject({ user: { id: ministry.id } })
  })

  it('without the key: the ministry cannot sign in, the Super Admin signs in with the password as before', async () => {
    const s = await setup('mfa-nokey')
    await expect(s.login(withoutKey, 'min.user')).rejects.toMatchObject({ code: 'mfa_unavailable' })
    const owner = await s.login(withoutKey, 'the.owner')
    expect('accessToken' in owner && owner.user.roles).toContain('PLATFORM_ADMIN')
    // With the key the owner gets the challenge too; a student never does.
    expect(await s.login(withKey, 'the.owner')).toMatchObject({ mfaRequired: true, stage: 'setup' })
    expect('accessToken' in (await s.login(withKey, 'a.student'))).toBe(true)
  })
})
