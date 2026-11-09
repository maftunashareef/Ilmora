import { type CanActivate, type ExecutionContext, HttpStatus, Inject, Injectable, SetMetadata } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import type { Role } from '../generated/prisma/enums'
import type { RequestActor } from '../infra/tenancy/tenant-context'
import type { AuthenticatedRequest } from './decorators'
import { AppError } from './errors'

/**
 * Access rules of the registry (ТЗ «реестр учреждений, компании, студенты», 9.2 and 9.4):
 *  - the new roles;
 *  - `@Approved(kind)`: the account's institution or company must be approved, otherwise 403 `not_approved`;
 *  - `ownInstitutionId` / `ownCompanyId`: the scope every query filters by, taken from the session, never from the request.
 */

/**
 * Registry roles. The data engineer's migration adds them to `enum Role`; until then they are not in the generated
 * type, hence the cast. Once the enum has them, replace `REGISTRY_ROLES.X` with the plain literal and delete this.
 */
export const REGISTRY_ROLES = {
  INSTITUTION_ADMIN: 'INSTITUTION_ADMIN' as unknown as Role,
  COMPANY_ADMIN: 'COMPANY_ADMIN' as unknown as Role,
  MINISTRY: 'MINISTRY' as unknown as Role,
} as const

export type OrgKind = 'institution' | 'company'
/** Review status of an institution's or company's profile (ТЗ 4.2, 4.3). */
export type OrgStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'BLOCKED'

/**
 * Reads the current review status. Read from the database on every request (a short Redis cache is fine), not from
 * the token: a rejection or a block must take effect at once, not when the access token expires.
 */
export interface OrgStatusReader {
  status(kind: OrgKind, id: string): Promise<OrgStatus | null>
}
export const ORG_STATUS_READER = Symbol('ORG_STATUS_READER')

/** Until the registry tables exist no account has an institution or company, so nothing is approved (fail closed). */
@Injectable()
export class StubOrgStatusReader implements OrgStatusReader {
  async status(): Promise<OrgStatus | null> {
    return null
  }
}

export const APPROVED_KEY = 'ilmora:approved'
/** The handler (or controller) needs the account's institution / company to be APPROVED. */
export const Approved = (kind: OrgKind) => SetMetadata(APPROVED_KEY, kind)

export function orgIdOf(actor: RequestActor | undefined, kind: OrgKind): string | null {
  if (!actor) return null
  return (kind === 'institution' ? actor.institutionId : actor.companyId) ?? null
}

/** Runs after AuthGuard and RolesGuard. The Super Admin gets no bypass: approved-only routes act on one's own organization. */
@Injectable()
export class ApprovedGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, @Inject(ORG_STATUS_READER) private readonly reader: OrgStatusReader) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const kind = this.reflector.getAllAndOverride<OrgKind | undefined>(APPROVED_KEY, [ctx.getHandler(), ctx.getClass()])
    if (!kind) return true
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>()
    const id = orgIdOf(req.actor, kind)
    const status = id ? await this.reader.status(kind, id) : null
    if (status !== 'APPROVED') {
      throw new AppError('not_approved', kind === 'institution' ? 'The institution is not approved yet' : 'The company is not approved yet', HttpStatus.FORBIDDEN, { status })
    }
    return true
  }
}

/** The institution this account represents. A missing one reads as «not found», never as someone else's. */
export function ownInstitutionId(actor: RequestActor): string {
  if (!actor.institutionId) throw AppError.notFound('Institution')
  return actor.institutionId
}

/** The company this account represents. */
export function ownCompanyId(actor: RequestActor): string {
  if (!actor.companyId) throw AppError.notFound('Company')
  return actor.companyId
}
