import { Injectable } from '@nestjs/common'
import { type AdminInstitutionItemDto, type AdminPage, type InstitutionPassportDto, type InstitutionPendingChanges, type InstitutionReviewDto, type InstitutionReviewItemDto, registrySearchKey, registrySearchText, TECHNIKUMS } from '@ilmora/shared'

/**
 * The official name of a record from the ministry's list, for the reviewer to compare with what the representative
 * entered (security review №18): `Institution.officialName` (Timur's #46, set by the import), else the list itself.
 */
const OFFICIAL_NAMES = new Map(TECHNIKUMS.map((t) => [t.id, t.name]))
export const officialName = (id: string, source: string, stored: string | null = null) => (source === 'IMPORT' ? (stored ?? OFFICIAL_NAMES.get(id) ?? null) : null)
import { AppError } from '../../common/errors'
import { Prisma } from '../../generated/prisma/client'
import { isUniqueViolation, regionIdByRef } from '../registry/registry.mappers'
import type { AdminInstitutionsQuery } from './institutions-admin.controller'
import { PrismaService } from '../../infra/prisma/prisma.service'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { NotificationsService } from '../notifications/notifications.service'
import { PLACE_SELECT, toPlace } from '../registry/registry.mappers'
import { InstitutionsService } from './institutions.service'

const iso = (d: Date | null) => d?.toISOString() ?? null
const ADMIN_PAGE = 50
const ITEM_SELECT = {
  id: true, name: true, type: true, stir: true, source: true, submittedAt: true, approvedAt: true, officialName: true, pendingChanges: true, ...PLACE_SELECT,
  representative: { select: { displayName: true, jobTitle: true, login: true } },
} as const satisfies Prisma.InstitutionSelect
const toItem = (r: Prisma.InstitutionGetPayload<{ select: typeof ITEM_SELECT }>): InstitutionReviewItemDto => ({
  id: r.id, name: r.name, type: r.type, stir: r.stir, ...toPlace(r),
  submittedAt: iso(r.submittedAt),
  reReview: r.approvedAt !== null,
  inRegistry: r.source === 'IMPORT',
  officialName: officialName(r.id, r.source, r.officialName),
  pendingChanges: (r.pendingChanges as InstitutionPendingChanges | null) ?? null,
  representative: r.representative ? { name: r.representative.displayName, jobTitle: r.representative.jobTitle, login: r.representative.login } : null,
})
/** Audit actions shown as the review history of one institution. */
const HISTORY_ACTIONS = ['institution.claim', 'institution.create', 'institution.submit', 'institution.update.review', 'institution.approve', 'institution.reject', 'institution.change.approve', 'institution.change.reject', 'institution.block', 'institution.unblock', 'institution.release']
/** Waiting for a decision: a first review, or a change of an approved record (security review №13). */
const WAITING: Prisma.InstitutionWhereInput = { OR: [{ status: 'PENDING' }, { pendingChanges: { not: Prisma.DbNull } }] }

/**
 * Review of institution profiles (ТЗ 4.2 step 5, 7.1). Decision of 10.11: the Super Admin approves or rejects — not
 * the ministry, which sees the registry and the figures only. Approval opens the workspace (`approvedAt`); a rejection
 * of a re-review after a key-field change keeps the workspace open (the institution was approved once) and drops it
 * out of the official figures until it is fixed and approved again.
 */
@Injectable()
export class InstitutionReviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly institutions: InstitutionsService,
  ) {}

  /** The queue: profiles waiting for a decision, oldest first. */
  async queue(): Promise<InstitutionReviewItemDto[]> {
    const rows = await this.prisma.client.institution.findMany({ where: { ...WAITING, mergedIntoId: null }, orderBy: { submittedAt: 'asc' }, take: 500, select: ITEM_SELECT })
    return rows.map(toItem)
  }

  /**
   * Every record, for «Отвязать представителя» and the like (issue #50): a STIR (exact), a name (also the official
   * one from the ministry list), a status, a type, a region. Without a status — the records somebody represents.
   */
  async search(q: AdminInstitutionsQuery): Promise<AdminPage<AdminInstitutionItemDto>> {
    const key = q.q ? registrySearchKey(q.q) : ''
    const regionId = q.regionId ? await regionIdByRef(this.prisma, q.regionId) : null
    if (q.regionId && !regionId) return { items: [], total: 0, page: q.page, pageSize: ADMIN_PAGE }
    const where: Prisma.InstitutionWhereInput = {
      mergedIntoId: null,
      ...(q.status ? { status: q.status } : { representative: { isNot: null } }),
      ...(q.stir ? { stir: q.stir } : {}),
      ...(q.type ? { type: q.type } : {}),
      ...(regionId ? { regionId } : {}),
      ...(key ? { OR: [{ searchKey: { contains: key } }, { searchText: { contains: key } }, { officialName: { contains: q.q!.trim(), mode: 'insensitive' } }] } : {}),
    }
    const [rows, total] = await Promise.all([
      this.prisma.client.institution.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: (q.page - 1) * ADMIN_PAGE, take: ADMIN_PAGE, select: { ...ITEM_SELECT, status: true, blockedAt: true } }),
      this.prisma.client.institution.count({ where }),
    ])
    return { items: rows.map((r) => ({ ...toItem(r), status: r.status, approvedAt: iso(r.approvedAt), blocked: r.blockedAt !== null })), total, page: q.page, pageSize: ADMIN_PAGE }
  }

  /** One profile with what the reviewer needs: the passport, whether the STIR came from the registry, the history. */
  async detail(id: string): Promise<InstitutionReviewDto> {
    const row = await this.prisma.client.institution.findFirst({
      where: { id, mergedIntoId: null },
      select: { source: true, officialName: true, representative: { select: { displayName: true, jobTitle: true, login: true } } },
    })
    if (!row) throw AppError.notFound('Institution')
    const [passport, history] = await Promise.all([
      this.institutions.passportOf(id),
      this.prisma.client.auditEvent.findMany({
        where: { entityType: 'Institution', entityId: id, action: { in: HISTORY_ACTIONS } },
        orderBy: { createdAt: 'asc' },
        select: { action: true, reason: true, createdAt: true, actor: { select: { displayName: true } } },
      }),
    ])
    return {
      passport,
      inRegistry: row.source === 'IMPORT',
      officialName: officialName(id, row.source, row.officialName),
      representative: row.representative ? { name: row.representative.displayName, jobTitle: row.representative.jobTitle, login: row.representative.login } : null,
      history: history.map((h) => ({ action: h.action, reason: h.reason, at: h.createdAt.toISOString(), by: h.actor?.displayName ?? null })),
    }
  }

  async approve(tenantId: string, actor: RequestActor, id: string): Promise<InstitutionPassportDto> {
    const current = await this.pending(id)
    const now = new Date()
    if (current.pendingChanges) return this.decideChange(tenantId, actor, id, { ...current, pendingChanges: current.pendingChanges }, true)
    // Only while still PENDING: two reviewers deciding at once — one decision counts.
    const moved = await this.prisma.client.institution.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'APPROVED', approvedAt: current.approvedAt ?? now, reviewedAt: now, reviewedById: actor.id, rejectReason: null },
    })
    if (moved.count !== 1) throw notPending()
    // Students who named it before it was approved had nothing to wait for: now the institution confirms them (ТЗ 4.1).
    const toConfirm = (await this.prisma.client.studentProfile.updateMany({ where: { institutionId: id, mode: 'STUDYING', studyConfirmation: 'NONE' }, data: { studyConfirmation: 'PENDING' } })).count
    await this.audit.record({ action: 'institution.approve', entityType: 'Institution', entityId: id, before: { status: 'PENDING' }, after: { status: 'APPROVED', studentsToConfirm: toConfirm } })
    await this.tell(tenantId, current.representativeId, 'institution.approved', { institutionName: current.name, institutionId: id }, `inst-decision:${id}:${now.getTime()}`)
    return this.institutions.passportOf(id)
  }

  async reject(tenantId: string, actor: RequestActor, id: string, reason: string): Promise<InstitutionPassportDto> {
    const current = await this.pending(id)
    const now = new Date()
    if (current.pendingChanges) return this.decideChange(tenantId, actor, id, { ...current, pendingChanges: current.pendingChanges }, false, reason)
    const moved = await this.prisma.client.institution.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'REJECTED', reviewedAt: now, reviewedById: actor.id, rejectReason: reason },
    })
    if (moved.count !== 1) throw notPending()
    await this.audit.record({ action: 'institution.reject', entityType: 'Institution', entityId: id, before: { status: 'PENDING' }, after: { status: 'REJECTED' }, reason })
    await this.tell(tenantId, current.representativeId, 'institution.rejected', { institutionName: current.name, institutionId: id, reason }, `inst-decision:${id}:${now.getTime()}`)
    return this.institutions.passportOf(id)
  }

  /** «Отвязать представителя» (security review №17): somebody holds a record that is not theirs. With a reason; audited. */
  async release(tenantId: string, id: string, reason: string): Promise<InstitutionPassportDto> {
    await this.institutions.release(tenantId, id, reason)
    return this.institutions.passportOf(id)
  }

  /**
   * A change of an approved institution (security review №13). Approval moves the waiting values into the record (the
   * STIR must still be free — the unique index answers, 409 `stir_taken`); rejection drops them. Either way the record
   * stays APPROVED with the values the ministry and the companies saw; of two reviewers at once one decision counts.
   */
  private async decideChange(tenantId: string, actor: RequestActor, id: string, current: { name: string; representativeId: string | null; pendingChanges: InstitutionPendingChanges }, accept: boolean, reason?: string): Promise<InstitutionPassportDto> {
    const now = new Date()
    const p = current.pendingChanges
    const names = accept && p.name ? await this.prisma.client.institution.findFirstOrThrow({ where: { id }, select: { nameRu: true, formerName: true } }) : null
    const apply = accept ? { ...p, ...(p.name ? { searchKey: registrySearchKey(p.name), searchText: registrySearchText(p.name, names!.nameRu, names!.formerName) } : {}) } : {}
    try {
      const moved = await this.prisma.client.institution.updateMany({
        where: { id, pendingChanges: { not: Prisma.DbNull } },
        data: { ...apply, pendingChanges: Prisma.DbNull, status: 'APPROVED', reviewedAt: now, reviewedById: actor.id, rejectReason: accept ? null : (reason ?? null) },
      })
      if (moved.count !== 1) throw notPending()
    } catch (err) {
      if (isUniqueViolation(err)) throw AppError.conflict('stir_taken', 'Another institution is registered with this STIR')
      throw err
    }
    await this.audit.record({ action: accept ? 'institution.change.approve' : 'institution.change.reject', entityType: 'Institution', entityId: id, after: { change: p }, reason })
    const type = accept ? 'institution.approved' : 'institution.rejected'
    await this.tell(tenantId, current.representativeId, type, { institutionName: p.name ?? current.name, institutionId: id, ...(reason ? { reason } : {}) }, `inst-decision:${id}:${now.getTime()}`)
    return this.institutions.passportOf(id)
  }

  /**
   * «Заблокировать» / «Разблокировать» (Super Admin, with a reason): the workspace closes, the record leaves the
   * ministry's figures, search and the companies' lists; the review status stays as it was. Audited, the
   * representative is told.
   */
  async setBlocked(tenantId: string, actor: RequestActor, id: string, blocked: boolean, reason?: string): Promise<InstitutionPassportDto> {
    const row = await this.prisma.client.institution.findFirst({ where: { id, mergedIntoId: null }, select: { name: true, blockedAt: true, representative: { select: { id: true } } } })
    if (!row) throw AppError.notFound('Institution')
    if (!!row.blockedAt === blocked) throw AppError.conflict(blocked ? 'already_blocked' : 'not_blocked', blocked ? 'Already blocked' : 'Not blocked')
    await this.prisma.client.institution.update({ where: { id }, data: blocked ? { blockedAt: new Date(), blockReason: reason ?? null, blockedById: actor.id } : { blockedAt: null, blockReason: null, blockedById: null } })
    await this.audit.record({ action: blocked ? 'institution.block' : 'institution.unblock', entityType: 'Institution', entityId: id, reason })
    const userId = row.representative?.id
    if (userId) {
      const type = blocked ? 'registry.blocked' : 'registry.unblocked'
      await this.notifications.safely(type, () => this.notifications.notify({ tenantId, userIds: [userId], type, params: { name: row.name, ...(reason ? { reason } : {}) }, dedupeKey: `registry-block:${id}:${Date.now()}` }))
    }
    return this.institutions.passportOf(id)
  }

  private async pending(id: string) {
    const row = await this.prisma.client.institution.findFirst({ where: { id, mergedIntoId: null }, select: { name: true, status: true, approvedAt: true, pendingChanges: true, representative: { select: { id: true } } } })
    if (!row) throw AppError.notFound('Institution')
    if (row.status !== 'PENDING' && !row.pendingChanges) throw notPending()
    return { name: row.name, approvedAt: row.approvedAt, representativeId: row.representative?.id ?? null, pendingChanges: (row.pendingChanges as InstitutionPendingChanges | null) ?? null }
  }

  private async tell(tenantId: string, userId: string | null, type: 'institution.approved' | 'institution.rejected', params: Record<string, unknown>, dedupeKey: string) {
    if (!userId) return
    await this.notifications.safely(type, () => this.notifications.notify({ tenantId, userIds: [userId], type, params, dedupeKey }))
  }
}

const notPending = () => AppError.conflict('not_pending', 'The profile is not waiting for a decision')
