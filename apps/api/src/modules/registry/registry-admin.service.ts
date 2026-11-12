import { Injectable } from '@nestjs/common'
import { type AdminDirectionDto, type AdminIndustryDto, type L, type MergeResultDto, registrySearchKey, type StudentInstitutionDto } from '@ilmora/shared'
import { AppError } from '../../common/errors'
import type { Prisma } from '../../generated/prisma/client'
import { PrismaService, type TransactionClient } from '../../infra/prisma/prisma.service'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { INDUSTRY_SELECT, isUniqueViolation, toIndustry } from './registry.mappers'
import type { AdminDirectionsQuery, DirectionPatch, IndustryInput, IndustryPatch, StudentInstitutionsQuery } from './registry-admin.schemas'

const PAGE = 50
const place = (r: { id: string; name: unknown } | null) => (r ? { id: r.id, name: r.name as L } : null)

const ADMIN_DIRECTION_SELECT = {
  id: true, name: true, origin: true, code: true, createdAt: true,
  industry: { select: INDUSTRY_SELECT },
  mergedInto: { select: { id: true, name: true } },
  _count: { select: { aliases: true, students: true, institutionDirections: true, companies: true, announcementLines: true, trainingRequests: true, vacancies: true } },
} as const satisfies Prisma.DirectionSelect
type AdminDirectionRow = Prisma.DirectionGetPayload<{ select: typeof ADMIN_DIRECTION_SELECT }>
const toAdminDirection = (d: AdminDirectionRow): AdminDirectionDto => ({
  id: d.id, name: d.name, industry: toIndustry(d.industry), origin: d.origin, code: d.code, createdAt: d.createdAt.toISOString(), mergedInto: d.mergedInto,
  aliases: d._count.aliases,
  usage: { students: d._count.students, institutions: d._count.institutionDirections, companies: d._count.companies, announcements: d._count.announcementLines, trainingRequests: d._count.trainingRequests, vacancies: d._count.vacancies },
})

/**
 * The Super Admin keeps the shared reference data clean (ТЗ 3.2, 3.5, 9.2): industries, directions typed by users
 * (rename, move to another industry, merge a duplicate into the main one) and institutions added by students (merge into
 * the registry record). A merge moves every reference in one transaction and keeps the merged row as an alias, so the
 * old name still finds the main record. Everything is in the audit log.
 */
/** Row locks on two records of one table, always in the same order, for the rest of the transaction. */
async function lockRows(tx: TransactionClient, table: 'Direction' | 'Institution', a: string, b: string) {
  await tx.$queryRawUnsafe(`SELECT id FROM "${table}" WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE`, [a, b])
}

@Injectable()
export class RegistryAdminService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  // ───────────── industries ─────────────

  async industries(): Promise<AdminIndustryDto[]> {
    const rows = await this.prisma.client.industry.findMany({
      orderBy: [{ sortOrder: 'asc' }, { slug: 'asc' }],
      select: { ...INDUSTRY_SELECT, sortOrder: true, isActive: true, _count: { select: { directions: { where: { mergedIntoId: null } }, companies: true } } },
    })
    return rows.map((r) => ({ ...toIndustry(r), sortOrder: r.sortOrder, isActive: r.isActive, directions: r._count.directions, companies: r._count.companies }))
  }

  async createIndustry(tenantId: string, input: IndustryInput): Promise<AdminIndustryDto[]> {
    try {
      const sortOrder = input.sortOrder ?? ((await this.prisma.client.industry.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? 0) + 10
      const row = await this.prisma.client.industry.create({ data: { tenantId, slug: input.slug, name: input.name, sortOrder }, select: { id: true } })
      await this.audit.record({ action: 'registry.industry.create', entityType: 'Industry', entityId: row.id, after: { slug: input.slug, name: input.name } })
    } catch (err) {
      if (isUniqueViolation(err)) throw AppError.conflict('industry_exists', 'An industry with this slug exists')
      throw err
    }
    return this.industries()
  }

  async updateIndustry(id: string, input: IndustryPatch): Promise<AdminIndustryDto[]> {
    const before = await this.prisma.client.industry.findFirst({ where: { id }, select: { name: true, sortOrder: true, isActive: true } })
    if (!before) throw AppError.notFound('Industry')
    await this.prisma.client.industry.update({ where: { id }, data: { ...(input.name ? { name: input.name } : {}), ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}), ...(input.isActive !== undefined ? { isActive: input.isActive } : {}) } })
    await this.audit.record({ action: 'registry.industry.update', entityType: 'Industry', entityId: id, before, after: { ...input } })
    return this.industries()
  }

  // ───────────── directions ─────────────

  /** All directions with where they are used — to find duplicates; aliases hidden unless asked. */
  async directions(q: AdminDirectionsQuery): Promise<{ items: AdminDirectionDto[]; total: number; page: number; pageSize: number }> {
    const key = registrySearchKey(q.q)
    const where: Prisma.DirectionWhereInput = {
      ...(key ? { searchKey: { contains: key } } : {}), ...(q.industryId ? { industryId: q.industryId } : {}), ...(q.origin ? { origin: q.origin } : {}),
      ...(q.merged === 'true' ? {} : { mergedIntoId: null }),
    }
    const [rows, total] = await Promise.all([
      this.prisma.client.direction.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: (q.page - 1) * PAGE, take: PAGE, select: ADMIN_DIRECTION_SELECT }),
      this.prisma.client.direction.count({ where }),
    ])
    return { items: rows.map(toAdminDirection), total, page: q.page, pageSize: PAGE }
  }

  /** Rename (the search key follows), move to another industry, set the classifier code. An alias is changed through its main direction. */
  async updateDirection(actor: RequestActor, id: string, input: DirectionPatch): Promise<AdminDirectionDto> {
    const d = await this.prisma.client.direction.findFirst({ where: { id }, select: { name: true, industryId: true, code: true, origin: true, mergedIntoId: true } })
    if (!d) throw AppError.notFound('Direction')
    if (d.mergedIntoId) throw AppError.conflict('invalid_merge', 'This direction is merged; change its main direction')
    // An official direction stays official; anything else the Super Admin edits is no longer «added by a user».
    const data: Prisma.DirectionUncheckedUpdateInput = d.origin === 'OFFICIAL' ? {} : { origin: 'ADMIN' }
    if (input.name !== undefined) {
      const key = registrySearchKey(input.name)
      if (key.length < 2) throw AppError.invalid('invalid_name', 'Enter the name of the direction')
      const taken = await this.prisma.client.direction.findFirst({ where: { searchKey: key, id: { not: id } }, select: { id: true, name: true } })
      if (taken) throw AppError.conflict('direction_exists', 'Another direction has this name: merge them instead', { id: taken.id, name: taken.name })
      Object.assign(data, { name: input.name, searchKey: key })
    }
    if (input.industryId !== undefined) {
      if (!(await this.prisma.client.industry.findFirst({ where: { id: input.industryId }, select: { id: true } }))) throw AppError.invalid('invalid_industry', 'Choose an industry from the list')
      data.industryId = input.industryId
    }
    if (input.code !== undefined) data.code = input.code || null
    try {
      await this.prisma.client.direction.update({ where: { id }, data })
    } catch (err) {
      if (isUniqueViolation(err)) throw AppError.conflict('direction_exists', 'Another direction has this name: merge them instead')
      throw err
    }
    await this.audit.record({ action: 'registry.direction.update', entityType: 'Direction', entityId: id, before: { name: d.name, industryId: d.industryId, code: d.code }, after: { ...input } })
    return this.direction(id)
  }

  /**
   * Merge a duplicate into the main direction: institutions (student counts added up), students, companies,
   * announcement lines (counts and companies' answers added up), training requests, vacancies and the duplicate's own
   * aliases move to the main one in one transaction; the duplicate stays as its alias.
   */
  async mergeDirection(actor: RequestActor, fromId: string, intoId: string): Promise<MergeResultDto> {
    if (fromId === intoId) throw AppError.invalid('invalid_merge', 'A direction cannot be merged into itself')
    const [from, into] = await Promise.all([
      this.prisma.client.direction.findFirst({ where: { id: fromId }, select: { id: true, name: true, mergedIntoId: true } }),
      this.prisma.client.direction.findFirst({ where: { id: intoId }, select: { id: true, name: true, mergedIntoId: true } }),
    ])
    if (!from || !into) throw AppError.notFound('Direction')
    if (from.mergedIntoId || into.mergedIntoId) throw AppError.invalid('invalid_merge', 'Merge a main direction into a main direction')
    const moved = await this.prisma.client.$transaction(async (tx) => {
      // Both rows locked, in one order, and read again: two opposite merges at once (A→B and B→A) run one after the
      // other, and the second finds its record merged — no loop, no direction merged into itself (re-check 11.11 №108).
      await lockRows(tx, 'Direction', fromId, intoId)
      const fresh = await tx.direction.findMany({ where: { id: { in: [fromId, intoId] } }, select: { mergedIntoId: true } })
      if (fresh.length !== 2 || fresh.some((d) => d.mergedIntoId)) throw AppError.invalid('invalid_merge', 'Merge a main direction into a main direction')
      const out: Record<string, number> = {}
      out.institutions = await this.moveInstitutionDirections(tx, fromId, intoId)
      out.students = (await tx.studentProfile.updateMany({ where: { directionId: fromId }, data: { directionId: intoId } })).count
      // Join tables keyed by (owner, direction): add the main direction where missing, drop the duplicate.
      const companies = await tx.companyDirection.findMany({ where: { directionId: fromId }, select: { companyId: true } })
      if (companies.length) await tx.companyDirection.createMany({ data: companies.map((c) => ({ companyId: c.companyId, directionId: intoId })), skipDuplicates: true })
      out.companies = (await tx.companyDirection.deleteMany({ where: { directionId: fromId } })).count
      const vacancies = await tx.vacancyDirection.findMany({ where: { directionId: fromId }, select: { vacancyId: true } })
      if (vacancies.length) await tx.vacancyDirection.createMany({ data: vacancies.map((v) => ({ vacancyId: v.vacancyId, directionId: intoId })), skipDuplicates: true })
      out.vacancies = (await tx.vacancyDirection.deleteMany({ where: { directionId: fromId } })).count
      out.announcementLines = await this.moveAnnouncementLines(tx, fromId, intoId)
      out.trainingRequests = (await tx.trainingRequest.updateMany({ where: { directionId: fromId }, data: { directionId: intoId } })).count
      out.aliases = (await tx.direction.updateMany({ where: { mergedIntoId: fromId }, data: { mergedIntoId: intoId } })).count
      await tx.direction.update({ where: { id: fromId }, data: { mergedIntoId: intoId } })
      return out
    })
    await this.audit.record({ action: 'registry.direction.merge', entityType: 'Direction', entityId: fromId, before: { name: from.name }, after: { intoId, intoName: into.name, moved } })
    return { fromId, intoId, moved }
  }

  // ───────────── institutions added by students ─────────────

  /** Records students added (ТЗ 3.5) not merged yet, with how many students chose them and likely registry records. */
  async studentInstitutions(q: StudentInstitutionsQuery): Promise<StudentInstitutionDto[]> {
    const key = registrySearchKey(q.q)
    const rows = await this.prisma.client.institution.findMany({
      where: { source: 'STUDENT', mergedIntoId: null, ...(key ? { searchKey: { contains: key } } : {}), ...(q.regionId ? { regionId: q.regionId } : {}) },
      orderBy: { createdAt: 'asc' }, take: 100,
      select: { id: true, name: true, type: true, searchKey: true, regionId: true, createdAt: true, region: { select: { id: true, name: true } }, _count: { select: { students: true } } },
    })
    return Promise.all(rows.map(async (r) => {
      const candidates = await this.prisma.client.institution.findMany({
        where: { id: { not: r.id }, mergedIntoId: null, source: { not: 'STUDENT' }, regionId: r.regionId, OR: [{ searchText: { contains: r.searchKey } }, { searchKey: { contains: r.searchKey } }] },
        orderBy: { name: 'asc' }, take: 5, select: { id: true, name: true, type: true, region: { select: { id: true, name: true } } },
      })
      return {
        id: r.id, name: r.name, type: r.type, region: place(r.region), createdAt: r.createdAt.toISOString(), students: r._count.students,
        candidates: candidates.map((c) => ({ id: c.id, name: c.name, type: c.type, region: place(c.region) })),
      }
    }))
  }

  /**
   * Merge a student-added record into the registry one: its students move (study confirmation starts over — the real
   * institution confirms them if it is approved), branches move, the record stays as an alias that search and new
   * additions resolve to the target. A record somebody represents is not merged here.
   */
  async mergeInstitution(actor: RequestActor, fromId: string, intoId: string): Promise<MergeResultDto> {
    if (fromId === intoId) throw AppError.invalid('invalid_merge', 'An institution cannot be merged into itself')
    const select = { id: true, name: true, type: true, source: true, approvedAt: true, mergedIntoId: true, representative: { select: { id: true } }, _count: { select: { announcements: true, trainingOffers: true } } } as const
    const [from, into] = await Promise.all([
      this.prisma.client.institution.findFirst({ where: { id: fromId }, select }),
      this.prisma.client.institution.findFirst({ where: { id: intoId }, select }),
    ])
    if (!from || !into) throw AppError.notFound('Institution')
    if (from.source !== 'STUDENT' || from.representative || from._count.announcements || from._count.trainingOffers) throw AppError.invalid('invalid_merge', 'Only an unclaimed record added by a student is merged')
    if (from.mergedIntoId || into.mergedIntoId) throw AppError.invalid('invalid_merge', 'The record is already merged')
    const moved = await this.prisma.client.$transaction(async (tx) => {
      await lockRows(tx, 'Institution', fromId, intoId)
      const fresh = await tx.institution.findMany({ where: { id: { in: [fromId, intoId] } }, select: { mergedIntoId: true } })
      if (fresh.length !== 2 || fresh.some((d) => d.mergedIntoId)) throw AppError.invalid('invalid_merge', 'The record is already merged')
      const base = { institutionId: intoId, institutionType: into.type, studyConfirmedAt: null, studyConfirmedById: null }
      const toConfirm = into.approvedAt
        ? (await tx.studentProfile.updateMany({ where: { institutionId: fromId, mode: 'STUDYING' }, data: { ...base, studyConfirmation: 'PENDING' } })).count
        : 0
      const rest = (await tx.studentProfile.updateMany({ where: { institutionId: fromId }, data: { ...base, studyConfirmation: 'NONE' } })).count
      const branches = (await tx.institution.updateMany({ where: { parentId: fromId }, data: { parentId: intoId } })).count
      await tx.institutionDirection.deleteMany({ where: { institutionId: fromId } })
      // Records merged into this one before follow it, so a student choosing one of them lands on the live record, not on
      // a merged one that is hidden everywhere (re-check 11.11 №113).
      const aliases = (await tx.institution.updateMany({ where: { mergedIntoId: fromId }, data: { mergedIntoId: intoId } })).count
      await tx.institution.update({ where: { id: fromId }, data: { mergedIntoId: intoId } })
      return { students: toConfirm + rest, toConfirm, branches, aliases }
    })
    await this.audit.record({ action: 'registry.institution.merge', entityType: 'Institution', entityId: fromId, before: { name: from.name }, after: { intoId, intoName: into.name, moved } })
    return { fromId, intoId, moved }
  }

  // ───────────── helpers ─────────────

  private async direction(id: string): Promise<AdminDirectionDto> {
    return toAdminDirection(await this.prisma.client.direction.findFirstOrThrow({ where: { id }, select: ADMIN_DIRECTION_SELECT }))
  }

  /** An institution teaching both keeps one row with the student counts added up. */
  private async moveInstitutionDirections(tx: TransactionClient, fromId: string, intoId: string) {
    const rows = await tx.institutionDirection.findMany({ where: { directionId: fromId }, select: { id: true, institutionId: true, studentsCount: true } })
    for (const r of rows) {
      const both = await tx.institutionDirection.findFirst({ where: { institutionId: r.institutionId, directionId: intoId }, select: { id: true } })
      if (both) {
        await tx.institutionDirection.update({ where: { id: both.id }, data: { studentsCount: { increment: r.studentsCount } } })
        await tx.institutionDirection.delete({ where: { id: r.id } })
      } else {
        await tx.institutionDirection.update({ where: { id: r.id }, data: { directionId: intoId } })
      }
    }
    return rows.length
  }

  /** An announcement listing both keeps one line: counts and the companies' answers to it are added up. */
  private async moveAnnouncementLines(tx: TransactionClient, fromId: string, intoId: string) {
    const lines = await tx.announcementLine.findMany({ where: { directionId: fromId }, select: { id: true, announcementId: true, count: true, responseLines: { select: { responseId: true, wantedCount: true } } } })
    for (const l of lines) {
      const both = await tx.announcementLine.findFirst({ where: { announcementId: l.announcementId, directionId: intoId }, select: { id: true } })
      if (!both) {
        await tx.announcementLine.update({ where: { id: l.id }, data: { directionId: intoId } })
        continue
      }
      await tx.announcementLine.update({ where: { id: both.id }, data: { count: { increment: l.count } } })
      for (const r of l.responseLines) {
        await tx.announcementResponseLine.upsert({
          where: { responseId_lineId: { responseId: r.responseId, lineId: both.id } },
          create: { responseId: r.responseId, lineId: both.id, wantedCount: r.wantedCount },
          update: { wantedCount: { increment: r.wantedCount } },
        })
      }
      await tx.announcementLine.delete({ where: { id: l.id } })
    }
    return lines.length
  }
}
