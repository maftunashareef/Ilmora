import { Injectable } from '@nestjs/common'
import type { ApplicationStatus, CompanyVacancyDto, DocumentLinkDto, L, StudentApplicationDto, VacancyApplicationDto, VacancyDto } from '@ilmora/shared'
import { AppError } from '../../common/errors'
import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infra/prisma/prisma.service'
import { DOC_LINK_SECONDS, PrivateDocsService } from '../../infra/storage/private-docs.service'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { ContactsService } from '../contacts/contacts.service'
import { NotificationsService } from '../notifications/notifications.service'
import { DIRECTION_WITH_MAIN, INDUSTRY_SELECT, isUniqueViolation, mainOf, regionIdByRef, toIndustry } from '../registry/registry.mappers'
import { StudentsService } from '../students/students.service'
import type { ApplyInput, VacanciesQuery, VacancyInput, VacancyPatch } from './vacancies.schemas'

const place = (r: { id: string; name: unknown } | null) => (r ? { id: r.id, name: r.name as L } : null)
const todayUtc = () => new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)
const dateOf = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00Z`) : null)
const STATUSES: ApplicationStatus[] = ['NEW', 'VIEWED', 'INVITED', 'REJECTED']

const VACANCY_SELECT = {
  id: true, kind: true, title: true, address: true, format: true, paid: true, stipendMinor: true, duration: true, seats: true, requirements: true,
  deadline: true, status: true, closedAt: true, createdAt: true,
  region: { select: { id: true, name: true } }, district: { select: { id: true, name: true } },
  company: { select: { id: true, name: true, industries: { select: { industry: { select: { ...INDUSTRY_SELECT, sortOrder: true } } } } } },
  directions: { select: { direction: { select: DIRECTION_WITH_MAIN } } },
} as const satisfies Prisma.VacancySelect
type VacancyRow = Prisma.VacancyGetPayload<{ select: typeof VACANCY_SELECT }>

const toVacancy = (v: VacancyRow): Omit<VacancyDto, 'myApplication'> => ({
  id: v.id, kind: v.kind, title: v.title,
  company: { id: v.company.id, name: v.company.name, industries: v.company.industries.map((i) => i.industry).sort((a, b) => a.sortOrder - b.sortOrder).map(toIndustry) },
  directions: v.directions.map((d) => mainOf(d.direction)),
  region: place(v.region)!, district: place(v.district), address: v.address, format: v.format, paid: v.paid,
  stipend: v.stipendMinor !== null ? Number(v.stipendMinor / 100n) : null,
  duration: v.duration, seats: v.seats, requirements: v.requirements,
  deadline: v.deadline?.toISOString().slice(0, 10) ?? null, status: v.status, createdAt: v.createdAt.toISOString(),
})

/**
 * Practice and internships (ТЗ 5.4). An approved company publishes a vacancy at once (it was checked itself):
 * directions (their industries), region, format, pay, seats, requirements, the last day to apply. Students see open
 * vacancies of approved companies whose deadline has not passed — no notification to students (ТЗ 13.11), the web
 * filters by their industry and region. Applying is consent by action: the company gets the full card. The status goes
 * новый → просмотрен (when the company opens the applications) → приглашён / отказ; the student is told each time.
 */
@Injectable()
export class VacanciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly contacts: ContactsService,
    private readonly students: StudentsService,
    private readonly docs: PrivateDocsService,
  ) {}

  // ───────────── company ─────────────

  async companyList(actor: RequestActor): Promise<CompanyVacancyDto[]> {
    const company = await this.ownCompany(actor)
    const rows = await this.prisma.client.vacancy.findMany({ where: { companyId: company.id }, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 500, select: VACANCY_SELECT })
    return this.withCounts(rows)
  }

  async companyGet(actor: RequestActor, id: string): Promise<CompanyVacancyDto> {
    const company = await this.ownCompany(actor)
    const [dto] = await this.withCounts([await this.ownVacancy(company.id, id)])
    return dto
  }

  async create(tenantId: string, actor: RequestActor, input: VacancyInput): Promise<CompanyVacancyDto> {
    const company = await this.ownCompany(actor)
    const directionIds = await this.mainDirections(input.directionIds)
    const where = await this.place(input.region, input.districtId ?? null)
    const row = await this.prisma.client.vacancy.create({
      data: {
        tenantId, companyId: company.id, kind: input.kind, title: input.title, ...where, address: input.address ?? null, format: input.format, paid: input.paid,
        stipendMinor: input.paid && input.stipend ? BigInt(input.stipend) * 100n : null, duration: input.duration ?? null, seats: input.seats,
        requirements: input.requirements ?? null, deadline: dateOf(input.deadline), directions: { create: directionIds.map((directionId) => ({ directionId })) },
      },
      select: { id: true },
    })
    await this.audit.record({ action: 'vacancy.create', entityType: 'Vacancy', entityId: row.id, after: { kind: input.kind, title: input.title, seats: input.seats, directionIds } })
    return this.companyGet(actor, row.id)
  }

  /** While open; the directions are replaced when given; unpaid clears the stipend. */
  async update(actor: RequestActor, id: string, input: VacancyPatch): Promise<CompanyVacancyDto> {
    const company = await this.ownCompany(actor)
    const v = await this.ownVacancy(company.id, id)
    if (v.status !== 'OPEN') throw AppError.conflict('vacancy_closed', 'The vacancy is closed')
    const paid = input.paid ?? v.paid
    const stipend = input.stipend !== undefined ? input.stipend : v.stipendMinor !== null ? Number(v.stipendMinor / 100n) : null
    if (!paid && input.stipend) throw AppError.invalid('validation_failed', 'Validation failed', { issues: [{ path: 'stipend', message: 'A stipend needs paid' }] })
    const directionIds = input.directionIds ? await this.mainDirections(input.directionIds) : null
    const where = input.region !== undefined || input.districtId !== undefined ? await this.place(input.region ?? v.region.id, input.districtId !== undefined ? input.districtId : v.district?.id ?? null) : {}
    const data: Prisma.VacancyUncheckedUpdateInput = {
      ...where,
      ...(input.kind !== undefined ? { kind: input.kind } : {}), ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.address !== undefined ? { address: input.address } : {}), ...(input.format !== undefined ? { format: input.format } : {}),
      paid, stipendMinor: paid && stipend ? BigInt(stipend) * 100n : null,
      ...(input.duration !== undefined ? { duration: input.duration } : {}), ...(input.seats !== undefined ? { seats: input.seats } : {}),
      ...(input.requirements !== undefined ? { requirements: input.requirements } : {}), ...(input.deadline !== undefined ? { deadline: dateOf(input.deadline) } : {}),
    }
    await this.prisma.client.$transaction(async (tx) => {
      await tx.vacancy.update({ where: { id }, data })
      if (directionIds) {
        await tx.vacancyDirection.deleteMany({ where: { vacancyId: id } })
        await tx.vacancyDirection.createMany({ data: directionIds.map((directionId) => ({ vacancyId: id, directionId })) })
      }
    })
    await this.audit.record({ action: 'vacancy.update', entityType: 'Vacancy', entityId: id, after: { ...input } })
    return this.companyGet(actor, id)
  }

  async close(actor: RequestActor, id: string): Promise<CompanyVacancyDto> {
    const company = await this.ownCompany(actor)
    await this.ownVacancy(company.id, id)
    const moved = await this.prisma.client.vacancy.updateMany({ where: { id, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: new Date() } })
    if (moved.count !== 1) throw AppError.conflict('vacancy_closed', 'The vacancy is closed')
    await this.audit.record({ action: 'vacancy.close', entityType: 'Vacancy', entityId: id })
    return this.companyGet(actor, id)
  }

  /**
   * The applications with the full cards (the student agreed by applying). Opening them marks the new ones «просмотрен»
   * and tells those students; every card shown is in the audit log (ТЗ 8).
   */
  async applications(tenantId: string, actor: RequestActor, id: string): Promise<VacancyApplicationDto[]> {
    const company = await this.ownCompany(actor)
    const v = await this.ownVacancy(company.id, id)
    const fresh = await this.prisma.client.vacancyApplication.findMany({ where: { vacancyId: id, status: 'NEW' }, select: { id: true, userId: true } })
    if (fresh.length) {
      await this.prisma.client.vacancyApplication.updateMany({ where: { id: { in: fresh.map((a) => a.id) }, status: 'NEW' }, data: { status: 'VIEWED', statusChangedAt: new Date() } })
      for (const a of fresh) await this.tellStudent(tenantId, a, 'VIEWED', company.name, v.title)
    }
    const rows = await this.prisma.client.vacancyApplication.findMany({ where: { vacancyId: id }, orderBy: { createdAt: 'asc' }, take: 1000, select: { id: true, userId: true, status: true, note: true, createdAt: true, statusChangedAt: true } })
    const out: VacancyApplicationDto[] = []
    for (const r of rows) {
      out.push({ id: r.id, status: r.status, note: r.note, createdAt: r.createdAt.toISOString(), statusChangedAt: r.statusChangedAt?.toISOString() ?? null, student: { id: r.userId, ...(await this.contacts.fullCard(r.userId)) } })
      await this.audit.record({ action: 'vacancy.application.view', entityType: 'User', entityId: r.userId, after: { companyId: company.id, vacancyId: id, applicationId: r.id } })
    }
    return out
  }

  /** «Пригласить» / «Отказать»: from new or viewed only; the student is told. */
  async setStatus(tenantId: string, actor: RequestActor, applicationId: string, status: 'INVITED' | 'REJECTED'): Promise<VacancyApplicationDto[]> {
    const company = await this.ownCompany(actor)
    const a = await this.prisma.client.vacancyApplication.findFirst({ where: { id: applicationId, vacancy: { companyId: company.id } }, select: { id: true, userId: true, vacancyId: true, vacancy: { select: { title: true } } } })
    if (!a) throw AppError.notFound('Application')
    const moved = await this.prisma.client.vacancyApplication.updateMany({ where: { id: applicationId, status: { in: ['NEW', 'VIEWED'] } }, data: { status, statusChangedAt: new Date() } })
    if (moved.count !== 1) throw AppError.conflict('application_decided', 'This application is already decided')
    await this.audit.record({ action: status === 'INVITED' ? 'vacancy.application.invite' : 'vacancy.application.reject', entityType: 'VacancyApplication', entityId: applicationId })
    await this.tellStudent(tenantId, a, status, company.name, a.vacancy.title)
    return this.applications(tenantId, actor, a.vacancyId)
  }

  /** A certificate file of an applicant — a 5-minute link, audited (ТЗ 8 «скачал файл»). */
  async certificateLink(actor: RequestActor, applicationId: string, certificateId: string): Promise<DocumentLinkDto> {
    const company = await this.ownCompany(actor)
    const a = await this.prisma.client.vacancyApplication.findFirst({ where: { id: applicationId, vacancy: { companyId: company.id } }, select: { userId: true } })
    const cert = a ? await this.prisma.client.studentCertificate.findFirst({ where: { id: certificateId, userId: a.userId }, select: { fileKey: true } }) : null
    if (!a || !cert) throw AppError.notFound('Certificate')
    await this.audit.record({ action: 'vacancy.certificate.download', entityType: 'StudentCertificate', entityId: certificateId, after: { companyId: company.id, userId: a.userId, applicationId } })
    return { url: await this.docs.downloadUrl(cert.fileKey), expiresInSeconds: DOC_LINK_SECONDS }
  }

  // ───────────── student ─────────────

  /** Open vacancies of approved companies, deadline not passed; filters by industry, region, kind, format. */
  async list(actor: RequestActor, q: VacanciesQuery): Promise<VacancyDto[]> {
    const where: Prisma.VacancyWhereInput = { ...this.visible() }
    if (q.industry) {
      const industry = await this.prisma.client.industry.findFirst({ where: { OR: [{ id: q.industry }, { slug: q.industry }] }, select: { id: true } })
      if (!industry) return []
      where.directions = { some: { direction: { industryId: industry.id } } }
    }
    if (q.region) {
      const regionId = await regionIdByRef(this.prisma, q.region)
      if (!regionId) return []
      where.regionId = regionId
    }
    if (q.kind) where.kind = q.kind
    if (q.format) where.format = q.format
    const rows = await this.prisma.client.vacancy.findMany({ where, orderBy: { createdAt: 'desc' }, take: 200, select: VACANCY_SELECT })
    return this.withMine(actor, rows)
  }

  async get(actor: RequestActor, id: string): Promise<VacancyDto> {
    const row = await this.prisma.client.vacancy.findFirst({ where: { id, ...this.visible() }, select: VACANCY_SELECT })
    if (!row) throw AppError.notFound('Vacancy')
    const [dto] = await this.withMine(actor, [row])
    return dto
  }

  /** «Откликнуться»: one application per vacancy; the questionnaire must be complete — the company gets the full card. */
  async apply(tenantId: string, actor: RequestActor, id: string, input: ApplyInput): Promise<VacancyDto> {
    const v = await this.prisma.client.vacancy.findFirst({ where: { id, ...this.visible() }, select: { id: true, title: true, companyId: true } })
    if (!v) throw AppError.notFound('Vacancy')
    if (!(await this.students.questionnaire(actor)).complete) throw AppError.invalid('questionnaire_incomplete', 'Fill in the questionnaire first')
    let applicationId: string
    try {
      applicationId = (await this.prisma.client.vacancyApplication.create({ data: { tenantId, vacancyId: id, userId: actor.id, note: input.note ?? null }, select: { id: true } })).id
    } catch (err) {
      if (isUniqueViolation(err)) throw AppError.conflict('application_exists', 'You have already applied')
      throw err
    }
    await this.audit.record({ action: 'vacancy.apply', entityType: 'VacancyApplication', entityId: applicationId, after: { vacancyId: id, companyId: v.companyId } })
    await this.notifications.safely('vacancy.application', async () => {
      const reps = await this.prisma.client.user.findMany({ where: { companyId: v.companyId, isActive: true }, select: { id: true } })
      await this.notifications.notify({ tenantId, userIds: reps.map((u) => u.id), type: 'vacancy.application', params: { vacancyTitle: v.title, vacancyId: id }, dedupeKey: `vacancy-application:${applicationId}` })
    })
    return this.get(actor, id)
  }

  async myApplications(actor: RequestActor): Promise<StudentApplicationDto[]> {
    const rows = await this.prisma.client.vacancyApplication.findMany({
      where: { userId: actor.id }, orderBy: { createdAt: 'desc' }, take: 500,
      select: { id: true, status: true, note: true, createdAt: true, statusChangedAt: true, vacancy: { select: VACANCY_SELECT } },
    })
    return rows.map((r) => ({ id: r.id, status: r.status, note: r.note, createdAt: r.createdAt.toISOString(), statusChangedAt: r.statusChangedAt?.toISOString() ?? null, vacancy: toVacancy(r.vacancy) }))
  }

  // ───────────── helpers ─────────────

  private visible(): Prisma.VacancyWhereInput {
    return { status: 'OPEN', company: { approvedAt: { not: null } }, OR: [{ deadline: null }, { deadline: { gte: todayUtc() } }] }
  }

  private async withMine(actor: RequestActor, rows: VacancyRow[]): Promise<VacancyDto[]> {
    const mine = new Map((await this.prisma.client.vacancyApplication.findMany({ where: { userId: actor.id, vacancyId: { in: rows.map((r) => r.id) } }, select: { id: true, vacancyId: true, status: true } })).map((a) => [a.vacancyId, { id: a.id, status: a.status }]))
    return rows.map((r) => ({ ...toVacancy(r), myApplication: mine.get(r.id) ?? null }))
  }

  private async withCounts(rows: VacancyRow[]): Promise<CompanyVacancyDto[]> {
    const groups = await this.prisma.client.vacancyApplication.groupBy({ by: ['vacancyId', 'status'], where: { vacancyId: { in: rows.map((r) => r.id) } }, _count: { _all: true } })
    return rows.map((r) => ({
      ...toVacancy(r), closedAt: r.closedAt?.toISOString() ?? null,
      applications: Object.fromEntries(STATUSES.map((s) => [s, groups.find((g) => g.vacancyId === r.id && g.status === s)?._count._all ?? 0])) as Record<ApplicationStatus, number>,
    }))
  }

  private async tellStudent(tenantId: string, a: { id: string; userId: string }, status: 'VIEWED' | 'INVITED' | 'REJECTED', companyName: string, vacancyTitle: string) {
    const type = status === 'VIEWED' ? 'vacancy.applicationViewed' : status === 'INVITED' ? 'vacancy.applicationInvited' : 'vacancy.applicationRejected'
    await this.notifications.safely(type, () => this.notifications.notify({ tenantId, userIds: [a.userId], type, params: { companyName, vacancyTitle, applicationId: a.id }, dedupeKey: `vacancy-application-${status.toLowerCase()}:${a.id}` }))
  }

  /** Directions that exist; an alias stands for its main direction; each once. */
  private async mainDirections(ids: string[]): Promise<string[]> {
    const found = await this.prisma.client.direction.findMany({ where: { id: { in: ids } }, select: { id: true, mergedIntoId: true } })
    if (found.length !== new Set(ids).size) throw AppError.invalid('invalid_direction', 'Choose directions from the list')
    return [...new Set(found.map((d) => d.mergedIntoId ?? d.id))]
  }

  /** Region by id or slug; a district must lie in it. */
  private async place(region: string, districtId: string | null) {
    const regionId = await regionIdByRef(this.prisma, region)
    if (!regionId) throw AppError.invalid('invalid_region', 'Choose a region from the list')
    if (districtId && !(await this.prisma.client.district.findFirst({ where: { id: districtId, regionId }, select: { id: true } }))) throw AppError.invalid('invalid_district', 'Choose a district of the region')
    return { regionId, districtId }
  }

  private async ownVacancy(companyId: string, id: string) {
    const v = await this.prisma.client.vacancy.findFirst({ where: { id, companyId }, select: VACANCY_SELECT })
    if (!v) throw AppError.notFound('Vacancy')
    return v
  }

  private async ownCompany(actor: RequestActor) {
    const user = await this.prisma.client.user.findFirst({ where: { id: actor.id }, select: { company: { select: { id: true, name: true } } } })
    if (!user?.company) throw AppError.notFound('Company')
    return user.company
  }
}
