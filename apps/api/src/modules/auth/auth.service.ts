import { Inject, Injectable } from '@nestjs/common'
import { formatUzPhone } from '@ilmora/shared'
import { AppError } from '../../common/errors'
import { ENV, type Env } from '../../config/env'
import { PrismaService } from '../../infra/prisma/prisma.service'
import { TenantContext } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { AccountService, type LoginResult, type PublicUser } from './account.service'
import { MfaService } from './mfa.service'
import { OtpService } from './otp.service'
import { type SessionMeta, TokenService } from './token.service'

export type { LoginResult, PublicUser } from './account.service'

const USER_INCLUDE = { teacherProfile: { select: { id: true } } } as const

/** One-time-code sign-in (phone), session refresh/logout and the profile endpoints. Role claims come from AccountService. */
@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly otp: OtpService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly accounts: AccountService,
    @Inject(ENV) private readonly env: Env,
    private readonly mfa: MfaService,
  ) {}

  requestOtp(tenantId: string, phone: string, lang: 'uz' | 'ru' | 'en', meta: { ip?: string }) {
    return this.otp.request(tenantId, phone, lang, meta)
  }

  /** Verify the code, create a Student account on first login, open a session. Never grants privileged roles. */
  async verifyOtp(tenantId: string, input: { phone: string; code: string; displayName?: string; lang?: 'uz' | 'ru' | 'en' }, meta: SessionMeta): Promise<LoginResult> {
    const { phoneE164 } = await this.otp.verify(tenantId, input.phone, input.code)
    const now = new Date()
    let user = await this.prisma.client.user.findUnique({ where: { tenantId_phoneE164: { tenantId, phoneE164 } }, include: USER_INCLUDE })
    if (!user) {
      user = await this.prisma.client.user.create({
        data: { tenantId, phoneE164, phoneVerifiedAt: now, lastLoginAt: now, displayName: input.displayName?.trim() || formatUzPhone(phoneE164), preferredLang: input.lang ?? 'uz', roles: ['STUDENT'] },
        include: USER_INCLUDE,
      })
      await this.audit.record({ action: 'auth.register', entityType: 'User', entityId: user.id, after: { roles: user.roles, method: 'otp' } })
    } else {
      if (!user.isActive) throw AppError.forbidden('Account disabled', { code: 'account_disabled' })
      // The ministry and the Super Admins: a one-time SMS code is not the second factor — login, password and the app code.
      this.mfa.refuseOtherSignIn(user)
      user = await this.prisma.client.user.update({
        where: { id: user.id },
        data: { phoneVerifiedAt: user.phoneVerifiedAt ?? now, lastLoginAt: now, ...(input.lang ? { preferredLang: input.lang } : {}) },
        include: USER_INCLUDE,
      })
    }
    await this.audit.record({ action: 'auth.login', entityType: 'User', entityId: user.id, after: { method: 'otp' } })
    return this.accounts.openSession(user, meta)
  }

  async refresh(raw: string, meta: SessionMeta): Promise<LoginResult> {
    const rotated = await this.tokens.rotate(raw, meta)
    const user = await TenantContext.forTenant(rotated.tenantId, () => this.prisma.client.user.findUnique({ where: { id: rotated.userId }, include: USER_INCLUDE }))
    if (!user || !user.isActive) throw AppError.forbidden('Account disabled', { code: 'account_disabled' })
    // A session of the ministry or a Super Admin lives on only if it was opened with the authenticator code.
    if (!(await TenantContext.forTenant(rotated.tenantId, () => this.mfa.allowsRefresh(user, rotated.familyId)))) {
      await TenantContext.forTenant(rotated.tenantId, () => this.tokens.revokeFamily(rotated.tenantId, rotated.familyId, 'mfa-required'))
      throw AppError.unauthorized('Sign in again with the authenticator code', 'invalid_refresh')
    }
    const roles = await this.accounts.effectiveRoles(user)
    const pub = await this.accounts.publicUser(user, roles)
    const accessToken = await this.tokens.signAccess({ id: user.id, tenantId: user.tenantId, roles, centerId: user.centerId, teacherProfileId: user.teacherProfile?.id ?? null, institutionId: user.institutionId, companyId: user.companyId, passwordChangeRequired: pub.passwordChangeRequired })
    return { accessToken, expiresInSeconds: this.env.JWT_ACCESS_TTL_SECONDS, refresh: { raw: rotated.raw, expiresAt: rotated.expiresAt }, user: pub }
  }

  /** Second factor, first sign-in: the secret for the app (QR code). */
  mfaSetup(challenge: string) {
    return this.mfa.setup(challenge)
  }

  /** Second factor, first sign-in: the first code links the app and opens the session; the recovery codes are shown once. */
  async mfaConfirm(challenge: string, code: string, meta: SessionMeta): Promise<LoginResult & { recoveryCodes: string[] }> {
    const { userId, recoveryCodes } = await this.mfa.confirm(challenge, code)
    return { ...(await this.openMfaSession(userId, 'password+totp', meta)), recoveryCodes }
  }

  /** Second factor: a code from the app or a recovery code opens the session. */
  async mfaVerify(challenge: string, code: string, meta: SessionMeta): Promise<LoginResult> {
    const { userId, method } = await this.mfa.verify(challenge, code)
    return this.openMfaSession(userId, method === 'totp' ? 'password+totp' : 'password+recovery_code', meta)
  }

  private async openMfaSession(userId: string, method: string, meta: SessionMeta): Promise<LoginResult> {
    const user = await this.prisma.client.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() }, include: USER_INCLUDE })
    await this.audit.record({ action: 'auth.login', entityType: 'User', entityId: user.id, after: { method } })
    return this.accounts.openSession(user, meta)
  }

  async logout(raw: string | undefined): Promise<void> {
    if (raw) await this.tokens.revoke(raw, 'logout')
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.prisma.client.user.findUnique({ where: { id: userId }, include: USER_INCLUDE })
    if (!user) throw AppError.notFound('User')
    return this.accounts.publicUser(user)
  }

  async updateProfile(userId: string, input: { displayName?: string; district?: string; preferredLang?: 'uz' | 'ru' | 'en'; reminders?: boolean }): Promise<PublicUser> {
    const data: Record<string, unknown> = {}
    if (input.displayName !== undefined) data.displayName = input.displayName.trim()
    if (input.district !== undefined) data.district = input.district.trim()
    if (input.preferredLang !== undefined) data.preferredLang = input.preferredLang
    if (input.reminders !== undefined) data.reminders = input.reminders
    const user = await this.prisma.client.user.update({ where: { id: userId }, data, include: USER_INCLUDE })
    return this.accounts.publicUser(user)
  }

  /**
   * Validates Google ID token or exchanges authorization code, verifies verified email,
   * then delegates account creation or retrieval to AccountService.
   */
  async authenticateGoogle(
    tenantId: string,
    input: { idToken?: string; code?: string; redirectUri?: string; role?: 'STUDENT' | 'TEACHER'; lang?: 'uz' | 'ru' | 'en' },
    meta: SessionMeta,
  ): Promise<LoginResult> {
    let googleId = ''
    let email = ''
    let emailVerified = false
    let displayName = ''

    if (input.idToken) {
      if (this.env.NODE_ENV !== 'production' && input.idToken.startsWith('mock-google-token:')) {
        const parts = input.idToken.split(':')
        googleId = parts[1] || 'dev-google-id'
        email = parts[2] ? decodeURIComponent(parts[2]) : 'student.demo@ilmora.uz'
        displayName = parts[3] ? decodeURIComponent(parts[3]) : 'Google Demo User'
        emailVerified = true
      } else {
        const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(input.idToken)}`)
        if (!res.ok) {
          throw AppError.unauthorized('Invalid Google token', 'invalid_google_token')
        }
        const payload = (await res.json()) as { sub?: string; email?: string; email_verified?: string | boolean; name?: string; aud?: string }
        // A token issued to any other Google app must not open a session here: the audience must be our client id.
        if (!this.env.GOOGLE_CLIENT_ID) {
          throw AppError.invalid('google_unconfigured', 'Google OAuth credentials not configured on server')
        }
        if (payload.aud !== this.env.GOOGLE_CLIENT_ID) {
          throw AppError.unauthorized('Google client mismatch', 'google_client_mismatch')
        }
        googleId = payload.sub ?? ''
        email = payload.email ?? ''
        emailVerified = payload.email_verified === true || payload.email_verified === 'true'
        displayName = payload.name ?? email
      }
    } else if (input.code) {
      if (!this.env.GOOGLE_CLIENT_ID || !this.env.GOOGLE_CLIENT_SECRET) {
        throw AppError.invalid('google_unconfigured', 'Google OAuth credentials not configured on server')
      }
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: input.code,
          client_id: this.env.GOOGLE_CLIENT_ID,
          client_secret: this.env.GOOGLE_CLIENT_SECRET,
          redirect_uri: input.redirectUri || this.env.GOOGLE_CALLBACK_URL || `${this.env.PUBLIC_WEB_URL}/auth/google/callback`,
          grant_type: 'authorization_code',
        }),
      })
      if (!tokenRes.ok) {
        throw AppError.unauthorized('Failed to exchange Google authorization code', 'invalid_google_code')
      }
      const tokenData = (await tokenRes.json()) as { id_token?: string }
      if (!tokenData.id_token) {
        throw AppError.unauthorized('Google did not return an id_token', 'invalid_google_response')
      }
      return this.authenticateGoogle(tenantId, { idToken: tokenData.id_token, role: input.role, lang: input.lang }, meta)
    } else {
      throw AppError.invalid('missing_google_credential', 'Missing Google idToken or code')
    }

    if (!googleId || !email) {
      throw AppError.invalid('incomplete_google_profile', 'Incomplete Google profile')
    }

    return this.accounts.loginWithGoogle(tenantId, { googleId, email, emailVerified, displayName, role: input.role, lang: input.lang }, meta)
  }
}
