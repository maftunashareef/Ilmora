import { Injectable } from '@nestjs/common'
import type { CompanyProfileDto, CompanyReviewDto, CompanyReviewItemDto, L } from '@ilmora/shared'
import { AppError } from '../../common/errors'
import { PrismaService } from '../../infra/prisma/prisma.service'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { NotificationsService } from '../notifications/notifications.service'
import { INDUSTRY_SELECT, toIndustry } from '../registry/registry.mappers'
import { CompaniesService } from './companies.service'

const iso = (d: Date | null) => d?.toISOString() ?? null
const HISTORY_ACTIONS = ['company.create', 'company.submit', 'company.update.review', 'company.certificate.review', 'company.approve', 'company.reject']
const REP_SELECT = { displayName: true, jobTitle: true, login: true, email: true } as const
const toRep = (r: { displayName: string; jobTitle: string | null; login: string | null; email: string | null } | null) =>
  r ? { name: r.displayName, jobTitle: r.jobTitle, login: r.login, email: r.email } : null
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
    const rows = await this.prisma.client.company.findMany({
      where: { status: 'PENDING' },
      orderBy: { submittedAt: 'asc' },
      take: 500,
      select: {
        id: true, name: true, stir: true, submittedAt: true, approvedAt: true, certificateFileKey: true,
        region: { select: { id: true, slug: true, name: true } },
        industries: { select: { industry: { select: { ...INDUSTRY_SELECT, sortOrder: true } } } },
        representative: { select: REP_SELECT },
      },
    })
    return rows.map((r) => ({
      id: r.id, name: r.name, stir: r.stir,
      region: r.region ? { id: r.region.id, slug: r.region.slug, name: r.region.name as L } : null,
      industries: r.industries.map((i) => i.industry).sort((a, b) => a.sortOrder - b.sortOrder).map(toIndustry),
      submittedAt: iso(r.submittedAt), reReview: r.approvedAt !== null, certificateUploaded: r.certificateFileKey !== null,
      representative: toRep(r.representative),
    }))
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
    const moved = await this.prisma.client.company.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'APPROVED', approvedAt: current.approvedAt ?? now, reviewedAt: now, reviewedById: actor.id, rejectReason: null } })
    if (moved.count !== 1) throw notPending()
    await this.audit.record({ action: 'company.approve', entityType: 'Company', entityId: id, before: { status: 'PENDING' }, after: { status: 'APPROVED' } })
    await this.tell(tenantId, current.representativeId, 'company.approved', { companyName: current.name, companyId: id }, `company-decision:${id}:${now.getTime()}`)
    return this.companies.profileOf(id)
  }

  async reject(tenantId: string, actor: RequestActor, id: string, reason: string): Promise<CompanyProfileDto> {
    const current = await this.pending(id)
    const now = new Date()
    const moved = await this.prisma.client.company.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'REJECTED', reviewedAt: now, reviewedById: actor.id, rejectReason: reason } })
    if (moved.count !== 1) throw notPending()
    await this.audit.record({ action: 'company.reject', entityType: 'Company', entityId: id, before: { status: 'PENDING' }, after: { status: 'REJECTED' }, reason })
    await this.tell(tenantId, current.representativeId, 'company.rejected', { companyName: current.name, companyId: id, reason }, `company-decision:${id}:${now.getTime()}`)
    return this.companies.profileOf(id)
  }

  private async pending(id: string) {
    const row = await this.prisma.client.company.findFirst({ where: { id }, select: { name: true, status: true, approvedAt: true, representative: { select: { id: true } } } })
    if (!row) throw AppError.notFound('Company')
    if (row.status !== 'PENDING') throw notPending()
    return { name: row.name, approvedAt: row.approvedAt, representativeId: row.representative?.id ?? null }
  }

  private async tell(tenantId: string, userId: string | null, type: 'company.approved' | 'company.rejected', params: Record<string, unknown>, dedupeKey: string) {
    if (!userId) return
    await this.notifications.safely(type, () => this.notifications.notify({ tenantId, userIds: [userId], type, params, dedupeKey }))
  }
}
