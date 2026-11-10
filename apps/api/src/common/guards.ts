import { type CanActivate, type ExecutionContext, HttpStatus, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ThrottlerGuard } from '@nestjs/throttler'
import type { Role } from '../generated/prisma/enums'
import { type AuthenticatedRequest, IS_PUBLIC_KEY, isAuthThrottled, ROLES_KEY, WITH_ISSUED_PASSWORD_KEY } from './decorators'
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

/**
 * A password the Super Admin issued (ministry accounts) must be changed before anything else (security review 10.11
 * №4): with the token claim set, every route but the change of password, «who am I» and the public ones (sign-in,
 * refresh, logout, the authenticator steps) answers 403 `password_change_required`. The new token after the change
 * carries no claim.
 */
@Injectable()
export class PasswordChangeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext): boolean {
    const actor = ctx.switchToHttp().getRequest<AuthenticatedRequest>().actor
    if (!actor?.passwordChangeRequired) return true
    const open = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]) || this.reflector.getAllAndOverride<boolean>(WITH_ISSUED_PASSWORD_KEY, [ctx.getHandler(), ctx.getClass()])
    if (open) return true
    throw new AppError('password_change_required', 'Change the temporary password first', HttpStatus.FORBIDDEN)
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
 * Throttler keyed by actor id for authenticated traffic and by client IP otherwise. The strict «auth» routes (sign-in,
 * one-time codes, registration, password) always count by IP: a token attached to them must not give a fresh counter
 * (security review 10.11 №2).
 * Never key on request-body fields (e.g. phone): the client controls them, so each new value would get a fresh
 * counter and one IP could send OTP SMS to any number of phones. Per-phone limits live in OtpService instead.
 */
@Injectable()
export class AppThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>, context?: ExecutionContext): Promise<string> {
    const r = req as unknown as AuthenticatedRequest
    if (context && isAuthThrottled(context)) return `ip:${r.ip ?? 'unknown'}`
    if (r.actor?.id) return `u:${r.actor.id}`
    return `ip:${r.ip ?? 'unknown'}`
  }
}
