import { Injectable } from '@nestjs/common'
import { type InstitutionPassportDto, type L, type MinistryCompanyItemDto, type MinistryInstitutionItemDto, type PageDto, registrySearchKey } from '@ilmora/shared'
import { AppError } from '../../common/errors'
import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infra/prisma/prisma.service'
import { InstitutionsService } from '../institutions/institutions.service'
import { INDUSTRY_SELECT, regionIdByRef, toIndustry } from '../registry/registry.mappers'
import type { MinistryCompaniesQuery, MinistryInstitutionsQuery } from './ministry.schemas'

const PAGE = 50
const place = (r: { id: string; name: unknown } | null) => (r ? { id: r.id, name: r.name as L } : null)
/** A direction of the industry — directly, or as an alias of a direction of it. */
const ofIndustry = (industryId: string): Prisma.DirectionWhereInput => ({ OR: [{ mergedIntoId: null, industryId }, { mergedInto: { industryId } }] })

/**
 * The registry as the ministry sees it (ТЗ 7.2): every institution with filters, read-only; companies without the
 * certificate. The ministry approves nothing (decision of 10.11) and gets no student data.
 */
@Injectable()
export class MinistryRegistryService {
  constructor(private readonly prisma: PrismaService, private readonly institutions: InstitutionsService) {}

  async institutionsPage(q: MinistryInstitutionsQuery): Promise<PageDto<MinistryInstitutionItemDto>> {
    const where: Prisma.InstitutionWhereInput = { mergedIntoId: null }
    if (q.q) {
      const key = registrySearchKey(q.q)
      if (key) where.AND = [{ OR: [{ searchText: { contains: key } }, { searchKey: { contains: key } }, { stir: q.q.trim() }] }]
    }
    if (q.type) where.type = q.type
    if (q.ownership) where.ownership = q.ownership
    if (q.regionId) {
      const regionId = await regionIdByRef(this.prisma, q.regionId)
      if (!regionId) throw AppError.invalid('invalid_region', 'Choose a region from the list')
      where.regionId = regionId
    }
    if (q.industryId) where.directions = { some: { direction: ofIndustry(q.industryId) } }
    // ТЗ 7.2: from the list but not registered / under review / approved / rejected / added by students.
    if (q.status === 'unclaimed') Object.assign(where, { status: 'UNCLAIMED', source: 'IMPORT' })
    if (q.status === 'pending') Object.assign(where, { status: 'PENDING', source: { not: 'STUDENT' } })
    if (q.status === 'approved') Object.assign(where, { approvedAt: { not: null }, source: { not: 'STUDENT' } })
    if (q.status === 'rejected') Object.assign(where, { status: 'REJECTED', source: { not: 'STUDENT' } })
    if (q.status === 'student') where.source = 'STUDENT'
    const page = q.page ?? 1
    const [total, rows] = await Promise.all([
      this.prisma.client.institution.count({ where }),
      this.prisma.client.institution.findMany({
        where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: (page - 1) * PAGE, take: PAGE,
        select: {
          id: true, name: true, nameRu: true, type: true, ownership: true, stir: true, districtName: true, status: true, source: true, approvedAt: true,
          region: { select: { id: true, name: true } }, directions: { select: { studentsCount: true } },
        },
      }),
    ])
    return {
      total, page, pageSize: PAGE,
      items: rows.map((r) => ({
        id: r.id, name: r.name, nameRu: r.nameRu, type: r.type, ownership: r.ownership, stir: r.stir, region: place(r.region), districtName: r.districtName,
        status: r.status, source: r.source, official: r.approvedAt !== null && r.source !== 'STUDENT',
        students: r.directions.reduce((n, d) => n + d.studentsCount, 0), directions: r.directions.length,
      })),
    }
  }

  /** The passport, read-only. */
  async institution(id: string): Promise<InstitutionPassportDto> {
    if (!(await this.prisma.client.institution.findFirst({ where: { id, mergedIntoId: null }, select: { id: true } }))) throw AppError.notFound('Institution')
    return this.institutions.passportOf(id)
  }

  /** ТЗ 7.2 «Компании»: name, STIR, industries, region — no certificate, no contact person. */
  async companiesPage(q: MinistryCompaniesQuery): Promise<PageDto<MinistryCompanyItemDto>> {
    const where: Prisma.CompanyWhereInput = {}
    if (q.q) {
      const key = registrySearchKey(q.q)
      if (key) where.OR = [{ searchKey: { contains: key } }, { stir: q.q.trim() }]
    }
    if (q.industryId) where.industries = { some: { industryId: q.industryId } }
    if (q.regionId) {
      const regionId = await regionIdByRef(this.prisma, q.regionId)
      if (!regionId) throw AppError.invalid('invalid_region', 'Choose a region from the list')
      where.regionId = regionId
    }
    if (q.status === 'approved') where.approvedAt = { not: null }
    if (q.status === 'pending') where.status = 'PENDING'
    const page = q.page ?? 1
    const [total, rows] = await Promise.all([
      this.prisma.client.company.count({ where }),
      this.prisma.client.company.findMany({
        where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip: (page - 1) * PAGE, take: PAGE,
        select: { id: true, name: true, stir: true, status: true, region: { select: { id: true, name: true } }, industries: { select: { industry: { select: { ...INDUSTRY_SELECT, sortOrder: true } } } } },
      }),
    ])
    return {
      total, page, pageSize: PAGE,
      items: rows.map((r) => ({ id: r.id, name: r.name, stir: r.stir, status: r.status, region: place(r.region), industries: r.industries.map((i) => i.industry).sort((a, b) => a.sortOrder - b.sortOrder).map(toIndustry) })),
    }
  }
}
