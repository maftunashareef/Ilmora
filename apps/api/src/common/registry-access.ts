import { type CanActivate, type ExecutionContext, HttpStatus, Injectable, SetMetadata } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { PrismaService } from '../infra/prisma/prisma.service'
import type { AuthenticatedRequest } from './decorators'
import { AppError } from './errors'

/**
 * Access rules of the registry (ТЗ «реестр учреждений, компании, студенты», 9.2 and 9.4).
 * `@Approved(kind)`: the account's institution or company must have been approved, otherwise 403 `not_approved`.
 * The organization an account represents is always read from the database (`User.institutionId` / `User.companyId`),
 * never from the request or the token.
 */

export type OrgKind = 'institution' | 'company'

export const APPROVED_KEY = 'ilmora:approved'
/** The handler (or controller) needs the account's institution / company to have been approved. */
export const Approved = (kind: OrgKind) => SetMetadata(APPROVED_KEY, kind)

/**
 * Runs after AuthGuard and RolesGuard. A record the Super Admin blocked (`blockedAt`) answers 403 `not_approved` as
 * well — its workspace is closed whatever its review status.
 * The workspace is open once the organization the account represents was approved
 * (`approvedAt` set): an approved institution whose change of the name waits for review (`pendingChanges`) keeps
 * working (docs/registry/data-model.md). The organization is found by its representative in the database — not by the token —
 * so a fresh claim works at once and a withdrawn approval or representative takes effect at once.
 * The Super Admin gets no bypass: approved-only routes act on one's own organization.
 */
@Injectable()
export class ApprovedGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const kind = this.reflector.getAllAndOverride<OrgKind | undefined>(APPROVED_KEY, [ctx.getHandler(), ctx.getClass()])
    if (!kind) return true
    const actorId = ctx.switchToHttp().getRequest<AuthenticatedRequest>().actor?.id
    if (!actorId || !(await this.isApproved(kind, actorId))) {
      throw new AppError('not_approved', kind === 'institution' ? 'The institution is not approved yet' : 'The company is not approved yet', HttpStatus.FORBIDDEN)
    }
    return true
  }

  private async isApproved(kind: OrgKind, userId: string): Promise<boolean> {
    const where = { representative: { is: { id: userId } }, approvedAt: { not: null }, blockedAt: null }
    const row = kind === 'institution'
      ? await this.prisma.client.institution.findFirst({ where: { ...where, mergedIntoId: null }, select: { id: true } })
      : await this.prisma.client.company.findFirst({ where, select: { id: true } })
    return row !== null
  }
}
