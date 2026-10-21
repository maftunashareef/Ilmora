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
 * Throttler keyed by client IP for anonymous traffic and by actor id for authenticated traffic,
 * plus the normalized phone for OTP endpoints (so one IP cannot drain limits for many phones and vice versa).
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const r = req as unknown as AuthenticatedRequest & { body?: { phone?: string } }
    const ip = r.ip ?? 'unknown'
    if (r.actor?.id) return `u:${r.actor.id}`
    const phone = typeof r.body?.phone === 'string' ? r.body.phone.replace(/\D/g, '') : ''
    return phone ? `ip:${ip}|p:${phone}` : `ip:${ip}`
  }
}
