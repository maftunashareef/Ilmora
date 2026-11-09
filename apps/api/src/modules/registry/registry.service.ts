import { Injectable } from '@nestjs/common'
import {
  type DirectionAddResult, type DirectionDto, type DistrictDto, type IndustryDto, type InstitutionAddResult, type InstitutionSearchItemDto,
  type L, type RegionDto, type RegistryInstitutionType, registrySearchKey, SUGGEST_LIMIT, SUGGEST_MIN_CHARS,
} from '@ilmora/shared'
import { AppError } from '../../common/errors'
import type { InstitutionType } from '../../generated/prisma/enums'
import { PrismaService } from '../../infra/prisma/prisma.service'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { DIRECTION_SELECT, DIRECTION_WITH_MAIN, INDUSTRY_SELECT, isUniqueViolation, mainOf, toDirection, toIndustry } from './registry.mappers'
import type { DirectionInput, DirectionsQuery, InstitutionsQuery, StudentInstitutionInput } from './registry.schemas'

// The shared contract and the database enum must name the same institution types.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never
const typesMatch: Same<RegistryInstitutionType, InstitutionType> = true
void typesMatch

/** Rows read for suggestions before aliases are resolved and the list is cut to SUGGEST_LIMIT. */
const SUGGEST_SCAN = 100

/** Public fields of an institution only (ТЗ 9.4): no STIR, director, phone, e-mail or address. */
const INSTITUTION_PUBLIC = {
  id: true, name: true, type: true, ownership: true, source: true,
  region: { select: { id: true, name: true } }, district: { select: { id: true, name: true } },
} as const

type InstitutionRow = {
  id: string; name: string; type: InstitutionType; ownership: 'STATE' | 'PRIVATE' | null; source: string
  region: { id: string; name: unknown } | null; district: { id: string; name: unknown } | null
}

const toInstitution = (i: InstitutionRow): InstitutionSearchItemDto => ({
  id: i.id, name: i.name, type: i.type, ownership: i.ownership,
  region: i.region ? { id: i.region.id, name: i.region.name as L } : null,
  district: i.district ? { id: i.district.id, name: i.district.name as L } : null,
  addedByStudent: i.source === 'STUDENT',
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
    const rows = await this.prisma.client.region.findMany({ orderBy: { sortOrder: 'asc' }, select: { id: true, code: true, name: true } })
    return rows.map((r) => ({ id: r.id, code: r.code, name: r.name as L }))
  }

  async districts(regionId: string): Promise<DistrictDto[]> {
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

  /** Public search (ТЗ 9.4): public fields only, merged records hidden, 2+ characters. Student-added records go last. */
  async searchInstitutions(q: InstitutionsQuery): Promise<InstitutionSearchItemDto[]> {
    const key = registrySearchKey(q.q)
    if (key.length < SUGGEST_MIN_CHARS) return []
    const rows = await this.prisma.client.institution.findMany({
      where: { searchKey: { contains: key }, mergedIntoId: null, ...(q.type ? { type: q.type } : {}), ...(q.regionId ? { regionId: q.regionId } : {}) },
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
    const region = await this.prisma.client.region.findFirst({ where: { id: input.regionId }, select: { id: true } })
    if (!region) throw AppError.invalid('invalid_region', 'Choose a region from the list')
    if (input.districtId) {
      const district = await this.prisma.client.district.findFirst({ where: { id: input.districtId, regionId: region.id }, select: { id: true } })
      if (!district) throw AppError.invalid('invalid_district', 'Choose a district of the selected region')
    }
    const key = registrySearchKey(input.name)
    if (key.length < SUGGEST_MIN_CHARS) throw AppError.invalid('invalid_name', 'Enter the name of the institution')
    const existing = await this.prisma.client.institution.findFirst({ where: { searchKey: key, regionId: region.id, mergedIntoId: null }, select: INSTITUTION_PUBLIC })
    if (existing) return { institution: toInstitution(existing), created: false }
    const row = await this.prisma.client.institution.create({
      data: {
        tenantId, type: input.type, name: input.name, searchKey: key, regionId: region.id, districtId: input.districtId ?? null,
        source: 'STUDENT', status: 'UNCLAIMED', createdById: actor.id,
      },
      select: INSTITUTION_PUBLIC,
    })
    await this.audit.record({ action: 'registry.institution.create_by_student', entityType: 'Institution', entityId: row.id, after: { name: row.name, type: row.type, regionId: region.id } })
    return { institution: toInstitution(row), created: true }
  }

  /** The direction stored under this key — or, when it is a merged alias, its main direction. */
  private async directionByKey(key: string): Promise<DirectionDto | null> {
    const row = await this.prisma.client.direction.findFirst({ where: { searchKey: key }, select: DIRECTION_WITH_MAIN })
    return row ? mainOf(row) : null
  }
}
