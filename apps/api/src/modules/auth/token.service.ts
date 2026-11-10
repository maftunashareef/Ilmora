import { Inject, Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { CookieOptions } from 'express'
import { randomUUID } from 'node:crypto'
import { hmacSha256, randomToken, sha256 } from '../../common/crypto'
import { AppError } from '../../common/errors'
import { ENV, type Env } from '../../config/env'
import type { Role } from '../../generated/prisma/enums'
import { PrismaService } from '../../infra/prisma/prisma.service'
import { TenantContext } from '../../infra/tenancy/tenant-context'

export interface AccessClaims {
  sub: string
  tid: string
  roles: Role[]
  cid?: string | null
  tpid?: string | null
  /** Registry: institution and company of the account (INSTITUTION_ADMIN / COMPANY_ADMIN). */
  iid?: string | null
  coid?: string | null
  iat: number
  exp: number
}

export interface SessionMeta { ip?: string; userAgent?: string }

export type MfaStage = 'setup' | 'verify'
export const MFA_CHALLENGE_SECONDS = 300

export const REFRESH_COOKIE = 'ilmora_refresh'
/** Non-HttpOnly companion of the refresh cookie: value \"1\" while a session exists. */
export const SESSION_FLAG = 'ilmora_session'

/** Access JWTs (short-lived) and refresh sessions (opaque values stored as SHA-256 hashes, rotated on every use). */
@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService, @Inject(ENV) private readonly env: Env, private readonly prisma: PrismaService) {}

  signAccess(user: { id: string; tenantId: string; roles: Role[]; centerId?: string | null; teacherProfileId?: string | null; institutionId?: string | null; companyId?: string | null }): Promise<string> {
    return this.jwt.signAsync(
      { tid: user.tenantId, roles: user.roles, cid: user.centerId ?? undefined, tpid: user.teacherProfileId ?? undefined, iid: user.institutionId ?? undefined, coid: user.companyId ?? undefined },
      { subject: user.id, expiresIn: this.env.JWT_ACCESS_TTL_SECONDS },
    )
  }

  /**
   * The pass between a correct password and the authenticator code (5 minutes). Signed with a key derived from the
   * access secret and a different audience, so it can never be used as an access token.
   */
  signMfaChallenge(user: { id: string; tenantId: string }, stage: MfaStage): Promise<string> {
    return this.jwt.signAsync({ tid: user.tenantId, stage }, { subject: user.id, expiresIn: MFA_CHALLENGE_SECONDS, secret: this.mfaSecret(), audience: 'ilmora-mfa' })
  }

  async verifyMfaChallenge(token: string): Promise<{ userId: string; tenantId: string; stage: MfaStage }> {
    try {
      const c = await this.jwt.verifyAsync<{ sub: string; tid: string; stage: MfaStage }>(token, { secret: this.mfaSecret(), audience: 'ilmora-mfa' })
      if (!c.sub || !c.tid || (c.stage !== 'setup' && c.stage !== 'verify')) throw new Error('bad claims')
      return { userId: c.sub, tenantId: c.tid, stage: c.stage }
    } catch {
      throw AppError.unauthorized('The sign-in step has expired; enter the login and password again', 'invalid_challenge')
    }
  }

  private mfaSecret(): string {
    return hmacSha256(this.env.JWT_ACCESS_SECRET, 'ilmora-mfa-challenge')
  }

  async verifyAccess(token: string): Promise<AccessClaims> {
    try {
      return await this.jwt.verifyAsync<AccessClaims>(token)
    } catch {
      throw AppError.unauthorized('Invalid or expired access token', 'invalid_token')
    }
  }

  async issueRefresh(userId: string, tenantId: string, meta: SessionMeta, familyId = randomUUID()): Promise<{ raw: string; expiresAt: Date; familyId: string }> {
    const raw = randomToken(48)
    const expiresAt = new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000)
    await TenantContext.forTenant(tenantId, () =>
      this.prisma.client.refreshSession.create({
        data: { tenantId, userId, familyId, tokenHash: sha256(raw), expiresAt, ip: meta.ip, userAgent: meta.userAgent },
      }),
    )
    return { raw, expiresAt, familyId }
  }

  /**
   * Exchange a refresh value for a new pair. A value that was already rotated or revoked is treated as
   * compromised: every session in its family is revoked and the request fails with `invalid_refresh`.
   */
  async rotate(raw: string, meta: SessionMeta): Promise<{ userId: string; tenantId: string; raw: string; expiresAt: Date; familyId: string }> {
    const hash = sha256(raw)
    // The token hash is globally unique and not yet tied to a tenant, so look it up without tenant scoping; all
    // writes below run under the session's own tenant. (Ж13: a request-tenant-scoped lookup only matched one org.)
    const session = await TenantContext.crossTenant(() => this.prisma.client.refreshSession.findUnique({ where: { tokenHash: hash } }))
    if (!session) throw AppError.unauthorized('Refresh session not found', 'invalid_refresh')
    const now = new Date()
    if (session.revokedAt || session.rotatedAt) {
      await this.revokeFamily(session.tenantId, session.familyId, 'reuse-detected')
      throw AppError.unauthorized('Refresh session is no longer valid', 'invalid_refresh')
    }
    if (session.expiresAt <= now) throw AppError.unauthorized('Refresh session expired', 'invalid_refresh')

    const next = await TenantContext.forTenant(session.tenantId, () =>
      this.prisma.tx(async (tx) => {
        // Only one concurrent request may rotate this session: the conditional update is the lock.
        const claimed = await tx.refreshSession.updateMany({ where: { id: session.id, rotatedAt: null, revokedAt: null }, data: { rotatedAt: now } })
        if (claimed.count !== 1) throw AppError.unauthorized('Refresh session is no longer valid', 'invalid_refresh')
        const nextRaw = randomToken(48)
        const expiresAt = new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000)
        const created = await tx.refreshSession.create({
          data: { tenantId: session.tenantId, userId: session.userId, familyId: session.familyId, tokenHash: sha256(nextRaw), expiresAt, ip: meta.ip, userAgent: meta.userAgent },
        })
        await tx.refreshSession.update({ where: { id: session.id }, data: { replacedById: created.id } })
        return { raw: nextRaw, expiresAt }
      }),
    )
    return { userId: session.userId, tenantId: session.tenantId, familyId: session.familyId, ...next }
  }

  async revoke(raw: string, reason: string): Promise<void> {
    const hash = sha256(raw)
    // Same as rotate: find the session by its globally-unique hash without tenant scoping, so logout revokes it
    // regardless of which org's host made the request (Ж13).
    await TenantContext.crossTenant(() => this.prisma.client.refreshSession.updateMany({ where: { tokenHash: hash, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } }))
  }

  async revokeFamily(tenantId: string, familyId: string, reason: string): Promise<void> {
    await TenantContext.forTenant(tenantId, () =>
      this.prisma.client.refreshSession.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } }),
    )
  }

  async revokeAllForUser(tenantId: string, userId: string, reason: string): Promise<void> {
    await TenantContext.forTenant(tenantId, () =>
      this.prisma.client.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } }),
    )
  }

  /** HTTP-only cookie scoped to the auth routes only, so it is never sent with ordinary API calls. */
  /** Readable-by-script flag that a refresh cookie exists, so the web app only calls /auth/refresh when it can succeed. */
  flagCookieOptions(expiresAt?: Date): CookieOptions {
    return { httpOnly: false, secure: this.env.COOKIE_SECURE, sameSite: 'lax', path: '/', domain: this.env.COOKIE_DOMAIN, expires: expiresAt ?? new Date(0) }
  }

  cookieOptions(expiresAt?: Date): CookieOptions {
    return {
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: 'lax',
      path: `/${this.env.API_GLOBAL_PREFIX}/auth`,
      domain: this.env.COOKIE_DOMAIN,
      expires: expiresAt ?? new Date(0),
    }
  }
}
