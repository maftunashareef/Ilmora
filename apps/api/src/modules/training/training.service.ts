import { Injectable } from '@nestjs/common'
import type { IncomingTrainingRequestDto, L, MatchStatus, PartyContactsDto, TrainingOfferDto, TrainingRequestDto } from '@ilmora/shared'
import { AppError } from '../../common/errors'
import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infra/prisma/prisma.service'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { NotificationsService } from '../notifications/notifications.service'
import { DIRECTION_WITH_MAIN, INDUSTRY_SELECT, isUniqueViolation, mainOf, regionIdByRef, toIndustry } from '../registry/registry.mappers'
import type { IncomingQuery, TrainingOfferInput, TrainingRequestInput, TrainingRequestPatch } from './training.schemas'

const iso = (d: Date | null) => d?.toISOString() ?? null
const place = (r: { id: string; name: unknown } | null) => (r ? { id: r.id, name: r.name as L } : null)
/** A direction belongs to an industry directly, or — an alias — through the direction it was merged into. */
const inIndustries = (ids: string[]): Prisma.DirectionWhereInput => ({ OR: [{ mergedIntoId: null, industryId: { in: ids } }, { mergedInto: { industryId: { in: ids } } }] })

const REP = { select: { displayName: true, jobTitle: true, email: true } } as const
const INSTITUTION_CONTACTS = { phone: true, email: true, website: true, address: true, representative: REP } as const
const COMPANY_CONTACTS = { website: true, address: true, representative: REP } as const
type Rep = { displayName: string; jobTitle: string | null; email: string | null } | null
const rep = (r: Rep) => (r ? { name: r.displayName, jobTitle: r.jobTitle, email: r.email } : null)

const OFFER_SELECT = {
  id: true, count: true, byYear: true, comment: true, status: true, createdAt: true, decidedAt: true,
  institution: { select: { id: true, name: true, type: true, region: { select: { id: true, name: true } }, ...INSTITUTION_CONTACTS } },
} as const satisfies Prisma.TrainingOfferSelect
const REQUEST_SELECT = {
  id: true, companyId: true, count: true, byYear: true, requirements: true, status: true, createdAt: true, closedAt: true,
  direction: { select: DIRECTION_WITH_MAIN },
  region: { select: { id: true, name: true } },
  offers: { select: OFFER_SELECT, orderBy: { createdAt: 'asc' } },
} as const satisfies Prisma.TrainingRequestSelect
const INCOMING_SELECT = {
  id: true, count: true, byYear: true, requirements: true, createdAt: true,
  direction: { select: DIRECTION_WITH_MAIN },
  region: { select: { id: true, name: true } },
  company: {
    select: {
      id: true, name: true, about: true, region: { select: { id: true, name: true } },
      industries: { select: { industry: { select: { ...INDUSTRY_SELECT, sortOrder: true } } } },
      ...COMPANY_CONTACTS,
    },
  },
} as const satisfies Prisma.TrainingRequestSelect

type OfferRow = Prisma.TrainingOfferGetPayload<{ select: typeof OFFER_SELECT }>
type RequestRow = Prisma.TrainingRequestGetPayload<{ select: typeof REQUEST_SELECT }>
type IncomingRow = Prisma.TrainingRequestGetPayload<{ select: typeof INCOMING_SELECT }>

function toOffer(o: OfferRow): TrainingOfferDto {
  const i = o.institution
  const contacts: PartyContactsDto | null = o.status === 'ACCEPTED' ? { phone: i.phone, email: i.email, website: i.website, address: i.address, representative: rep(i.representative) } : null
  return {
    id: o.id, count: o.count, byYear: o.byYear, comment: o.comment, status: o.status, createdAt: o.createdAt.toISOString(), decidedAt: iso(o.decidedAt),
    institution: { id: i.id, name: i.name, type: i.type, region: place(i.region) },
    contacts,
  }
}

function toRequest(r: RequestRow): TrainingRequestDto {
  const offers = r.offers.map(toOffer)
  const accepted = offers.filter((o) => o.status === 'ACCEPTED')
  return {
    id: r.id, direction: mainOf(r.direction), count: r.count, byYear: r.byYear, region: place(r.region), requirements: r.requirements,
    status: r.status, createdAt: r.createdAt.toISOString(), closedAt: iso(r.closedAt),
    offers,
    summary: { pending: offers.filter((o) => o.status === 'PENDING').length, accepted: accepted.length, promised: accepted.reduce((n, o) => n + o.count, 0) },
  }
}

/**
 * Training requests «под обучение» and the institutions' offers (ТЗ 5.2). A company asks for N graduates of a
 * direction by a year (in a region or anywhere); the approved institutions that teach a direction of the same industry
 * (in that region) are notified and see the request — nobody else, not even by its id. An institution offers «we will
 * prepare N by year Y»; the company accepts or declines. Contacts open to both sides only after acceptance. Approved
 * companies and institutions only (the controllers use `@Approved`); the organization is read from the database.
 */
@Injectable()
export class TrainingService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly notifications: NotificationsService) {}

  // ───────────── company ─────────────

  async create(tenantId: string, actor: RequestActor, input: TrainingRequestInput): Promise<TrainingRequestDto> {
    const company = await this.ownCompany(actor)
    const direction = await this.prisma.client.direction.findFirst({ where: { id: input.directionId }, select: { id: true, name: true, industryId: true, mergedInto: { select: { id: true, name: true, industryId: true } } } })
    if (!direction) throw AppError.invalid('invalid_direction', 'Choose a direction from the list')
    const main = direction.mergedInto ?? direction
    let regionId: string | null = null
    if (input.regionId) {
      regionId = await regionIdByRef(this.prisma, input.regionId)
      if (!regionId) throw AppError.invalid('invalid_region', 'Choose a region from the list')
    }
    const row = await this.prisma.client.trainingRequest.create({
      data: { tenantId, companyId: company.id, directionId: main.id, count: input.count, byYear: input.byYear, regionId, requirements: input.requirements ?? null },
      select: REQUEST_SELECT,
    })
    await this.audit.record({ action: 'training.request.create', entityType: 'TrainingRequest', entityId: row.id, after: { directionId: main.id, count: input.count, byYear: input.byYear, regionId } })
    // ТЗ 5.2 step 2: approved institutions with a direction of this industry (and in this region, when one is set).
    await this.notifications.safely('training.request', async () => {
      const recipients = await this.prisma.client.user.findMany({
        where: { isActive: true, institution: { is: { approvedAt: { not: null }, blockedAt: null, mergedIntoId: null, ...(regionId ? { regionId } : {}), directions: { some: { direction: inIndustries([main.industryId]) } } } } },
        select: { id: true },
      })
      await this.notifications.notify({ tenantId, userIds: recipients.map((u) => u.id), type: 'training.request', params: { companyName: company.name, directionName: main.name, count: input.count, byYear: input.byYear, requestId: row.id }, dedupeKey: `training-request:${row.id}` })
    })
    return toRequest(row)
  }

  async listOwn(actor: RequestActor): Promise<TrainingRequestDto[]> {
    const company = await this.ownCompany(actor)
    const rows = await this.prisma.client.trainingRequest.findMany({ where: { companyId: company.id }, orderBy: { createdAt: 'desc' }, take: 200, select: REQUEST_SELECT })
    return rows.map(toRequest)
  }

  async getOwn(actor: RequestActor, id: string): Promise<TrainingRequestDto> {
    return toRequest(await this.ownRequest(actor, id))
  }

  async update(actor: RequestActor, id: string, input: TrainingRequestPatch): Promise<TrainingRequestDto> {
    const current = await this.ownRequest(actor, id)
    if (current.status !== 'OPEN') throw AppError.conflict('request_closed', 'The request is closed')
    const row = await this.prisma.client.trainingRequest.update({ where: { id }, data: input, select: REQUEST_SELECT })
    await this.audit.record({ action: 'training.request.update', entityType: 'TrainingRequest', entityId: id, before: { count: current.count, byYear: current.byYear, requirements: current.requirements }, after: input })
    return toRequest(row)
  }

  async close(actor: RequestActor, id: string): Promise<TrainingRequestDto> {
    const current = await this.ownRequest(actor, id)
    if (current.status !== 'OPEN') throw AppError.conflict('request_closed', 'The request is closed')
    const row = await this.prisma.client.trainingRequest.update({ where: { id }, data: { status: 'CLOSED', closedAt: new Date() }, select: REQUEST_SELECT })
    await this.audit.record({ action: 'training.request.close', entityType: 'TrainingRequest', entityId: id })
    return toRequest(row)
  }

  /** ТЗ 5.2 step 4: the company decides on an offer; accepting opens the contacts both ways. */
  async decide(tenantId: string, actor: RequestActor, offerId: string, accept: boolean): Promise<TrainingRequestDto> {
    const company = await this.ownCompany(actor)
    const offer = await this.prisma.client.trainingOffer.findFirst({
      where: { id: offerId, request: { companyId: company.id } },
      select: { id: true, status: true, requestId: true, institution: { select: { name: true, representative: { select: { id: true } } } }, request: { select: { direction: { select: { name: true, mergedInto: { select: { name: true } } } } } } },
    })
    if (!offer) throw AppError.notFound('Offer')
    const status = accept ? 'ACCEPTED' : 'DECLINED'
    const moved = await this.prisma.client.trainingOffer.updateMany({ where: { id: offerId, status: 'PENDING' }, data: { status, decidedAt: new Date() } })
    if (moved.count !== 1) throw AppError.conflict('offer_decided', 'This offer is no longer waiting for a decision')
    await this.audit.record({ action: accept ? 'training.offer.accept' : 'training.offer.decline', entityType: 'TrainingOffer', entityId: offerId, after: { status, contactsOpened: accept } })
    const userId = offer.institution.representative?.id
    if (userId) {
      const type = accept ? 'training.offerAccepted' : 'training.offerDeclined'
      await this.notifications.safely(type, () =>
        this.notifications.notify({ tenantId, userIds: [userId], type, params: { companyName: company.name, directionName: offer.request.direction.mergedInto?.name ?? offer.request.direction.name, requestId: offer.requestId }, dedupeKey: `training-offer-decision:${offerId}` }),
      )
    }
    return toRequest(await this.ownRequest(actor, offer.requestId))
  }

  // ───────────── institution ─────────────

  /** ТЗ 5.2 step 2: open requests of the institution's industries, in its region or for any region. */
  async incoming(actor: RequestActor, q: IncomingQuery): Promise<IncomingTrainingRequestDto[]> {
    const inst = await this.ownInstitution(actor)
    const industries = q.industryId ? inst.industries.filter((i) => i === q.industryId) : inst.industries
    if (industries.length === 0) return []
    const rows = await this.prisma.client.trainingRequest.findMany({ where: this.visibleTo(inst, industries), orderBy: { createdAt: 'desc' }, take: 200, select: INCOMING_SELECT })
    const mine = await this.myOffers(inst.id, rows.map((r) => r.id))
    return rows.map((r) => this.toIncoming(r, mine.get(r.id) ?? null))
  }

  /** One request — only if the institution would see it in its list; anything else is «not found». */
  async incomingOne(actor: RequestActor, id: string): Promise<IncomingTrainingRequestDto> {
    const inst = await this.ownInstitution(actor)
    const row = inst.industries.length ? await this.prisma.client.trainingRequest.findFirst({ where: { id, ...this.visibleTo(inst, inst.industries) }, select: INCOMING_SELECT }) : null
    if (!row) throw AppError.notFound('Training request')
    return this.toIncoming(row, (await this.myOffers(inst.id, [id])).get(id) ?? null)
  }

  /** ТЗ 5.2 step 3: one offer per institution and request; a withdrawn offer can be sent again, a declined one cannot. */
  async offer(tenantId: string, actor: RequestActor, requestId: string, input: TrainingOfferInput): Promise<IncomingTrainingRequestDto> {
    const inst = await this.ownInstitution(actor)
    const request = inst.industries.length
      ? await this.prisma.client.trainingRequest.findFirst({ where: { id: requestId, ...this.visibleTo(inst, inst.industries) }, select: { id: true, company: { select: { representative: { select: { id: true } } } } } })
      : null
    if (!request) throw AppError.notFound('Training request')
    const data = { count: input.count, byYear: input.byYear, comment: input.comment ?? null }
    let offerId: string
    try {
      offerId = (await this.prisma.client.trainingOffer.create({ data: { tenantId, requestId, institutionId: inst.id, ...data }, select: { id: true } })).id
    } catch (err) {
      if (!isUniqueViolation(err)) throw err
      // The institution offered before: only a withdrawn offer can be sent again.
      const again = await this.prisma.client.trainingOffer.updateMany({ where: { requestId, institutionId: inst.id, status: 'WITHDRAWN' }, data: { ...data, status: 'PENDING', decidedAt: null } })
      if (again.count !== 1) throw AppError.conflict('offer_exists', 'Your institution has already answered this request')
      offerId = (await this.prisma.client.trainingOffer.findFirstOrThrow({ where: { requestId, institutionId: inst.id }, select: { id: true } })).id
    }
    await this.audit.record({ action: 'training.offer.create', entityType: 'TrainingOffer', entityId: offerId, after: { requestId, ...data } })
    const userId = request.company.representative?.id
    if (userId) {
      await this.notifications.safely('training.offer', () =>
        this.notifications.notify({ tenantId, userIds: [userId], type: 'training.offer', params: { institutionName: inst.name, count: input.count, byYear: input.byYear, requestId }, dedupeKey: `training-offer:${offerId}:${Date.now()}` }),
      )
    }
    return this.incomingOne(actor, requestId)
  }

  /** The institution takes back an offer still waiting for a decision. */
  async withdraw(actor: RequestActor, offerId: string): Promise<IncomingTrainingRequestDto> {
    const inst = await this.ownInstitution(actor)
    const offer = await this.prisma.client.trainingOffer.findFirst({ where: { id: offerId, institutionId: inst.id }, select: { requestId: true } })
    if (!offer) throw AppError.notFound('Offer')
    const moved = await this.prisma.client.trainingOffer.updateMany({ where: { id: offerId, status: 'PENDING' }, data: { status: 'WITHDRAWN', decidedAt: new Date() } })
    if (moved.count !== 1) throw AppError.conflict('offer_decided', 'This offer is no longer waiting for a decision')
    await this.audit.record({ action: 'training.offer.withdraw', entityType: 'TrainingOffer', entityId: offerId })
    const row = await this.prisma.client.trainingRequest.findFirstOrThrow({ where: { id: offer.requestId }, select: INCOMING_SELECT })
    return this.toIncoming(row, (await this.myOffers(inst.id, [offer.requestId])).get(offer.requestId) ?? null)
  }

  /** The institution's offers, with the request and — once accepted — the company's contacts. */
  async myOffersList(actor: RequestActor): Promise<IncomingTrainingRequestDto[]> {
    const inst = await this.ownInstitution(actor)
    const offers = await this.prisma.client.trainingOffer.findMany({ where: { institutionId: inst.id }, orderBy: { createdAt: 'desc' }, take: 200, select: { requestId: true } })
    const rows = await this.prisma.client.trainingRequest.findMany({ where: { id: { in: offers.map((o) => o.requestId) } }, select: INCOMING_SELECT })
    const mine = await this.myOffers(inst.id, rows.map((r) => r.id))
    const byId = new Map(rows.map((r) => [r.id, r]))
    return offers.map((o) => byId.get(o.requestId)).filter((r): r is IncomingRow => !!r).map((r) => this.toIncoming(r, mine.get(r.id) ?? null))
  }

  // ───────────── helpers ─────────────

  private visibleTo(inst: { regionId: string | null }, industries: string[]): Prisma.TrainingRequestWhereInput {
    return {
      status: 'OPEN',
      company: { approvedAt: { not: null }, blockedAt: null },
      direction: inIndustries(industries),
      OR: [{ regionId: null }, ...(inst.regionId ? [{ regionId: inst.regionId }] : [])],
    }
  }

  private async myOffers(institutionId: string, requestIds: string[]) {
    const rows = await this.prisma.client.trainingOffer.findMany({ where: { institutionId, requestId: { in: requestIds } }, select: { id: true, requestId: true, count: true, byYear: true, comment: true, status: true } })
    return new Map(rows.map((o) => [o.requestId, o]))
  }

  private toIncoming(r: IncomingRow, offer: { id: string; count: number; byYear: number; comment: string | null; status: MatchStatus } | null): IncomingTrainingRequestDto {
    const c = r.company
    const contacts: PartyContactsDto | null = offer?.status === 'ACCEPTED' ? { phone: null, email: c.representative?.email ?? null, website: c.website, address: c.address, representative: rep(c.representative) } : null
    return {
      id: r.id, direction: mainOf(r.direction), count: r.count, byYear: r.byYear, region: place(r.region), requirements: r.requirements, createdAt: r.createdAt.toISOString(),
      company: { id: c.id, name: c.name, about: c.about, region: place(c.region), industries: c.industries.map((i) => i.industry).sort((a, b) => a.sortOrder - b.sortOrder).map(toIndustry) },
      myOffer: offer ? { id: offer.id, count: offer.count, byYear: offer.byYear, comment: offer.comment, status: offer.status, contacts } : null,
    }
  }

  private async ownCompany(actor: RequestActor) {
    const user = await this.prisma.client.user.findFirst({ where: { id: actor.id }, select: { company: { select: { id: true, name: true } } } })
    if (!user?.company) throw AppError.notFound('Company')
    return user.company
  }

  /** The institution with the industries of its directions (an alias counts with its main direction's industry). */
  private async ownInstitution(actor: RequestActor) {
    const user = await this.prisma.client.user.findFirst({
      where: { id: actor.id },
      select: { institution: { select: { id: true, name: true, regionId: true, directions: { select: { direction: { select: { industryId: true, mergedInto: { select: { industryId: true } } } } } } } } },
    })
    if (!user?.institution) throw AppError.notFound('Institution')
    const i = user.institution
    return { id: i.id, name: i.name, regionId: i.regionId, industries: [...new Set(i.directions.map((d) => d.direction.mergedInto?.industryId ?? d.direction.industryId))] }
  }

  private async ownRequest(actor: RequestActor, id: string): Promise<RequestRow> {
    const company = await this.ownCompany(actor)
    const row = await this.prisma.client.trainingRequest.findFirst({ where: { id, companyId: company.id }, select: REQUEST_SELECT })
    if (!row) throw AppError.notFound('Training request')
    return row
  }
}
