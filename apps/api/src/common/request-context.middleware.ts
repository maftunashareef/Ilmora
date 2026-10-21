import { Injectable, type NestMiddleware } from '@nestjs/common'
import type { NextFunction, Response } from 'express'
import { TenantContext, type RequestActor } from '../infra/tenancy/tenant-context'
import { TokenService } from '../modules/auth/token.service'
import { TenantsService } from '../modules/tenants/tenants.service'
import { type AuthenticatedRequest, requestIdOf } from './decorators'
import { AppError } from './errors'

/**
 * Runs for every request before guards:
 *  1. verifies the access token if present (invalid tokens are rejected here, never silently ignored);
 *  2. resolves the tenant: token claim → X-Tenant header → default tenant;
 *  3. opens the AsyncLocalStorage tenant context that Prisma and the audit service rely on.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(private readonly tokens: TokenService, private readonly tenants: TenantsService) {}

  async use(req: AuthenticatedRequest, res: Response, next: NextFunction) {
    // Liveness/readiness must not depend on tenant resolution (the database may be the thing that is down).
    if ((req.originalUrl ?? req.url).startsWith('/health')) return next()
    try {
      let actor: RequestActor | undefined
      let tenantId: string | undefined
      const header = req.headers.authorization
      if (typeof header === 'string' && header.startsWith('Bearer ')) {
        const claims = await this.tokens.verifyAccess(header.slice(7).trim())
        actor = { id: claims.sub, roles: claims.roles, centerId: claims.cid ?? null, teacherProfileId: claims.tpid ?? null }
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
