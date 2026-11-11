import { applyDecorators, createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { Throttle } from '@nestjs/throttler'
import type { Request } from 'express'
import type { Role } from '../generated/prisma/enums'
import type { RequestActor } from '../infra/tenancy/tenant-context'

export const IS_PUBLIC_KEY = 'ilmora:public'
/** Marks a route as reachable without an access token (tenant still resolved from header/default). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true)

export const WITH_ISSUED_PASSWORD_KEY = 'ilmora:with-issued-password'
/** Open while the password issued by the Super Admin is not changed yet: the change itself and «who am I». */
export const AllowWithIssuedPassword = () => SetMetadata(WITH_ISSUED_PASSWORD_KEY, true)

export const ROLES_KEY = 'ilmora:roles'
/** Any of the listed roles grants access (PLATFORM_ADMIN always passes). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles)

export interface AuthenticatedRequest extends Request {
  actor?: RequestActor
  tenantId?: string
}

/** pino-http assigns `req.id`; normalise it to a string for audit/log correlation. */
export const requestIdOf = (req: Request): string | undefined => {
  const id = (req as Request & { id?: unknown }).id
  return id === undefined || id === null ? undefined : String(id)
}

export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestActor => {
  const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>()
  if (!req.actor) throw new Error('CurrentActor used on a route without authentication')
  return req.actor
})

export const CurrentTenantId = createParamDecorator((_: unknown, ctx: ExecutionContext): string => {
  const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>()
  if (!req.tenantId) throw new Error('Tenant not resolved for request')
  return req.tenantId
})

export const ClientInfo = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>()
  return { ip: req.ip ?? '', userAgent: (req.headers['user-agent'] ?? '').slice(0, 300), requestId: requestIdOf(req) }
})
export type ClientInfoValue = { ip: string; userAgent: string; requestId?: string }

export const AUTH_THROTTLE_KEY = 'ilmora:auth-throttle'
/**
 * Puts a route under the strict "auth" throttler (login, OTP, registration). Only routes marked with this are
 * counted by it — every other route is governed by the "default" throttler alone. Requests are counted per client IP.
 */
export const AuthThrottle = (limit: number, ttl = 60_000) => applyDecorators(SetMetadata(AUTH_THROTTLE_KEY, true), Throttle({ auth: { limit, ttl } }))

export const REGISTER_THROTTLE_KEY = 'ilmora:register-throttle'
/**
 * New accounts per address over an hour and a day (cybersecurity check 9.4, Н-4), on top of @AuthThrottle's minute. Wide
 * on purpose: a whole technikum signs up from one Wi-Fi in a lesson (the lesson of №19); the SMS code and the per-phone
 * limits stop the rest. Limits — RATE_LIMIT_REGISTER_PER_IP_HOUR / _DAY.
 */
export const RegisterThrottle = () => SetMetadata(REGISTER_THROTTLE_KEY, true)
export const isRegisterThrottled = (ctx: ExecutionContext): boolean =>
  reflector.getAllAndOverride<boolean | undefined>(REGISTER_THROTTLE_KEY, [ctx.getHandler(), ctx.getClass()]) === true

export const SESSION_THROTTLE_KEY = 'ilmora:session-throttle'
/**
 * The session refresh (security review 10.11 №19): like @AuthThrottle(limit), but counted per refresh cookie, not per
 * address — a classroom on one Wi-Fi renews many sessions at the start of a lesson. Per address only the wide
 * `refreshIp` limit (RATE_LIMIT_REFRESH_PER_IP_MINUTE) applies, against someone trying values in bulk.
 */
export const SessionThrottle = (limit: number, ttl = 60_000) => applyDecorators(AuthThrottle(limit, ttl), SetMetadata(SESSION_THROTTLE_KEY, true))
export const isSessionThrottled = (ctx: ExecutionContext): boolean =>
  reflector.getAllAndOverride<boolean | undefined>(SESSION_THROTTLE_KEY, [ctx.getHandler(), ctx.getClass()]) === true

/** True when the handler (or its controller) opted into the "auth" throttler via @AuthThrottle(). */
const reflector = new Reflector()
export const isAuthThrottled = (ctx: ExecutionContext): boolean =>
  reflector.getAllAndOverride<boolean | undefined>(AUTH_THROTTLE_KEY, [ctx.getHandler(), ctx.getClass()]) === true
