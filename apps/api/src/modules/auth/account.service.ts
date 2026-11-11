import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import { type Lang, type MfaChallengeDto, OFFER_VERSION, formatUzPhone, normalizeUzPhone } from '@ilmora/shared'
import argon2 from 'argon2'
import { randomToken } from '../../common/crypto'
import { AppError } from '../../common/errors'
import { ENV, type Env } from '../../config/env'
import type { Role } from '../../generated/prisma/enums'
import { PrismaService, type TransactionClient } from '../../infra/prisma/prisma.service'
import { RedisService } from '../../infra/redis/redis.service'
import { TenantContext } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { NotificationsService } from '../notifications/notifications.service'
import { MfaService } from './mfa.service'
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
  /**
   * The password was given by the Super Admin (a new ministry account or a reset) and not changed since: the web asks
   * for a new one first (POST /v1/auth/password).
   */
  passwordChangeRequired: boolean
}

/** Audit actions after which the password is the Super Admin's, not the owner's. */
const ADMIN_ISSUED_PASSWORD = ['ministry.account.create', 'ministry.account.reset_password'] as const

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
  /** Registry: the institution / company this account represents (INSTITUTION_ADMIN / COMPANY_ADMIN). */
  institutionId: string | null
  companyId: string | null
  totpEnabledAt: Date | null
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
/**
 * Roles a person can choose at registration. CENTER = an Educational Center account (its first administrator);
 * INSTITUTION = the representative of a registry institution, who then claims it by STIR (ТЗ 4.2); COMPANY = the contact
 * person of a company, who then starts its profile by STIR (ТЗ 4.3). MINISTRY is never here.
 */
export type SelfServiceRole = 'STUDENT' | 'TEACHER' | 'CENTER' | 'INSTITUTION' | 'COMPANY'
const SELF_SERVICE_ROLES: Record<SelfServiceRole, Role[]> = { STUDENT: ['STUDENT'], TEACHER: ['TEACHER'], CENTER: ['CENTER_ADMIN'], INSTITUTION: ['INSTITUTION_ADMIN'], COMPANY: ['COMPANY_ADMIN'] }
const USER_INCLUDE = { teacherProfile: { select: { id: true } } } as const
const EMPTY_L = { uz: '', ru: '', en: '' }
/** URL slug for a center name written in any of the three alphabets. */
const slugify = (s: string) => s.toLowerCase().replace(/ş/g, 'sh').replace(/ç/g, 'ch').replace(/ö/g, 'o').replace(/ğ/g, 'g').normalize('NFKD').replace(/[‘’'`ʻ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'center'

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
    private readonly notifications: NotificationsService,
    @Inject(ENV) private readonly env: Env,
    private readonly mfa: MfaService,
  ) {}

  /** Trim + lower-case + Unicode-normalize; the same form is stored and looked up. */
  normalizeLogin(raw: string): string {
    const login = raw.normalize('NFKC').trim().toLowerCase()
    if (!LOGIN_RE.test(login)) throw AppError.invalid('invalid_login', 'Login must be 3–32 characters: letters, digits, dot, underscore or dash')
    return login
  }

  /**
   * The controller has already validated the offer/consent marks (RegisterDto); the timestamps and edition are recorded here.
   * An Educational Center registration also creates the center (PENDING until the Super Admin approves it) with this
   * account as its first administrator; Super Admins are notified.
   */
  async register(
    tenantId: string,
    input: { role: SelfServiceRole; login: string; password: string; displayName?: string; phone?: string; centerName?: string; jobTitle?: string; lang?: 'uz' | 'ru' | 'en' },
    meta: SessionMeta,
    attempt = 1,
  ): Promise<LoginResult> {
    const roles = SELF_SERVICE_ROLES[input.role]
    if (!roles) throw AppError.invalid('invalid_role', 'Choose Student, Teacher, Educational Center, Institution or Company')
    // A representative of an institution or a company: full name and position (ТЗ 4.2 step 1, 4.3).
    const representative = input.role === 'INSTITUTION' || input.role === 'COMPANY'
    const jobTitle = representative ? input.jobTitle?.normalize('NFC').trim().replace(/\s+/g, ' ') ?? '' : ''
    if (representative) {
      const name = input.displayName?.trim() ?? ''
      if (name.length < 2 || /[<>]/.test(name)) throw AppError.invalid('invalid_contact_name', 'Enter your full name')
      if (jobTitle.length < 2 || jobTitle.length > 80 || /[<>]/.test(jobTitle)) throw AppError.invalid('invalid_job_title', 'Enter your position (2–80 characters)')
    }
    const centerName = input.role === 'CENTER' ? input.centerName?.trim() ?? '' : ''
    if (input.role === 'CENTER' && (centerName.length < 2 || centerName.length > 120)) throw AppError.invalid('invalid_center_name', 'Enter the name of the center (2–120 characters)')
    const login = this.normalizeLogin(input.login)
    if (input.password.length < 8 || input.password.length > 128) throw AppError.invalid('weak_password', 'Password must be 8–128 characters')
    const taken = await this.prisma.client.user.findUnique({ where: { tenantId_login: { tenantId, login } }, select: { id: true } })
    if (taken) throw AppError.conflict('login_taken', 'This login is already in use')

    // A phone given here is NOT proven to belong to the registrant (no SMS code is checked), so it must never occupy the
    // account's authoritative phoneE164 — that field is unique per tenant and is what OTP sign-in and phone-login match on.
    // Binding an unverified number there would let anyone squat a victim's phone and capture their later SMS sign-in.
    // We keep it only as the center's contact number; the account's phone stays empty until verified through OTP sign-in.
    let contactPhone: string | null = null
    if (input.phone && input.phone.trim()) {
      const parsed = normalizeUzPhone(input.phone)
      if (!parsed.ok) throw AppError.invalid('invalid_phone', 'Invalid phone number format (+998...)')
      contactPhone = parsed.e164
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
            phoneE164: null,
            passwordHash,
            displayName,
            preferredLang: input.lang ?? 'uz',
            roles,
            jobTitle: jobTitle || null,
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
        if (input.role === 'CENTER') {
          const slug = await this.freeCenterSlug(tx, tenantId, slugify(centerName))
          const center = await tx.center.create({
            data: { tenantId, slug, name: centerName, district: EMPTY_L, description: EMPTY_L, status: 'PENDING', ownerUserId: created.id, phoneE164: contactPhone, checkInCode: randomToken(16), checkInCodeRotatedAt: now },
          })
          return tx.user.update({ where: { id: created.id }, data: { centerId: center.id }, include: USER_INCLUDE })
        }
        return created
      })
    } catch (err) {
      const target = String((err as { meta?: { target?: unknown } }).meta?.target ?? '')
      // Two centers (or teachers) of one name registered at once collide on the slug, not the login: try once more,
      // the free-slug lookup then sees the other one (security review №35).
      if ((err as { code?: string }).code === 'P2002' && target.includes('slug') && attempt < 3) return this.register(tenantId, input, meta, attempt + 1)
      if ((err as { code?: string }).code === 'P2002') throw AppError.conflict('login_taken', 'This login is already in use')
      throw err
    }
    await this.audit.record({ action: 'auth.register', entityType: 'User', entityId: user.id, after: { roles: user.roles, method: 'password', centerId: user.centerId } })
    if (input.role === 'CENTER' && user.centerId) {
      const centerId = user.centerId
      await this.notifications.safely('center.registered', async () =>
        this.notifications.notify({ tenantId, userIds: await this.notifications.ownerIds(tenantId), type: 'center.registered', params: { centerName, centerId, login }, dedupeKey: `center-registered:${centerId}` }),
      )
    }
    return this.openSession(user, meta)
  }

  private async freeCenterSlug(tx: TransactionClient, tenantId: string, base: string): Promise<string> {
    for (let n = 0; n < 50; n++) {
      const slug = n === 0 ? base : `${base}-${n + 1}`
      if (!(await tx.center.findFirst({ where: { tenantId, slug }, select: { id: true }, includeDeleted: true } as never))) return slug
    }
    return `${base}-${Date.now().toString(36)}`
  }

  async loginWithPassword(tenantId: string, input: { login: string; password: string }, meta: SessionMeta): Promise<LoginResult | MfaChallengeDto> {
    const raw = input.login.trim()
    const login = raw.normalize('NFKC').toLowerCase()
    const phoneParsed = normalizeUzPhone(raw)

    // Lookup user by normalized phone number or by unique login username
    let user: UserRow | null = null
    if (phoneParsed.ok) {
      user = await this.prisma.client.user.findFirst({ where: { tenantId, phoneE164: phoneParsed.e164 }, include: USER_INCLUDE })
    }
    // A login made of digits stays a login when an account opened by SMS has the same number but no password (№33).
    if ((!user || !user.passwordHash) && LOGIN_RE.test(login)) {
      user = (await this.prisma.client.user.findUnique({ where: { tenantId_login: { tenantId, login } }, include: USER_INCLUDE })) ?? user
    }
    // The failure counter follows the account — its login and its phone share one lock — and is counted before the
    // password is checked: attempts sent at once cannot all slip under the limit (security review 10.11 №3).
    const key = `login:fail:${tenantId}:${user ? `user:${user.id}` : phoneParsed.ok ? `phone:${phoneParsed.e164}` : login}`
    await this.countAttempt(key)

    // Verify against a dummy hash when the login is unknown so response time does not reveal which logins exist.
    let ok = false
    if (user?.passwordHash) ok = await argon2.verify(user.passwordHash, input.password)
    else await argon2.verify(await this.dummyHash, input.password)
    if (!user || !ok) throw AppError.unauthorized('Invalid login or password', 'invalid_credentials')
    // Do not reveal that the password was correct for a disabled account: answer exactly as for a wrong password (Ж15).
    if (!user.isActive) throw AppError.unauthorized('Invalid login or password', 'invalid_credentials')
    await this.clearFailures(key)
    // The ministry and the Super Admins: the password only opens the next step — the authenticator code (MfaService).
    const challenge = await this.mfa.gate(user)
    if (challenge) return challenge
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

    // The Google account id ("sub") is the only key: e-mail, its local part or the login never identify an account,
    // otherwise another Google account with the same name before "@" would sign into someone else's account.
    const googleId = profile.googleId.trim()
    if (!googleId) throw AppError.invalid('incomplete_google_profile', 'Incomplete Google profile')
    let user = await this.prisma.client.user.findUnique({ where: { tenantId_googleId: { tenantId, googleId } }, include: USER_INCLUDE })

    if (!user) {
      const role = profile.role ?? 'STUDENT'
      const roles = SELF_SERVICE_ROLES[role]
      const login = await this.freeUserLogin(tenantId, loginCandidate)
      const now = new Date()
      let created: UserRow
      try {
        created = await this.createGoogleUser(tenantId, { googleId, login, displayName: profile.displayName.trim() || email, preferredLang, roles, role, now })
      } catch (err) {
        // Two first sign-ins of the same Google account at once: the other request created it — use that account.
        if ((err as { code?: string }).code !== 'P2002') throw err
        const winner = await this.prisma.client.user.findUnique({ where: { tenantId_googleId: { tenantId, googleId } }, include: USER_INCLUDE })
        if (!winner) throw err
        return this.finishGoogleLogin(winner, googleId, email, meta)
      }
      await this.audit.record({ action: 'auth.register', entityType: 'User', entityId: created.id, after: { roles: created.roles, method: 'google', googleId, email } })
      return this.openSession(created, meta)
    }
    return this.finishGoogleLogin(user, googleId, email, meta)
  }

  private async finishGoogleLogin(user: UserRow, googleId: string, email: string, meta: SessionMeta): Promise<LoginResult> {
    if (!user.isActive) throw new AppError('account_disabled', 'Account disabled', HttpStatus.FORBIDDEN)
    this.mfa.refuseOtherSignIn(user)
    const updated = await this.prisma.client.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() }, include: USER_INCLUDE })
    await this.audit.record({ action: 'auth.login', entityType: 'User', entityId: user.id, after: { method: 'google', googleId, email } })
    return this.openSession(updated, meta)
  }

  private createGoogleUser(
    tenantId: string,
    input: { googleId: string; login: string; displayName: string; preferredLang: Lang; roles: Role[]; role: 'STUDENT' | 'TEACHER'; now: Date },
  ): Promise<UserRow> {
    const { googleId, login, preferredLang, roles, role, now } = input
    return this.prisma.client.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          tenantId,
          googleId,
          login,
          displayName: input.displayName,
          preferredLang,
          roles,
          lastLoginAt: now,
          // Google sign-in shows no offer/consent checkboxes, so consent must NOT be stamped here — recording it
          // would be recording a consent the user never gave (Ж11). Left null, the client's ConsentGate
          // (needsConsent) requires the two marks before the workspace opens, via /auth/consent.
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
    return this.publicUser(user)
  }

  /** The account as the web sees it, with the roles of the token and whether a new password is due. */
  async publicUser(user: UserRow, roles?: Role[]): Promise<PublicUser> {
    const effective = roles ?? (await this.effectiveRoles(user))
    return this.toPublic(user, effective, await this.passwordChangeRequired(user, effective))
  }

  /**
   * A password the Super Admin issued (ministry account created or reset) and not changed by its owner since:
   * `User.passwordIssuedAt`; for accounts from before that column, the audit log, which records both.
   */
  async passwordChangeRequired(user: { id: string; tenantId: string; passwordIssuedAt?: Date | null }, roles: Role[]): Promise<boolean> {
    // Any account the Super Admin reset; ministry accounts from before the column — through the journal.
    if (user.passwordIssuedAt) return true
    if (!roles.includes('MINISTRY')) return false
    // The account's own tenant: a refresh runs before any tenant is known.
    return TenantContext.forTenant(user.tenantId, async () => {
      const issued = await this.prisma.client.auditEvent.findFirst({ where: { entityType: 'User', entityId: user.id, action: { in: [...ADMIN_ISSUED_PASSWORD] } }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } })
      if (!issued) return false
      const changed = await this.prisma.client.auditEvent.findFirst({ where: { entityType: 'User', entityId: user.id, action: 'auth.password.change', createdAt: { gt: issued.createdAt } }, select: { id: true } })
      return !changed
    })
  }

  /**
   * «Сменить пароль» (security review 10.11 №4): the current password, then a new one (8–128, not the same). Every
   * session of the account ends — a stolen password stops working everywhere — and this browser gets a fresh one.
   */
  async changePassword(user: { id: string; tenantId: string }, input: { currentPassword: string; newPassword: string }, meta: SessionMeta): Promise<LoginResult> {
    const row = await this.prisma.client.user.findFirst({ where: { id: user.id }, include: USER_INCLUDE })
    if (!row?.isActive) throw AppError.unauthorized('Authentication required')
    if (!row.passwordHash) throw AppError.invalid('no_password', 'This account signs in without a password')
    if (!(await argon2.verify(row.passwordHash, input.currentPassword))) throw AppError.invalid('wrong_password', 'The current password is wrong')
    if (input.newPassword === input.currentPassword) throw AppError.invalid('same_password', 'Choose a password different from the current one')
    if (row.login && input.newPassword.toLowerCase() === row.login) throw AppError.invalid('password_is_login', 'The password must not be the login')
    // An account that signs in with the authenticator code keeps the time of that sign-in: changing the password does
    // not restart its 12 hours. With no live session to continue, the new one cannot be renewed — sign in with the code.
    const startedAt = this.mfa.enforced(row) ? await this.mfaSessionStart(row.id) : undefined
    const updated = await this.prisma.client.user.update({ where: { id: row.id }, data: { passwordHash: await argon2.hash(input.newPassword, PASSWORD_HASH), passwordIssuedAt: null }, include: USER_INCLUDE })
    await this.tokens.revokeAllForUser(row.tenantId, row.id, 'password-changed')
    await this.audit.record({ tenantId: row.tenantId, action: 'auth.password.change', entityType: 'User', entityId: row.id })
    return this.openSession(updated, meta, startedAt)
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

  /** When the newest live session of the account began (its family's first row); epoch when there is none. */
  private async mfaSessionStart(userId: string): Promise<Date> {
    const last = await this.prisma.client.refreshSession.findFirst({ where: { userId, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' }, select: { familyId: true } })
    if (!last) return new Date(0)
    const first = await this.prisma.client.refreshSession.findFirst({ where: { userId, familyId: last.familyId }, orderBy: { createdAt: 'asc' }, select: { createdAt: true } })
    return first?.createdAt ?? new Date(0)
  }

  async openSession(user: UserRow, meta: SessionMeta, startedAt?: Date): Promise<LoginResult> {
    const roles = await this.effectiveRoles(user)
    const pub = await this.publicUser(user, roles)
    const accessToken = await this.tokens.signAccess({ id: user.id, tenantId: user.tenantId, roles, centerId: user.centerId, teacherProfileId: user.teacherProfile?.id ?? null, institutionId: user.institutionId, companyId: user.companyId, passwordChangeRequired: pub.passwordChangeRequired })
    const refresh = await this.tokens.issueRefresh(user.id, user.tenantId, meta, undefined, startedAt)
    return { accessToken, expiresInSeconds: this.env.JWT_ACCESS_TTL_SECONDS, refresh: { raw: refresh.raw, expiresAt: refresh.expiresAt }, user: pub }
  }

  private toPublic(user: UserRow, roles: Role[], passwordChangeRequired: boolean): PublicUser {
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
      passwordChangeRequired,
    }
  }

  private async freeTeacherSlug(tx: TransactionClient, tenantId: string, base: string): Promise<string> {
    const root = base.replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'teacher'
    for (let n = 0; n < 50; n++) {
      const slug = n === 0 ? root : `${root}-${n + 1}`
      if (!(await tx.teacherProfile.findFirst({ where: { tenantId, slug }, select: { id: true }, includeDeleted: true } as never))) return slug
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
  /**
   * One attempt, counted atomically before the password is checked; past LOGIN_MAX_FAILURES attempts in the window
   * the account is locked (429) whatever the password. A successful sign-in clears the count.
   */
  private async countAttempt(key: string) {
    let count: number
    let ttl = this.env.LOGIN_LOCK_SECONDS
    if (this.redis.off) {
      const now = Date.now()
      const rec = this.memoryFailures.get(key)
      const cur = rec && rec.expires > now ? rec : { count: 0, expires: now + this.env.LOGIN_LOCK_SECONDS * 1000 }
      cur.count += 1
      this.memoryFailures.set(key, cur)
      count = cur.count
      ttl = Math.ceil((cur.expires - now) / 1000)
    } else {
      try {
        count = await this.redis.cache.incr(key)
        if (count === 1) await this.redis.cache.expire(key, this.env.LOGIN_LOCK_SECONDS)
        else ttl = Math.max(1, await this.redis.cache.ttl(key))
      } catch {
        throw AppError.unavailable('Sign-in is temporarily unavailable, please try again shortly')
      }
    }
    if (count > this.env.LOGIN_MAX_FAILURES) throw AppError.tooMany('Too many failed sign-in attempts; try again later', ttl)
  }

  private async clearFailures(key: string) {
    if (this.redis.off) { this.memoryFailures.delete(key); return }
    await this.redis.cache.del(key).catch(() => undefined)
  }
}
