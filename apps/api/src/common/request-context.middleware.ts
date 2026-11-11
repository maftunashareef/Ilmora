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

type AccountState = { roles: Role[]; isOwner: boolean; centerId: string | null; institutionId: string | null; companyId: string | null; issuedPassword: boolean }

/** Whether a token still says what the account is (the owner's roles as AccountService.effectiveRoles gives them). */
function matches(state: AccountState | null, claims: { roles: Role[]; cid?: string | null; iid?: string | null; coid?: string | null; pwc?: boolean }): boolean {
  if (!state) return false
  const effective: Role[] = state.roles.filter((r) => r !== 'PLATFORM_ADMIN')
  if (state.isOwner) for (const r of ['PLATFORM_ADMIN', 'FINANCE_ADMIN'] as Role[]) if (!effective.includes(r)) effective.push(r)
  const sameRoles = effective.length === claims.roles.length && effective.every((r) => claims.roles.includes(r))
  const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? null) === (b ?? null)
  // A password issued by the Super Admin after the token was signed: the token must carry «change it first».
  return sameRoles && same(state.centerId, claims.cid) && same(state.institutionId, claims.iid) && same(state.companyId, claims.coid) && (!state.issuedPassword || claims.pwc === true)
}

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
  private readonly states = new Map<string, { until: number; state: AccountState | null }>()

  private async readState(userId: string, tenantId: string): Promise<AccountState | null> {
    const u = await TenantContext.system(() => this.prisma.client.user.findFirst({ where: { id: userId }, select: { roles: true, isOwner: true, isActive: true, centerId: true, institutionId: true, companyId: true, passwordIssuedAt: true } }), { tenantId })
    const state = u?.isActive ? { roles: u.roles, isOwner: u.isOwner, centerId: u.centerId, institutionId: u.institutionId, companyId: u.companyId, issuedPassword: u.passwordIssuedAt !== null } : null
    if (this.states.size > 50_000) this.states.clear()
    this.states.set(userId, { until: Date.now() + ACTOR_CHECK_MS, state })
    return state
  }

  /**
   * The token's rights are checked against the account (security review 10.11 №29): disabled, deleted, with other roles,
   * another center, institution or company, or a password issued since (a reset) — 401 `invalid_token`, and the site
   * renews the session (or signs out). One read per account every ACTOR_CHECK_MS, not per request; a token that does not
   * match the cached state is checked against the database once more before it is refused, so a token issued after a
   * change of roles is not turned away by the cache (review 11.11).
   */
  private async assertCurrent(userId: string, tenantId: string, claims: { roles: Role[]; cid?: string | null; iid?: string | null; coid?: string | null; pwc?: boolean }) {
    const rec = this.states.get(userId)
    let state = rec && rec.until > Date.now() ? rec.state : await this.readState(userId, tenantId)
    if (rec && rec.until > Date.now() && !matches(state, claims)) state = await this.readState(userId, tenantId)
    if (!state) throw AppError.unauthorized('The account is disabled', 'invalid_token')
    if (!matches(state, claims)) throw AppError.unauthorized('The account changed; renew the session', 'invalid_token')
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
        await this.assertCurrent(claims.sub, claims.tid, claims)
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
