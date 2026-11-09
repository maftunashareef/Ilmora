import { type CanActivate, type ExecutionContext, HttpStatus, Injectable, SetMetadata } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { PrismaService } from '../infra/prisma/prisma.service'
import type { RequestActor } from '../infra/tenancy/tenant-context'
import type { AuthenticatedRequest } from './decorators'
import { AppError } from './errors'

/**
 * Access rules of the registry (ТЗ «реестр учреждений, компании, студенты», 9.2 and 9.4):
 *  - `@Approved(kind)`: the account's institution or company must have been approved, otherwise 403 `not_approved`;
 *  - `ownInstitutionId` / `ownCompanyId`: the scope every query filters by, taken from the session, never from the request.
 */

export type OrgKind = 'institution' | 'company'

export const APPROVED_KEY = 'ilmora:approved'
/** The handler (or controller) needs the account's institution / company to have been approved. */
export const Approved = (kind: OrgKind) => SetMetadata(APPROVED_KEY, kind)

export function orgIdOf(actor: RequestActor | undefined, kind: OrgKind): string | null {
  if (!actor) return null
  return (kind === 'institution' ? actor.institutionId : actor.companyId) ?? null
}

/**
 * Runs after AuthGuard and RolesGuard. The workspace is open once the organization was approved (`approvedAt` set):
 * an approved institution that edits its name goes back to PENDING and keeps working (docs/registry/data-model.md).
 * Read from the database on every request, not from the token, so a withdrawn approval takes effect at once.
 * The Super Admin gets no bypass: approved-only routes act on one's own organization.
 */
@Injectable()
export class ApprovedGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const kind = this.reflector.getAllAndOverride<OrgKind | undefined>(APPROVED_KEY, [ctx.getHandler(), ctx.getClass()])
    if (!kind) return true
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>()
    const id = orgIdOf(req.actor, kind)
    if (!id || !(await this.isApproved(kind, id))) {
      throw new AppError('not_approved', kind === 'institution' ? 'The institution is not approved yet' : 'The company is not approved yet', HttpStatus.FORBIDDEN)
    }
    return true
  }

  private async isApproved(kind: OrgKind, id: string): Promise<boolean> {
    const where = { id, approvedAt: { not: null } }
    const row = kind === 'institution'
      ? await this.prisma.client.institution.findFirst({ where: { ...where, mergedIntoId: null }, select: { id: true } })
      : await this.prisma.client.company.findFirst({ where, select: { id: true } })
    return row !== null
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
