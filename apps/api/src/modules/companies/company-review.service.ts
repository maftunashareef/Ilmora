import { Injectable } from '@nestjs/common'
import { type AdminCompanyItemDto, type AdminPage, type CompanyPendingChanges, type CompanyProfileDto, type CompanyReviewDto, type CompanyReviewItemDto, type L, registrySearchKey } from '@ilmora/shared'
import { AppError } from '../../common/errors'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infra/prisma/prisma.service'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { NotificationsService } from '../notifications/notifications.service'
import { INDUSTRY_SELECT, isUniqueViolation, toIndustry } from '../registry/registry.mappers'
import type { AdminCompaniesQuery } from '../institutions/institutions-admin.controller'
import { CompaniesService } from './companies.service'

const iso = (d: Date | null) => d?.toISOString() ?? null
const HISTORY_ACTIONS = ['company.create', 'company.takeover', 'company.submit', 'company.update.review', 'company.certificate.review', 'company.approve', 'company.reject', 'company.change.approve', 'company.change.reject', 'company.block', 'company.unblock', 'company.release']
/** Waiting for a decision: a first review, or a change of an approved company (security review №13, №46). */
const WAITING: Prisma.CompanyWhereInput = { OR: [{ status: 'PENDING' }, { pendingChanges: { not: Prisma.DbNull } }] }
const REP_SELECT = { displayName: true, jobTitle: true, login: true, email: true } as const
const toRep = (r: { displayName: string; jobTitle: string | null; login: string | null; email: string | null } | null) =>
  r ? { name: r.displayName, jobTitle: r.jobTitle, login: r.login, email: r.email } : null
const ADMIN_PAGE = 50
const ITEM_SELECT = {
  id: true, name: true, stir: true, submittedAt: true, approvedAt: true, certificateFileKey: true, pendingChanges: true,
  region: { select: { id: true, slug: true, name: true } },
  industries: { select: { industry: { select: { ...INDUSTRY_SELECT, sortOrder: true } } } },
  representative: { select: REP_SELECT },
} as const satisfies Prisma.CompanySelect
const toItem = (r: Prisma.CompanyGetPayload<{ select: typeof ITEM_SELECT }>): CompanyReviewItemDto => ({
  id: r.id, name: r.name, stir: r.stir,
  region: r.region ? { id: r.region.id, slug: r.region.slug, name: r.region.name as L } : null,
  industries: r.industries.map((i) => i.industry).sort((a, b) => a.sortOrder - b.sortOrder).map(toIndustry),
  submittedAt: iso(r.submittedAt), reReview: r.approvedAt !== null, certificateUploaded: r.certificateFileKey !== null,
  pendingChanges: (r.pendingChanges as CompanyPendingChanges | null) ?? null,
  representative: toRep(r.representative),
})
const notPending = () => AppError.conflict('not_pending', 'The profile is not waiting for a decision')

/**
 * Review of company profiles by ILMORA (ТЗ 4.3: the moderator compares the STIR and the name with the certificate,
 * if needed with the tax service's open data). The Super Admin only; the certificate through a 5-minute link.
 */
@Injectable()
export class CompanyReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly companies: CompaniesService,
  ) {}

  async queue(): Promise<CompanyReviewItemDto[]> {
    const rows = await this.prisma.client.company.findMany({ where: WAITING, orderBy: { submittedAt: 'asc' }, take: 500, select: ITEM_SELECT })
    return rows.map(toItem)
  }

  /** Every company — by STIR (exact), name, status; without a status, the ones somebody represents (issue #50). */
  async search(q: AdminCompaniesQuery): Promise<AdminPage<AdminCompanyItemDto>> {
    const key = q.q ? registrySearchKey(q.q) : ''
    const where: Prisma.CompanyWhereInput = {
      ...(q.status ? { status: q.status } : { representative: { isNot: null } }),
      ...(q.stir ? { stir: q.stir } : {}),
      ...(key ? { searchKey: { contains: key } } : {}),
    }
    const [rows, total] = await Promise.all([
      this.prisma.client.company.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: (q.page - 1) * ADMIN_PAGE, take: ADMIN_PAGE, select: { ...ITEM_SELECT, status: true, blockedAt: true } }),
      this.prisma.client.company.count({ where }),
    ])
    return { items: rows.map((r) => ({ ...toItem(r), status: r.status, approvedAt: iso(r.approvedAt), blocked: r.blockedAt !== null })), total, page: q.page, pageSize: ADMIN_PAGE }
  }

  async detail(id: string): Promise<CompanyReviewDto> {
    const row = await this.prisma.client.company.findFirst({ where: { id }, select: { representative: { select: REP_SELECT } } })
    if (!row) throw AppError.notFound('Company')
    const [profile, history] = await Promise.all([
      this.companies.profileOf(id),
      this.prisma.client.auditEvent.findMany({
        where: { entityType: 'Company', entityId: id, action: { in: HISTORY_ACTIONS } },
        orderBy: { createdAt: 'asc' },
        select: { action: true, reason: true, createdAt: true, actor: { select: { displayName: true } } },
      }),
    ])
    return { profile, representative: toRep(row.representative), history: history.map((h) => ({ action: h.action, reason: h.reason, at: h.createdAt.toISOString(), by: h.actor?.displayName ?? null })) }
  }

  certificate(id: string) {
    return this.companies.certificateLinkOf(id)
  }

  async approve(tenantId: string, actor: RequestActor, id: string): Promise<CompanyProfileDto> {
    const current = await this.pending(id)
    const now = new Date()
    if (current.pendingChanges) return this.decideChange(tenantId, actor, id, { ...current, pendingChanges: current.pendingChanges }, true)
    const moved = await this.prisma.client.company.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'APPROVED', approvedAt: current.approvedAt ?? now, reviewedAt: now, reviewedById: actor.id, rejectReason: null } })
    if (moved.count !== 1) throw notPending()
    await this.audit.record({ action: 'company.approve', entityType: 'Company', entityId: id, before: { status: 'PENDING' }, after: { status: 'APPROVED' } })
    await this.tell(tenantId, current.representativeId, 'company.approved', { companyName: current.name, companyId: id }, `company-decision:${id}:${now.getTime()}`)
    return this.companies.profileOf(id)
  }

  async reject(tenantId: string, actor: RequestActor, id: string, reason: string): Promise<CompanyProfileDto> {
    const current = await this.pending(id)
    const now = new Date()
    if (current.pendingChanges) return this.decideChange(tenantId, actor, id, { ...current, pendingChanges: current.pendingChanges }, false, reason)
    const moved = await this.prisma.client.company.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'REJECTED', reviewedAt: now, reviewedById: actor.id, rejectReason: reason } })
    if (moved.count !== 1) throw notPending()
    await this.audit.record({ action: 'company.reject', entityType: 'Company', entityId: id, before: { status: 'PENDING' }, after: { status: 'REJECTED' }, reason })
    await this.tell(tenantId, current.representativeId, 'company.rejected', { companyName: current.name, companyId: id, reason }, `company-decision:${id}:${now.getTime()}`)
    return this.companies.profileOf(id)
  }

  /** «Отвязать представителя» (security review №17): with a reason; audited. */
  async release(tenantId: string, id: string, reason: string): Promise<CompanyProfileDto> {
    await this.companies.release(tenantId, id, reason)
    return this.companies.profileOf(id)
  }

  /**
   * A change of an approved company — name, STIR, industries (security review №13, №46). Approval moves it into the
   * record (the STIR must still be free: 409 `stir_taken`) and replaces the industries; rejection drops it. The
   * company stays APPROVED with what it had; one decision of two at once counts.
   */
  private async decideChange(tenantId: string, actor: RequestActor, id: string, current: { name: string; representativeId: string | null; pendingChanges: CompanyPendingChanges }, accept: boolean, reason?: string): Promise<CompanyProfileDto> {
    const now = new Date()
    const { industryIds, ...fields } = current.pendingChanges
    try {
      await this.prisma.client.$transaction(async (tx) => {
        const moved = await tx.company.updateMany({
          where: { id, pendingChanges: { not: Prisma.DbNull } },
          data: {
            ...(accept ? { ...fields, ...(fields.name ? { searchKey: registrySearchKey(fields.name) } : {}) } : {}),
            pendingChanges: Prisma.DbNull, status: 'APPROVED', reviewedAt: now, reviewedById: actor.id, rejectReason: accept ? null : (reason ?? null),
          },
        })
        if (moved.count !== 1) throw notPending()
        if (accept && industryIds) {
          await tx.companyIndustry.deleteMany({ where: { companyId: id } })
          if (industryIds.length) await tx.companyIndustry.createMany({ data: industryIds.map((industryId) => ({ companyId: id, industryId })) })
        }
      })
    } catch (err) {
      if (isUniqueViolation(err)) throw AppError.conflict('stir_taken', 'Another company is registered with this STIR')
      throw err
    }
    await this.audit.record({ action: accept ? 'company.change.approve' : 'company.change.reject', entityType: 'Company', entityId: id, after: { change: current.pendingChanges }, reason })
    const type = accept ? 'company.approved' : 'company.rejected'
    await this.tell(tenantId, current.representativeId, type, { companyName: fields.name ?? current.name, companyId: id, ...(reason ? { reason } : {}) }, `company-decision:${id}:${now.getTime()}`)
    return this.companies.profileOf(id)
  }

  /** «Заблокировать» / «Разблокировать» (Super Admin, with a reason): the workspace closes; the review status stays. Audited. */
  async setBlocked(tenantId: string, actor: RequestActor, id: string, blocked: boolean, reason?: string): Promise<CompanyProfileDto> {
    const row = await this.prisma.client.company.findFirst({ where: { id }, select: { name: true, blockedAt: true, representative: { select: { id: true } } } })
    if (!row) throw AppError.notFound('Company')
    if (!!row.blockedAt === blocked) throw AppError.conflict(blocked ? 'already_blocked' : 'not_blocked', blocked ? 'Already blocked' : 'Not blocked')
    await this.prisma.client.company.update({ where: { id }, data: blocked ? { blockedAt: new Date(), blockReason: reason ?? null, blockedById: actor.id } : { blockedAt: null, blockReason: null, blockedById: null } })
    await this.audit.record({ action: blocked ? 'company.block' : 'company.unblock', entityType: 'Company', entityId: id, reason })
    const userId = row.representative?.id
    if (userId) {
      const type = blocked ? 'registry.blocked' : 'registry.unblocked'
      await this.notifications.safely(type, () => this.notifications.notify({ tenantId, userIds: [userId], type, params: { name: row.name, ...(reason ? { reason } : {}) }, dedupeKey: `registry-block:${id}:${Date.now()}` }))
    }
    return this.companies.profileOf(id)
  }

  private async pending(id: string) {
    const row = await this.prisma.client.company.findFirst({ where: { id }, select: { name: true, status: true, approvedAt: true, pendingChanges: true, representative: { select: { id: true } } } })
    if (!row) throw AppError.notFound('Company')
    if (row.status !== 'PENDING' && !row.pendingChanges) throw notPending()
    return { name: row.name, approvedAt: row.approvedAt, representativeId: row.representative?.id ?? null, pendingChanges: (row.pendingChanges as CompanyPendingChanges | null) ?? null }
  }

  private async tell(tenantId: string, userId: string | null, type: 'company.approved' | 'company.rejected', params: Record<string, unknown>, dedupeKey: string) {
    if (!userId) return
    await this.notifications.safely(type, () => this.notifications.notify({ tenantId, userIds: [userId], type, params, dedupeKey }))
  }
}
