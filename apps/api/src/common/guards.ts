import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ThrottlerGuard } from '@nestjs/throttler'
import type { Role } from '../generated/prisma/enums'
import { type AuthenticatedRequest, IS_PUBLIC_KEY, ROLES_KEY } from './decorators'
import { AppError } from './errors'

/** Requires an authenticated actor unless the handler/class is marked @Public(). */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()])
    if (isPublic) return true
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>()
    if (!req.actor) throw AppError.unauthorized('Authentication required')
    return true
  }
}

/** Role check; PLATFORM_ADMIN passes everything. Tenant isolation is enforced separately by the data layer. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()])
    if (!required || required.length === 0) return true
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>()
    const roles = req.actor?.roles ?? []
    if (roles.includes('PLATFORM_ADMIN') || required.some((r) => roles.includes(r))) return true
    throw AppError.forbidden('Insufficient role')
  }
}

/**
 * Throttler keyed by actor id for authenticated traffic and by client IP otherwise.
 * Never key on request-body fields (e.g. phone): the client controls them, so each new value would get a fresh
 * counter and one IP could send OTP SMS to any number of phones. Per-phone limits live in OtpService instead.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const r = req as unknown as AuthenticatedRequest
    if (r.actor?.id) return `u:${r.actor.id}`
    return `ip:${r.ip ?? 'unknown'}`
  }
}
