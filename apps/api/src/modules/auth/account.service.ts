import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import { type Lang, OFFER_VERSION, formatUzPhone, normalizeUzPhone } from '@ilmora/shared'
import argon2 from 'argon2'
import { AppError } from '../../common/errors'
import { ENV, type Env } from '../../config/env'
import type { Role } from '../../generated/prisma/enums'
import { PrismaService, type TransactionClient } from '../../infra/prisma/prisma.service'
import { RedisService } from '../../infra/redis/redis.service'
import { AuditService } from '../audit/audit.service'
import { type SessionMeta, TokenService } from './token.service'

export interface PublicUser {
  id: string
  login: string | null
  phone: string | null
  displayName: string
  district: string | null
  preferredLang: 'uz' | 'ru' | 'en'
  reminders: boolean
  roles: Role[]
  centerId: string | null
  teacherProfileId: string | null
  /** Offer acceptance and personal-data consent; null until the account confirms the current edition. */
  offerAcceptedAt: string | null
  offerVersion: string | null
  consentAt: string | null
  marketing: boolean
}

export interface LoginResult {
  accessToken: string
  expiresInSeconds: number
  refresh: { raw: string; expiresAt: Date }
  user: PublicUser
}

export type UserRow = {
  id: string
  tenantId: string
  login: string | null
  passwordHash?: string | null
  phoneE164: string | null
  displayName: string
  district: string | null
  preferredLang: 'uz' | 'ru' | 'en'
  reminders: boolean
  roles: Role[]
  isOwner: boolean
  centerId: string | null
  isActive: boolean
  offerAcceptedAt: Date | null
  offerVersion: string | null
  consentAt: Date | null
  marketingAt: Date | null
  teacherProfile: { id: string } | null
}

/** OWASP's minimum argon2id configuration; the same parameters hash one-time codes. */
export const PASSWORD_HASH = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const
const LOGIN_RE = /^[a-z0-9][a-z0-9._-]{2,31}$/
const SELF_SERVICE_ROLES: Record<'STUDENT' | 'TEACHER', Role[]> = { STUDENT: ['STUDENT'], TEACHER: ['TEACHER'] }
const USER_INCLUDE = { teacherProfile: { select: { id: true } } } as const

/**
 * Accounts with a login + password, and the one rule every session relies on: Super Admin (PLATFORM_ADMIN)
 * is held by the tenant's owner accounts only (User.isOwner, set on the server by the owner-setup command).
 * Roles stored on a user never grant it by themselves — claims are derived here at sign-in and refresh, so a
 * forged roles column cannot escalate.
 */
@Injectable()
export class AccountService {
  private readonly memoryFailures = new Map<string, { count: number; expires: number }>()
  private readonly dummyHash = argon2.hash('ilmora-timing-equalizer', PASSWORD_HASH)

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Trim + lower-case + Unicode-normalize; the same form is stored and looked up. */
  normalizeLogin(raw: string): string {
    const login = raw.normalize('NFKC').trim().toLowerCase()
    if (!LOGIN_RE.test(login)) throw AppError.invalid('invalid_login', 'Login must be 3–32 characters: letters, digits, dot, underscore or dash')
    return login
  }

  /** The controller has already validated the offer/consent marks (RegisterDto); the timestamps and edition are recorded here. */
  async register(
    tenantId: string,
    input: { role: 'STUDENT' | 'TEACHER'; login: string; password: string; displayName?: string; phone?: string; lang?: 'uz' | 'ru' | 'en' },
    meta: SessionMeta,
  ): Promise<LoginResult> {
    const roles = SELF_SERVICE_ROLES[input.role]
    if (!roles) throw AppError.invalid('invalid_role', 'Choose Student or Teacher')
    const login = this.normalizeLogin(input.login)
    if (input.password.length < 8 || input.password.length > 128) throw AppError.invalid('weak_password', 'Password must be 8–128 characters')
    const taken = await this.prisma.client.user.findUnique({ where: { tenantId_login: { tenantId, login } }, select: { id: true } })
    if (taken) throw AppError.conflict('login_taken', 'This login is already in use')

    let phoneE164: string | null = null
    if (input.phone && input.phone.trim()) {
      const parsed = normalizeUzPhone(input.phone)
      if (!parsed.ok) throw AppError.invalid('invalid_phone', 'Invalid phone number format (+998...)')
      const phoneTaken = await this.prisma.client.user.findFirst({ where: { tenantId, phoneE164: parsed.e164 }, select: { id: true } })
      if (phoneTaken) throw AppError.conflict('phone_taken', 'This phone number is already registered')
      phoneE164 = parsed.e164
    }

    const passwordHash = await argon2.hash(input.password, PASSWORD_HASH)
    const displayName = input.displayName?.trim() || login
    const now = new Date()
    let user: UserRow
    try {
      user = await this.prisma.client.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            tenantId,
            login,
            phoneE164,
            passwordHash,
            displayName,
            preferredLang: input.lang ?? 'uz',
            roles,
            lastLoginAt: now,
            offerAcceptedAt: now,
            offerVersion: OFFER_VERSION,
            consentAt: now,
          },
          include: USER_INCLUDE,
        })
        if (input.role === 'TEACHER') {
          const slug = await this.freeTeacherSlug(tx, tenantId, login)
          const profile = await tx.teacherProfile.create({ data: { tenantId, userId: created.id, slug, name: displayName, title: {}, bio: {}, tagline: {}, expertise: [], centerId: null } })
          return { ...created, teacherProfile: { id: profile.id } }
        }
        return created
      })
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') throw AppError.conflict('login_taken', 'This login is already in use')
      throw err
    }
    await this.audit.record({ action: 'auth.register', entityType: 'User', entityId: user.id, after: { roles: user.roles, method: 'password' } })
    return this.openSession(user, meta)
  }

  async loginWithPassword(tenantId: string, input: { login: string; password: string }, meta: SessionMeta): Promise<LoginResult> {
    const raw = input.login.trim()
    const login = raw.normalize('NFKC').toLowerCase()
    const key = `login:fail:${tenantId}:${login}`
    await this.assertNotLocked(key)

    // Lookup user by normalized phone number or by unique login username
    const phoneParsed = normalizeUzPhone(raw)
    let user: UserRow | null = null
    if (phoneParsed.ok) {
      user = await this.prisma.client.user.findFirst({ where: { tenantId, phoneE164: phoneParsed.e164 }, include: USER_INCLUDE })
    }
    if (!user && LOGIN_RE.test(login)) {
      user = await this.prisma.client.user.findUnique({ where: { tenantId_login: { tenantId, login } }, include: USER_INCLUDE })
    }

    // Verify against a dummy hash when the login is unknown so response time does not reveal which logins exist.
    let ok = false
    if (user?.passwordHash) ok = await argon2.verify(user.passwordHash, input.password)
    else await argon2.verify(await this.dummyHash, input.password)
    if (!user || !ok) {
      await this.recordFailure(key)
      throw AppError.unauthorized('Invalid login or password', 'invalid_credentials')
    }
    if (!user.isActive) throw new AppError('account_disabled', 'Account disabled', HttpStatus.FORBIDDEN)
    await this.clearFailures(key)
    const updated = await this.prisma.client.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() }, include: USER_INCLUDE })
    await this.audit.record({ action: 'auth.login', entityType: 'User', entityId: user.id, after: { method: 'password' } })
    return this.openSession(updated, meta)
  }

  /**
   * Google Sign-In: validates verified email, creates or retrieves user account safely,
   * accepts mandatory terms and issues JWT + refresh session.
   */
  async loginWithGoogle(
    tenantId: string,
    profile: { googleId: string; email: string; emailVerified: boolean; displayName: string; role?: 'STUDENT' | 'TEACHER'; lang?: Lang },
    meta: SessionMeta,
  ): Promise<LoginResult> {
    if (!profile.emailVerified) {
      throw new AppError('unverified_email', 'Google account email is not verified', HttpStatus.FORBIDDEN)
    }
    const email = profile.email.toLowerCase().trim()
    const baseLogin = email.split('@')[0].replace(/[^a-z0-9._-]/g, '').slice(0, 24) || `user${profile.googleId.slice(0, 6)}`
    const loginCandidate = baseLogin.length >= 3 ? baseLogin : `${baseLogin}123`
    const preferredLang: Lang = profile.lang && ['uz', 'ru', 'en'].includes(profile.lang) ? profile.lang : 'uz'

    // Look for existing user by primary username, email prefix, or Google ID pattern
    let user = await this.prisma.client.user.findFirst({
      where: { tenantId, login: { in: [loginCandidate, `g_${profile.googleId.slice(0, 16)}`, baseLogin] } },
      include: USER_INCLUDE,
    })

    // Security: Do not automatically link to an existing account if it was registered with a password
    // to prevent unauthorized account takeover via unverified username/email-prefix collision.
    if (user && user.passwordHash) {
      user = null
    }

    if (!user) {
      const role = profile.role ?? 'STUDENT'
      const roles = SELF_SERVICE_ROLES[role]
      const login = await this.freeUserLogin(tenantId, loginCandidate)
      const now = new Date()
      user = await this.prisma.client.$transaction(async (tx) => {
        const created = await tx.user.create({
          data: {
            tenantId,
            login,
            displayName: profile.displayName.trim() || email,
            preferredLang,
            roles,
            lastLoginAt: now,
            offerAcceptedAt: now,
            offerVersion: OFFER_VERSION,
            consentAt: now,
          },
          include: USER_INCLUDE,
        })
        if (role === 'TEACHER') {
          const slug = await this.freeTeacherSlug(tx, tenantId, login)
          const profileRow = await tx.teacherProfile.create({
            data: { tenantId, userId: created.id, slug, name: created.displayName, title: {}, bio: {}, tagline: {}, expertise: [], centerId: null },
          })
          return { ...created, teacherProfile: { id: profileRow.id } }
        }
        return created
      })
      await this.audit.record({ action: 'auth.register', entityType: 'User', entityId: user.id, after: { roles: user.roles, method: 'google', googleId: profile.googleId, email } })
    } else {
      if (!user.isActive) throw new AppError('account_disabled', 'Account disabled', HttpStatus.FORBIDDEN)
      user = await this.prisma.client.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
        include: USER_INCLUDE,
      })
      await this.audit.record({ action: 'auth.login', entityType: 'User', entityId: user.id, after: { method: 'google', googleId: profile.googleId, email } })
    }

    return this.openSession(user, meta)
  }

  /** Records acceptance of the current offer edition and personal-data consent for an existing account. */
  async giveConsent(userId: string): Promise<PublicUser> {
    const now = new Date()
    const user = await this.prisma.client.user.update({
      where: { id: userId },
      data: { offerAcceptedAt: now, offerVersion: OFFER_VERSION, consentAt: now },
      include: USER_INCLUDE,
    })
    await this.audit.record({ action: 'auth.consent', entityType: 'User', entityId: user.id, after: { offerVersion: OFFER_VERSION } })
    return this.toPublic(user, await this.effectiveRoles(user))
  }

  /**
   * Roles that go into the access token. PLATFORM_ADMIN (+ FINANCE_ADMIN) is present exactly when the user is one of
   * the tenant's owners (isOwner, set only by the owner-setup command), regardless of what the roles column says;
   * every other role is taken from the column. Callers pass the row they just read, so the flag is current.
   */
  async effectiveRoles(user: { roles: Role[]; isOwner: boolean }): Promise<Role[]> {
    const roles: Role[] = user.roles.filter((r) => r !== 'PLATFORM_ADMIN')
    if (user.isOwner) for (const r of ['PLATFORM_ADMIN', 'FINANCE_ADMIN'] as Role[]) if (!roles.includes(r)) roles.push(r)
    return roles
  }

  async openSession(user: UserRow, meta: SessionMeta): Promise<LoginResult> {
    const roles = await this.effectiveRoles(user)
    const accessToken = await this.tokens.signAccess({ id: user.id, tenantId: user.tenantId, roles, centerId: user.centerId, teacherProfileId: user.teacherProfile?.id ?? null })
    const refresh = await this.tokens.issueRefresh(user.id, user.tenantId, meta)
    return { accessToken, expiresInSeconds: this.env.JWT_ACCESS_TTL_SECONDS, refresh: { raw: refresh.raw, expiresAt: refresh.expiresAt }, user: this.toPublic(user, roles) }
  }

  toPublic(user: UserRow, roles: Role[]): PublicUser {
    return {
      id: user.id,
      login: user.login,
      phone: user.phoneE164 ? formatUzPhone(user.phoneE164) : null,
      displayName: user.displayName,
      district: user.district,
      preferredLang: user.preferredLang,
      reminders: user.reminders,
      roles,
      centerId: user.centerId,
      teacherProfileId: user.teacherProfile?.id ?? null,
      offerAcceptedAt: user.offerAcceptedAt?.toISOString() ?? null,
      offerVersion: user.offerVersion,
      consentAt: user.consentAt?.toISOString() ?? null,
      marketing: !!user.marketingAt,
    }
  }

  private async freeTeacherSlug(tx: TransactionClient, tenantId: string, base: string): Promise<string> {
    const root = base.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'teacher'
    for (let n = 0; n < 50; n++) {
      const slug = n === 0 ? root : `${root}-${n + 1}`
      if (!(await tx.teacherProfile.findFirst({ where: { tenantId, slug }, select: { id: true } }))) return slug
    }
    return `${root}-${Date.now().toString(36)}`
  }

  private async freeUserLogin(tenantId: string, base: string): Promise<string> {
    const root = base.replace(/[^a-z0-9._-]/g, '').slice(0, 24) || 'user'
    for (let n = 0; n < 50; n++) {
      const candidate = n === 0 ? root : `${root.slice(0, 20)}_${n + 1}`
      const exists = await this.prisma.client.user.findUnique({ where: { tenantId_login: { tenantId, login: candidate } }, select: { id: true } })
      if (!exists) return candidate
    }
    return `user_${Date.now().toString(36)}`
  }

  // ── failed-attempt lock per login (shared across replicas through Redis; per process when REDIS_MODE=off) ──
  private async assertNotLocked(key: string) {
    const { count, ttl } = await this.failures(key)
    if (count >= this.env.LOGIN_MAX_FAILURES) throw AppError.tooMany('Too many failed sign-in attempts; try again later', ttl)
  }

  private async recordFailure(key: string) {
    if (this.redis.off) {
      const now = Date.now()
      const rec = this.memoryFailures.get(key)
      const cur = rec && rec.expires > now ? rec : { count: 0, expires: now + this.env.LOGIN_LOCK_SECONDS * 1000 }
      cur.count += 1
      this.memoryFailures.set(key, cur)
      return
    }
    try {
      const count = await this.redis.cache.incr(key)
      if (count === 1) await this.redis.cache.expire(key, this.env.LOGIN_LOCK_SECONDS)
    } catch {
      /* counting failures must never turn a bad password into a 500; the IP throttle still applies */
    }
  }

  private async clearFailures(key: string) {
    if (this.redis.off) { this.memoryFailures.delete(key); return }
    await this.redis.cache.del(key).catch(() => undefined)
  }

  private async failures(key: string): Promise<{ count: number; ttl: number }> {
    if (this.redis.off) {
      const rec = this.memoryFailures.get(key)
      if (!rec || rec.expires <= Date.now()) return { count: 0, ttl: 0 }
      return { count: rec.count, ttl: Math.ceil((rec.expires - Date.now()) / 1000) }
    }
    try {
      const [count, ttl] = await Promise.all([this.redis.cache.get(key), this.redis.cache.ttl(key)])
      return { count: Number(count ?? 0), ttl: ttl > 0 ? ttl : this.env.LOGIN_LOCK_SECONDS }
    } catch {
      throw AppError.unavailable('Sign-in is temporarily unavailable, please try again shortly')
    }
  }
}
