import { Injectable, type NestMiddleware } from '@nestjs/common'
import type { NextFunction, Response } from 'express'
import { TenantContext, type RequestActor } from '../infra/tenancy/tenant-context'
import type { Role } from '../generated/prisma/enums'
import { PrismaService } from '../infra/prisma/prisma.service'
import { TokenService } from '../modules/auth/token.service'
import { TenantsService } from '../modules/tenants/tenants.service'
import { type AuthenticatedRequest, requestIdOf } from './decorators'
import { AppError } from './errors'

/** How long an account's state is trusted between reads (security review №29: was the token's 15 minutes). */
export const ACTOR_CHECK_MS = 30_000

/**
 * Runs for every request before guards:
 *  1. verifies the access token if present (invalid tokens are rejected here, never silently ignored);
 *  2. resolves the tenant: token claim → X-Tenant header → default tenant;
 *  3. opens the AsyncLocalStorage tenant context that Prisma and the audit service rely on.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly tokens: TokenService, private readonly tenants: TenantsService, private readonly prisma: PrismaService) {}

  /** Account state by id, kept ACTOR_CHECK_MS: a disabled, deleted or demoted account loses access within that. */
  private readonly states = new Map<string, { until: number; state: { roles: Role[]; isOwner: boolean } | null }>()

  /**
   * The token's rights are checked against the account (security review 10.11 №29): disabled, deleted, or with other
   * roles than the token says — 401 `invalid_token`, and the site renews the session (or signs out). One read per
   * account every ACTOR_CHECK_MS, not per request.
   */
  private async assertCurrent(userId: string, tenantId: string, tokenRoles: Role[]) {
    const now = Date.now()
    let rec = this.states.get(userId)
    if (!rec || rec.until <= now) {
      const u = await TenantContext.system(() => this.prisma.client.user.findFirst({ where: { id: userId }, select: { roles: true, isOwner: true, isActive: true } }), { tenantId })
      rec = { until: now + ACTOR_CHECK_MS, state: u?.isActive ? { roles: u.roles, isOwner: u.isOwner } : null }
      if (this.states.size > 50_000) this.states.clear()
      this.states.set(userId, rec)
    }
    if (!rec.state) throw AppError.unauthorized('The account is disabled', 'invalid_token')
    const effective: Role[] = rec.state.roles.filter((r) => r !== 'PLATFORM_ADMIN')
    if (rec.state.isOwner) for (const r of ['PLATFORM_ADMIN', 'FINANCE_ADMIN'] as Role[]) if (!effective.includes(r)) effective.push(r)
    const same = effective.length === tokenRoles.length && effective.every((r) => tokenRoles.includes(r))
    if (!same) throw AppError.unauthorized('The account’s roles changed; renew the session', 'invalid_token')
  }

  async use(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    // Liveness/readiness must not depend on tenant resolution (the database may be the thing that is down).
    if ((req.originalUrl ?? req.url).startsWith('/health')) return next()
    try {
      let actor: RequestActor | undefined
      let tenantId: string | undefined
      const header = req.headers.authorization
      if (typeof header === 'string' && header.startsWith('Bearer ')) {
        const claims = await this.tokens.verifyAccess(header.slice(7).trim())
        await this.assertCurrent(claims.sub, claims.tid, claims.roles)
        actor = { id: claims.sub, roles: claims.roles, centerId: claims.cid ?? null, teacherProfileId: claims.tpid ?? null, institutionId: claims.iid ?? null, companyId: claims.coid ?? null, passwordChangeRequired: claims.pwc === true }
        tenantId = claims.tid
      }
      if (!tenantId) {
        const tenantHeader = req.headers['x-tenant']
        const tenant = await this.tenants.resolveSlug(typeof tenantHeader === 'string' ? tenantHeader : undefined)
        if (!tenant) throw AppError.notFound('Tenant')
        tenantId = tenant.id
      }
      req.actor = actor
      req.tenantId = tenantId
      const ctx = {
        tenantId,
        system: false,
        actor,
        requestId: requestIdOf(req),
        ip: req.ip,
        userAgent: (req.headers['user-agent'] ?? '').slice(0, 300),
      }
      TenantContext.run(ctx, () => next())
    } catch (err) {
      next(err)
    }
  }
}
