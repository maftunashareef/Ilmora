import { Inject, Injectable } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import type { CookieOptions } from 'express'
import { randomUUID } from 'node:crypto'
import { randomToken, sha256 } from '../../common/crypto'
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
  iat: number
  exp: number
}

export interface SessionMeta { ip?: string; userAgent?: string }

export const REFRESH_COOKIE = 'ilmora_refresh'

/** Access JWTs (short-lived) and refresh sessions (opaque values stored as SHA-256 hashes, rotated on every use). */
@Injectable()
export class TokenService {
  constructor(private readonly jwt: JwtService, @Inject(ENV) private readonly env: Env, private readonly prisma: PrismaService) {}

  signAccess(user: { id: string; tenantId: string; roles: Role[]; centerId?: string | null; teacherProfileId?: string | null }): Promise<string> {
    return this.jwt.signAsync(
      { tid: user.tenantId, roles: user.roles, cid: user.centerId ?? undefined, tpid: user.teacherProfileId ?? undefined },
      { subject: user.id, expiresIn: this.env.JWT_ACCESS_TTL_SECONDS },
    )
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
    const session = await TenantContext.system(() => this.prisma.client.refreshSession.findUnique({ where: { tokenHash: hash } }))
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
    await TenantContext.system(() => this.prisma.client.refreshSession.updateMany({ where: { tokenHash: hash, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: reason } }))
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
