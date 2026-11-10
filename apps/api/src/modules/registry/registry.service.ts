import { HttpStatus, Injectable } from '@nestjs/common'
import {
  type DirectionAddResult, type DirectionDto, type DistrictDto, type IndustryDto, type InstitutionAddResult, type InstitutionSearchItemDto,
  type L, type RegionDto, type RegistryInstitutionType, registrySearchKey, registrySearchText, SUGGEST_LIMIT, SUGGEST_MIN_CHARS,
} from '@ilmora/shared'
import { AppError } from '../../common/errors'
import type { InstitutionType } from '../../generated/prisma/enums'
import { PrismaService } from '../../infra/prisma/prisma.service'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import type { Prisma } from '../../generated/prisma/client'
import { DIRECTION_SELECT, DIRECTION_WITH_MAIN, INDUSTRY_SELECT, isUniqueViolation, mainOf, PLACE_SELECT, regionIdByRef, toDirection, toIndustry, toPlace } from './registry.mappers'
import type { DirectionInput, DirectionsQuery, InstitutionsQuery, StudentInstitutionInput } from './registry.schemas'

// The shared contract and the database enum must name the same institution types.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never
const typesMatch: Same<RegistryInstitutionType, InstitutionType> = true
void typesMatch

/** Rows read for suggestions before aliases are resolved and the list is cut to SUGGEST_LIMIT. */
const SUGGEST_SCAN = 100

/** Public fields of an institution only (ТЗ 9.4): no STIR, director, phone, e-mail or address. */
/** New dictionary entries per account a day — the same numbers as the throttles of POST /registry/directions and /institutions. */
const DAILY_DIRECTIONS = 20
const DAILY_INSTITUTIONS = 3
const INSTITUTION_PUBLIC = { id: true, name: true, nameRu: true, type: true, ownership: true, source: true, ...PLACE_SELECT } as const satisfies Prisma.InstitutionSelect
type InstitutionRow = Prisma.InstitutionGetPayload<{ select: typeof INSTITUTION_PUBLIC }>

const toInstitution = (i: InstitutionRow): InstitutionSearchItemDto => ({
  id: i.id, name: i.name, nameRu: i.nameRu, type: i.type, ownership: i.ownership, ...toPlace(i), addedByStudent: i.source === 'STUDENT',
})

/**
 * Reference data of the registry (ТЗ 3): industries, regions and districts, the shared direction field and the
 * institution search. Every query runs inside the tenant scope of the Prisma extension.
 *
 * Duplicates: the database keeps one direction per `searchKey` (unique index) — a lost race answers the existing row.
 * Student-added institutions have no unique index (STIR is empty), so the check by key + region is best effort and
 * the Super Admin merges what slips through.
 */
@Injectable()
export class RegistryService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  async industries(): Promise<IndustryDto[]> {
    const rows = await this.prisma.client.industry.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: INDUSTRY_SELECT })
    return rows.map(toIndustry)
  }

  async regions(): Promise<RegionDto[]> {
    const rows = await this.prisma.client.region.findMany({ orderBy: { sortOrder: 'asc' }, select: { id: true, code: true, slug: true, name: true } })
    return rows.map((r) => ({ id: r.id, code: r.code, slug: r.slug, name: r.name as L }))
  }

  /** Districts of a region given by id or by the web app's slug. */
  async districts(regionRef: string): Promise<DistrictDto[]> {
    const regionId = await regionIdByRef(this.prisma, regionRef)
    if (!regionId) return []
    const rows = await this.prisma.client.district.findMany({ where: { regionId }, orderBy: { code: 'asc' }, select: { id: true, regionId: true, code: true, name: true } })
    return rows.map((d) => ({ id: d.id, regionId: d.regionId, code: d.code, name: d.name as L }))
  }

  /**
   * Suggestions after 2 characters (ТЗ 3.2). A merged alias answers its main direction, each direction once;
   * official ones first, then by name. A shorter query answers an empty list rather than the whole dictionary.
   */
  async suggestDirections(q: DirectionsQuery): Promise<DirectionDto[]> {
    const key = registrySearchKey(q.q)
    if (key.length < SUGGEST_MIN_CHARS) return []
    const rows = await this.prisma.client.direction.findMany({
      where: {
        searchKey: { contains: key },
        ...(q.industryId ? { OR: [{ mergedIntoId: null, industryId: q.industryId }, { mergedInto: { industryId: q.industryId } }] } : {}),
      },
      select: DIRECTION_WITH_MAIN,
      orderBy: { name: 'asc' },
      take: SUGGEST_SCAN,
    })
    const byId = new Map<string, DirectionDto>()
    for (const row of rows) {
      const d = mainOf(row)
      if (!byId.has(d.id)) byId.set(d.id, d)
    }
    return [...byId.values()].sort((a, b) => Number(b.official) - Number(a.official) || a.name.localeCompare(b.name)).slice(0, SUGGEST_LIMIT)
  }

  /**
   * «Добавить „…“» (ТЗ 3.2 step 3): saved to the shared dictionary at once (origin USER). When the key already exists
   * the existing direction is returned (`created: false`) with its own industry, which the chip shows.
   */
  async addDirection(tenantId: string, actor: RequestActor, input: DirectionInput): Promise<DirectionAddResult> {
    const industry = await this.prisma.client.industry.findFirst({ where: { id: input.industryId, isActive: true }, select: { id: true } })
    if (!industry) throw AppError.invalid('invalid_industry', 'Choose an industry from the list')
    const key = registrySearchKey(input.name)
    if (key.length < SUGGEST_MIN_CHARS) throw AppError.invalid('invalid_name', 'Enter the name of the direction')
    const existing = await this.directionByKey(key)
    if (existing) return { direction: existing, created: false }
    await this.assertDailyLimit('direction', actor, DAILY_DIRECTIONS)
    let direction: DirectionDto
    try {
      const row = await this.prisma.client.direction.create({
        data: { tenantId, name: input.name, searchKey: key, industryId: industry.id, origin: 'USER', createdById: actor.id },
        select: DIRECTION_SELECT,
      })
      direction = toDirection(row)
    } catch (err) {
      // Two «Добавить» of one name at once: the other request created it — answer that one (docs/registry/data-model.md).
      if (!isUniqueViolation(err)) throw err
      const winner = await this.directionByKey(key)
      if (!winner) throw err
      return { direction: winner, created: false }
    }
    await this.audit.record({ action: 'registry.direction.create', entityType: 'Direction', entityId: direction.id, after: { name: direction.name, industryId: industry.id } })
    return { direction, created: true }
  }

  /**
   * Public search (ТЗ 9.4): public fields only, merged records hidden, 2+ characters. Student-added records go last.
   * Matches the official, Russian and former names (`searchText`); records created before it existed by `searchKey`.
   */
  async searchInstitutions(q: InstitutionsQuery): Promise<InstitutionSearchItemDto[]> {
    const key = registrySearchKey(q.q)
    if (key.length < SUGGEST_MIN_CHARS) return []
    let regionId: string | undefined
    if (q.regionId) {
      const found = await regionIdByRef(this.prisma, q.regionId)
      if (!found) return []
      regionId = found
    }
    const rows = await this.prisma.client.institution.findMany({
      where: {
        AND: [
          { OR: [{ searchText: { contains: key } }, { searchKey: { contains: key } }] },
          // The ministry's list, the approved ones and the student-added (marked so); not a self-registered name nobody approved (security review №45).
          { OR: [{ source: { in: ['IMPORT', 'STUDENT'] } }, { approvedAt: { not: null } }] },
        ],
        // A record the Super Admin blocked is not offered either.
        mergedIntoId: null, blockedAt: null, ...(q.type ? { type: q.type } : {}), ...(regionId ? { regionId } : {}),
      },
      select: INSTITUTION_PUBLIC,
      orderBy: { name: 'asc' },
      take: SUGGEST_SCAN,
    })
    return rows
      .map(toInstitution)
      .sort((a, b) => Number(a.addedByStudent) - Number(b.addedByStudent) || a.name.localeCompare(b.name))
      .slice(0, SUGGEST_LIMIT)
  }

  /**
   * A student did not find their institution (ТЗ 3.5, 4.1): the record is available to other students at once, marked
   * «added by a student», with no STIR, status UNCLAIMED and outside the official figures until it is merged.
   */
  async addStudentInstitution(tenantId: string, actor: RequestActor, input: StudentInstitutionInput): Promise<InstitutionAddResult> {
    const regionId = await regionIdByRef(this.prisma, input.regionId)
    if (!regionId) throw AppError.invalid('invalid_region', 'Choose a region from the list')
    const region = { id: regionId }
    if (input.districtId) {
      const district = await this.prisma.client.district.findFirst({ where: { id: input.districtId, regionId: region.id }, select: { id: true } })
      if (!district) throw AppError.invalid('invalid_district', 'Choose a district of the selected region')
    }
    const key = registrySearchKey(input.name)
    if (key.length < SUGGEST_MIN_CHARS) throw AppError.invalid('invalid_name', 'Enter the name of the institution')
    const existing = await this.prisma.client.institution.findFirst({ where: { searchKey: key, regionId: region.id, mergedIntoId: null }, select: INSTITUTION_PUBLIC })
    if (existing) return { institution: toInstitution(existing), created: false }
    // A record the Super Admin merged answers its target: the duplicate does not come back under the same name.
    const merged = await this.prisma.client.institution.findFirst({ where: { searchKey: key, regionId: region.id, mergedIntoId: { not: null } }, select: { mergedInto: { select: INSTITUTION_PUBLIC } } })
    if (merged?.mergedInto) return { institution: toInstitution(merged.mergedInto), created: false }
    await this.assertDailyLimit('institution', actor, DAILY_INSTITUTIONS)
    const row = await this.prisma.client.institution.create({
      data: {
        tenantId, type: input.type, name: input.name, searchKey: key, searchText: registrySearchText(input.name), regionId: region.id, districtId: input.districtId ?? null,
        source: 'STUDENT', status: 'UNCLAIMED', createdById: actor.id,
      },
      select: INSTITUTION_PUBLIC,
    })
    await this.audit.record({ action: 'registry.institution.create_by_student', entityType: 'Institution', entityId: row.id, after: { name: row.name, type: row.type, regionId: region.id } })
    return { institution: toInstitution(row), created: true }
  }

  /**
   * New entries one account adds to the shared dictionary in 24 hours — counted in the database, so the questionnaire
   * (which adds through this service, not the throttled routes) has the same limit (security review №44).
   */
  private async assertDailyLimit(kind: 'direction' | 'institution', actor: RequestActor, limit: number) {
    const since = new Date(Date.now() - 86_400_000)
    const count = kind === 'direction'
      ? await this.prisma.client.direction.count({ where: { createdById: actor.id, createdAt: { gte: since } } })
      : await this.prisma.client.institution.count({ where: { createdById: actor.id, source: 'STUDENT', createdAt: { gte: since } } })
    if (count >= limit) throw new AppError('rate_limited', `At most ${limit} new entries a day`, HttpStatus.TOO_MANY_REQUESTS, { retryAfterSeconds: 3600 })
  }

  /** The direction stored under this key — or, when it is a merged alias, its main direction. */
  private async directionByKey(key: string): Promise<DirectionDto | null> {
    const row = await this.prisma.client.direction.findFirst({ where: { searchKey: key }, select: DIRECTION_WITH_MAIN })
    return row ? mainOf(row) : null
  }
}
