import { Inject, Injectable } from '@nestjs/common'
import { formatUzPhone } from '@ilmora/shared'
import { ENV, type Env } from '../../config/env'
import { PrismaService } from '../../infra/prisma/prisma.service'
import { TenantContext } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { AccountService, type LoginResult, type PublicUser } from './account.service'
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
      if (!user.isActive) throw Object.assign(new Error('Account disabled'), { status: 403 })
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
    if (!user || !user.isActive) throw Object.assign(new Error('Account disabled'), { status: 403 })
    const roles = await this.accounts.effectiveRoles(user)
    const accessToken = await this.tokens.signAccess({ id: user.id, tenantId: user.tenantId, roles, centerId: user.centerId, teacherProfileId: user.teacherProfile?.id ?? null })
    return { accessToken, expiresInSeconds: this.env.JWT_ACCESS_TTL_SECONDS, refresh: { raw: rotated.raw, expiresAt: rotated.expiresAt }, user: this.accounts.toPublic(user, roles) }
  }

  async logout(raw: string | undefined): Promise<void> {
    if (raw) await this.tokens.revoke(raw, 'logout')
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.prisma.client.user.findUnique({ where: { id: userId }, include: USER_INCLUDE })
    if (!user) throw Object.assign(new Error('User not found'), { status: 404 })
    return this.accounts.toPublic(user, await this.accounts.effectiveRoles(user))
  }

  /** Profile fields only: roles, login and password are not reachable from here. */
  async updateProfile(userId: string, patch: { displayName?: string; district?: string; preferredLang?: 'uz' | 'ru' | 'en'; reminders?: boolean }): Promise<PublicUser> {
    const user = await this.prisma.client.user.update({ where: { id: userId }, data: patch, include: USER_INCLUDE })
    return this.accounts.toPublic(user, await this.accounts.effectiveRoles(user))
  }
}
