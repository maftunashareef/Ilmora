import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common'
import type { MfaChallengeDto, MfaSetupDto } from '@ilmora/shared'
import { decryptString, encryptString, sha256 } from '../../common/crypto'
import { AppError } from '../../common/errors'
import { matchTotp, newRecoveryCodes, newTotpSecret, normalizeRecoveryCode, otpauthUrl } from '../../common/totp'
import { ENV, type Env } from '../../config/env'
import type { Role } from '../../generated/prisma/enums'
import { PrismaService } from '../../infra/prisma/prisma.service'
import { RedisService } from '../../infra/redis/redis.service'
import { AuditService } from '../audit/audit.service'
import { MFA_CHALLENGE_SECONDS, TokenService } from './token.service'

/** Tolerated difference between the database and API clocks when comparing a session with the moment the app was linked. */
const CLOCK_DRIFT_MS = 120_000

type MfaUser = { id: string; tenantId: string; roles: Role[]; isOwner: boolean; totpEnabledAt: Date | null }

/**
 * Second factor — a code from an authenticator app (TOTP, RFC 6238) — for the ministry and the Super Admins
 * (ТЗ 4.4, 9.4; TOTP rather than SMS: no SMS contract yet). After a correct password the API answers a 5-minute
 * challenge instead of a session: `setup` (first sign-in: QR code, then the first code and 10 recovery codes) or
 * `verify` (a code, or a recovery code for a lost phone).
 *
 * Without TOTP_ENCRYPTION_KEY the secrets cannot be stored: the ministry cannot sign in at all, the Super Admins sign
 * in with the password only (so a release without the key does not lock the owners out of the admin panel).
 */
@Injectable()
export class MfaService {
  private readonly logger = new Logger(MfaService.name)
  private readonly memory = new Map<string, { value: number; expires: number }>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  get configured(): boolean {
    return !!this.env.TOTP_ENCRYPTION_KEY
  }

  /**
   * The account must pass the second factor: always for the ministry; for the Super Admins and the finance admins
   * (they settle payments by hand — security review 10.11 №1) once the key is set.
   */
  enforced(user: { roles: Role[]; isOwner: boolean }): boolean {
    return user.roles.includes('MINISTRY') || ((user.isOwner || user.roles.includes('FINANCE_ADMIN')) && this.configured)
  }

  /**
   * After a correct password: null (open the session) or the challenge for the next step. The ministry without the key
   * on the server: 503 — never a session without the second factor.
   */
  async gate(user: MfaUser): Promise<MfaChallengeDto | null> {
    if (!this.enforced(user)) {
      if (user.isOwner) this.logger.warn('Super Admin signed in without the authenticator code: TOTP_ENCRYPTION_KEY is not set')
      return null
    }
    if (!this.configured) throw new AppError('mfa_unavailable', 'Sign-in with an authenticator code is not configured on the server yet', HttpStatus.SERVICE_UNAVAILABLE)
    const stage = user.totpEnabledAt ? 'verify' : 'setup'
    return { mfaRequired: true, stage, challenge: await this.tokens.signMfaChallenge(user, stage), expiresInSeconds: MFA_CHALLENGE_SECONDS }
  }

  /** One-time SMS codes and Google do not carry a second factor: such an account signs in with the login and password. */
  refuseOtherSignIn(user: { roles: Role[]; isOwner: boolean }): void {
    if (this.enforced(user)) throw new AppError('mfa_password_login', 'Sign in with the login and password', HttpStatus.FORBIDDEN)
  }

  /**
   * A refresh keeps a session only if it was opened with the second factor: the account has it enabled and the session
   * family started after that (sessions from before the app was linked end here).
   */
  async allowsRefresh(user: MfaUser, familyId: string): Promise<boolean> {
    if (!this.enforced(user)) return true
    if (!this.configured || !user.totpEnabledAt) return false
    const first = await this.prisma.client.refreshSession.findFirst({ where: { userId: user.id, familyId }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } })
    // createdAt comes from the database clock, totpEnabledAt from the API's: allow for a small drift between them.
    return !!first && first.createdAt.getTime() >= user.totpEnabledAt.getTime() - CLOCK_DRIFT_MS
  }

  /** First sign-in: a new secret for the app (shown as a QR code). Asking again replaces it until the first code is confirmed. */
  async setup(challenge: string): Promise<MfaSetupDto> {
    const user = await this.challengeUser(challenge, 'setup')
    if (user.totpEnabledAt) throw AppError.conflict('mfa_already_enabled', 'The authenticator app is already linked; enter its code')
    const secret = newTotpSecret()
    await this.prisma.client.user.update({ where: { id: user.id }, data: { totpSecretEnc: encryptString(secret, this.key()) } })
    return { secret, otpauthUrl: otpauthUrl('ILMORA', user.login ?? user.id, secret) }
  }

  /** The first code from the app links it; the answer carries 10 one-time recovery codes, shown once. */
  async confirm(challenge: string, code: string): Promise<{ userId: string; recoveryCodes: string[] }> {
    const user = await this.challengeUser(challenge, 'setup')
    if (user.totpEnabledAt) throw AppError.conflict('mfa_already_enabled', 'The authenticator app is already linked; enter its code')
    if (!user.totpSecretEnc) throw AppError.conflict('mfa_setup_first', 'Scan the QR code first')
    const failKey = `mfa:fail:${user.id}`
    await this.assertNotLocked(failKey)
    const step = matchTotp(decryptString(user.totpSecretEnc, this.key()), code, new Date())
    if (step === null) {
      await this.bump(failKey)
      throw AppError.invalid('invalid_code', 'The code is wrong or has expired')
    }
    const recoveryCodes = newRecoveryCodes()
    const now = new Date()
    await this.prisma.client.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { totpEnabledAt: now } })
      await tx.totpRecoveryCode.deleteMany({ where: { userId: user.id } })
      await tx.totpRecoveryCode.createMany({ data: recoveryCodes.map((c) => ({ tenantId: user.tenantId, userId: user.id, codeHash: sha256(normalizeRecoveryCode(c)) })) })
    })
    await this.remember(`mfa:step:${user.id}`, step)
    await this.clear(failKey)
    await this.audit.record({ action: 'auth.mfa.enable', entityType: 'User', entityId: user.id, tenantId: user.tenantId })
    return { userId: user.id, recoveryCodes }
  }

  /** A code from the app (each code works once) or an unused recovery code. Returns the account and how it passed. */
  async verify(challenge: string, code: string): Promise<{ userId: string; method: 'totp' | 'recovery_code' }> {
    const user = await this.challengeUser(challenge, 'verify')
    if (!user.totpEnabledAt || !user.totpSecretEnc) throw AppError.unauthorized('The sign-in step has expired; enter the login and password again', 'invalid_challenge')
    const failKey = `mfa:fail:${user.id}`
    await this.assertNotLocked(failKey)
    const stepKey = `mfa:step:${user.id}`
    const step = matchTotp(decryptString(user.totpSecretEnc, this.key()), code, new Date())
    if (step !== null && step > (await this.recall(stepKey))) {
      await this.remember(stepKey, step)
      await this.clear(failKey)
      return { userId: user.id, method: 'totp' }
    }
    if (step === null && /[a-z]/i.test(code)) {
      const used = await this.prisma.client.totpRecoveryCode.updateMany({ where: { userId: user.id, codeHash: sha256(normalizeRecoveryCode(code)), usedAt: null }, data: { usedAt: new Date() } })
      if (used.count === 1) {
        await this.clear(failKey)
        await this.audit.record({ action: 'auth.mfa.recovery_code', entityType: 'User', entityId: user.id, tenantId: user.tenantId })
        return { userId: user.id, method: 'recovery_code' }
      }
    }
    await this.bump(failKey)
    throw AppError.invalid('invalid_code', 'The code is wrong, has expired or was already used')
  }

  /** The Super Admin unlinks the app of an account (lost phone): the next sign-in starts from the QR code again. */
  async reset(userId: string, tenantId: string): Promise<void> {
    await this.prisma.client.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { totpSecretEnc: null, totpEnabledAt: null } })
      await tx.totpRecoveryCode.deleteMany({ where: { userId } })
    })
    await this.audit.record({ action: 'auth.mfa.reset', entityType: 'User', entityId: userId, tenantId })
  }

  // ───────────── helpers ─────────────

  private key(): string {
    if (!this.env.TOTP_ENCRYPTION_KEY) throw new AppError('mfa_unavailable', 'Sign-in with an authenticator code is not configured on the server yet', HttpStatus.SERVICE_UNAVAILABLE)
    return this.env.TOTP_ENCRYPTION_KEY
  }

  private async challengeUser(challenge: string, stage: 'setup' | 'verify') {
    const c = await this.tokens.verifyMfaChallenge(challenge)
    const user = await this.prisma.client.user.findFirst({
      where: { id: c.userId, tenantId: c.tenantId, isActive: true },
      select: { id: true, tenantId: true, login: true, roles: true, isOwner: true, totpSecretEnc: true, totpEnabledAt: true },
    })
    if (!user || c.stage !== stage || !this.enforced(user)) throw AppError.unauthorized('The sign-in step has expired; enter the login and password again', 'invalid_challenge')
    this.key()
    return user
  }

  /** Wrong codes per account: after LOGIN_MAX_FAILURES the step is locked for LOGIN_LOCK_SECONDS (a 6-digit code cannot be guessed). */
  private async assertNotLocked(key: string) {
    if ((await this.recall(key)) >= this.env.LOGIN_MAX_FAILURES) throw AppError.tooMany('Too many wrong codes; try again later', this.env.LOGIN_LOCK_SECONDS)
  }

  private async bump(key: string) {
    if (this.redis.off) {
      const now = Date.now()
      const cur = this.memory.get(key)
      this.memory.set(key, cur && cur.expires > now ? { ...cur, value: cur.value + 1 } : { value: 1, expires: now + this.env.LOGIN_LOCK_SECONDS * 1000 })
      return
    }
    try {
      if ((await this.redis.cache.incr(key)) === 1) await this.redis.cache.expire(key, this.env.LOGIN_LOCK_SECONDS)
    } catch {
      /* counting must never turn a wrong code into a 500; the route throttle still applies */
    }
  }

  /** Keeps a number for a few minutes (the last accepted time step: a code is not accepted twice). */
  private async remember(key: string, value: number) {
    if (this.redis.off) { this.memory.set(key, { value, expires: Date.now() + 300_000 }); return }
    await this.redis.cache.set(key, String(value), 'EX', 300).catch(() => undefined)
  }

  private async recall(key: string): Promise<number> {
    if (this.redis.off) {
      const rec = this.memory.get(key)
      return rec && rec.expires > Date.now() ? rec.value : 0
    }
    try {
      return Number((await this.redis.cache.get(key)) ?? 0)
    } catch {
      return 0
    }
  }

  private async clear(key: string) {
    if (this.redis.off) { this.memory.delete(key); return }
    await this.redis.cache.del(key).catch(() => undefined)
  }
}
