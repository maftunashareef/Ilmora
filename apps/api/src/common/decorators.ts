import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common'
import type { Request } from 'express'
import type { Role } from '../generated/prisma/enums'
import type { RequestActor } from '../infra/tenancy/tenant-context'

export const IS_PUBLIC_KEY = 'ilmora:public'
/** Marks a route as reachable without an access token (tenant still resolved from header/default). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true)

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
