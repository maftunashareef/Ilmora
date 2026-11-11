import { Inject, Injectable } from '@nestjs/common'
import { type AnnouncementDto, type AnnouncementResponseDto, ageOn, type CompanyAnnouncementDto, type GraduateCardDto, type L, type MatchStatus, type PartyContactsDto } from '@ilmora/shared'
import { hmacSha256 } from '../../common/crypto'
import { AppError } from '../../common/errors'
import { dateColumnToIso } from '../../common/time'
import { ENV, type Env } from '../../config/env'
import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infra/prisma/prisma.service'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { ContactsService } from '../contacts/contacts.service'
import { NotificationsService } from '../notifications/notifications.service'
import { DIRECTION_WITH_MAIN, INDUSTRY_SELECT, isUniqueViolation, mainOf, toIndustry } from '../registry/registry.mappers'
import type { AnnouncementInput, AnnouncementPatch, AnnouncementsQuery, ResponseInput } from './graduates.schemas'

const iso = (d: Date | null) => d?.toISOString() ?? null
const place = (r: { id: string; name: unknown } | null) => (r ? { id: r.id, name: r.name as L } : null)
const LINE_SELECT = { id: true, count: true, directionId: true, direction: { select: DIRECTION_WITH_MAIN } } as const
type LineRow = Prisma.AnnouncementLineGetPayload<{ select: typeof LINE_SELECT }>
const industryOf = (l: LineRow) => (l.direction.mergedInto ?? l.direction).industry.id
const REP = { select: { displayName: true, jobTitle: true, email: true } } as const
const rep = (r: { displayName: string; jobTitle: string | null; email: string | null } | null) => (r ? { name: r.displayName, jobTitle: r.jobTitle, email: r.email } : null)
/**
 * Students whose cards an announcement may show (ТЗ 5.1 step 3): confirmed by the institution, with a current
 * GRADUATE_CARD consent, an account that is neither disabled nor deleted (a relation filter skips the soft-delete scope).
 */
const CARD_CONSENT: Prisma.UserWhereInput = { isActive: true, deletedAt: null, studentConsents: { some: { kind: 'GRADUATE_CARD', revokedAt: null, companyId: null } } }

/**
 * Graduation announcements (ТЗ 5.1). The institution announces, per direction, how many graduate in a year; the cards
 * are not stored — they are its confirmed students of that direction and year with a current consent, minus the ones
 * it excluded (a revoked consent hides a card at once; a student without consent is in the number, not in the cards).
 * Publishing notifies approved companies whose industries match a line — each company once per announcement. A company
 * sees only the lines of its industries and the cards on them, without contacts; it answers the announcement or invites
 * a graduate (a contact request). Approved institutions and companies only; organizations come from the database.
 */
@Injectable()
export class GraduatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly contacts: ContactsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ───────────── institution ─────────────

  async list(actor: RequestActor): Promise<AnnouncementDto[]> {
    const inst = await this.ownInstitution(actor)
    const rows = await this.prisma.client.graduationAnnouncement.findMany({ where: { institutionId: inst.id }, orderBy: [{ year: 'desc' }, { createdAt: 'desc' }], select: { id: true } })
    return Promise.all(rows.map((r) => this.announcementOf(inst.id, r.id)))
  }

  async get(actor: RequestActor, id: string): Promise<AnnouncementDto> {
    const inst = await this.ownInstitution(actor)
    return this.announcementOf(inst.id, id)
  }

  async create(tenantId: string, actor: RequestActor, input: AnnouncementInput): Promise<AnnouncementDto> {
    const inst = await this.ownInstitution(actor)
    const lines = await this.ownLines(inst.id, input.lines)
    const row = await this.prisma.client.graduationAnnouncement.create({ data: { tenantId, institutionId: inst.id, year: input.year, createdById: actor.id, lines: { create: lines } }, select: { id: true } })
    await this.audit.record({ action: 'announcement.create', entityType: 'GraduationAnnouncement', entityId: row.id, after: { year: input.year, lines } })
    return this.announcementOf(inst.id, row.id)
  }

  /** Replaces the lines (draft or published); a published one notifies the companies of a new industry only. */
  async updateLines(tenantId: string, actor: RequestActor, id: string, input: AnnouncementPatch): Promise<AnnouncementDto> {
    const inst = await this.ownInstitution(actor)
    const ann = await this.ownAnnouncement(inst.id, id)
    if (ann.status === 'CLOSED') throw AppError.conflict('announcement_closed', 'The announcement is closed')
    const lines = await this.ownLines(inst.id, input.lines)
    await this.prisma.client.$transaction(async (tx) => {
      // Lines that stay keep their id (and the companies' answers to them); dropped ones go, new ones come.
      const keep = new Set(lines.map((l) => l.directionId))
      await tx.announcementLine.deleteMany({ where: { announcementId: id, directionId: { notIn: [...keep] } } })
      for (const l of lines) await tx.announcementLine.upsert({ where: { announcementId_directionId: { announcementId: id, directionId: l.directionId } }, create: { announcementId: id, ...l }, update: { count: l.count } })
    })
    await this.audit.record({ action: 'announcement.update', entityType: 'GraduationAnnouncement', entityId: id, after: { lines } })
    if (ann.status === 'PUBLISHED') await this.notifyCompanies(tenantId, inst, id)
    return this.announcementOf(inst.id, id)
  }

  async publish(tenantId: string, actor: RequestActor, id: string): Promise<AnnouncementDto> {
    const inst = await this.ownInstitution(actor)
    await this.ownAnnouncement(inst.id, id)
    const moved = await this.prisma.client.graduationAnnouncement.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'PUBLISHED', publishedAt: new Date() } })
    if (moved.count !== 1) throw AppError.conflict('announcement_not_draft', 'Only a draft can be published')
    await this.audit.record({ action: 'announcement.publish', entityType: 'GraduationAnnouncement', entityId: id })
    await this.notifyCompanies(tenantId, inst, id)
    return this.announcementOf(inst.id, id)
  }

  async close(actor: RequestActor, id: string): Promise<AnnouncementDto> {
    const inst = await this.ownInstitution(actor)
    await this.ownAnnouncement(inst.id, id)
    const moved = await this.prisma.client.graduationAnnouncement.updateMany({ where: { id, status: 'PUBLISHED' }, data: { status: 'CLOSED', closedAt: new Date() } })
    if (moved.count !== 1) throw AppError.conflict('announcement_not_published', 'Only a published announcement can be closed')
    await this.audit.record({ action: 'announcement.close', entityType: 'GraduationAnnouncement', entityId: id })
    return this.announcementOf(inst.id, id)
  }

  /** ТЗ 5.1 step 3: the institution can take a student out of the announcement (and put them back); never add one without consent. */
  async setExcluded(actor: RequestActor, id: string, studentId: string, excluded: boolean): Promise<AnnouncementDto> {
    const inst = await this.ownInstitution(actor)
    await this.ownAnnouncement(inst.id, id)
    const own = await this.prisma.client.studentProfile.findFirst({ where: { userId: studentId, institutionId: inst.id }, select: { userId: true } })
    if (!own) throw AppError.notFound('Student')
    if (excluded) await this.prisma.client.announcementExclusion.upsert({ where: { announcementId_userId: { announcementId: id, userId: studentId } }, create: { announcementId: id, userId: studentId }, update: {} })
    else await this.prisma.client.announcementExclusion.deleteMany({ where: { announcementId: id, userId: studentId } })
    await this.audit.record({ action: excluded ? 'announcement.exclude' : 'announcement.include', entityType: 'GraduationAnnouncement', entityId: id, after: { studentId } })
    return this.announcementOf(inst.id, id)
  }

  /** The companies' answers; their contacts open once the institution accepts. */
  async responses(actor: RequestActor, id: string): Promise<AnnouncementResponseDto[]> {
    const inst = await this.ownInstitution(actor)
    await this.ownAnnouncement(inst.id, id)
    const rows = await this.prisma.client.announcementResponse.findMany({
      where: { announcementId: id, status: { not: 'WITHDRAWN' } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, comment: true, status: true, createdAt: true,
        company: { select: { id: true, name: true, about: true, website: true, address: true, region: { select: { id: true, name: true } }, industries: { select: { industry: { select: { ...INDUSTRY_SELECT, sortOrder: true } } } }, representative: REP } },
        lines: { select: { lineId: true, wantedCount: true, line: { select: { direction: { select: DIRECTION_WITH_MAIN } } } } },
      },
    })
    return rows.map((r) => ({
      id: r.id, comment: r.comment, status: r.status, createdAt: r.createdAt.toISOString(),
      company: { id: r.company.id, name: r.company.name, about: r.company.about, region: place(r.company.region), industries: r.company.industries.map((i) => i.industry).sort((a, b) => a.sortOrder - b.sortOrder).map(toIndustry) },
      lines: r.lines.map((l) => ({ lineId: l.lineId, direction: mainOf(l.line.direction), wantedCount: l.wantedCount })),
      contacts: r.status === 'ACCEPTED' ? { phone: null, email: r.company.representative?.email ?? null, website: r.company.website, address: r.company.address, representative: rep(r.company.representative) } : null,
    }))
  }

  async decideResponse(tenantId: string, actor: RequestActor, responseId: string, accept: boolean): Promise<AnnouncementResponseDto[]> {
    const inst = await this.ownInstitution(actor)
    const r = await this.prisma.client.announcementResponse.findFirst({ where: { id: responseId, announcement: { institutionId: inst.id } }, select: { announcementId: true, company: { select: { representative: { select: { id: true } } } } } })
    if (!r) throw AppError.notFound('Response')
    const moved = await this.prisma.client.announcementResponse.updateMany({ where: { id: responseId, status: 'PENDING' }, data: { status: accept ? 'ACCEPTED' : 'DECLINED', decidedAt: new Date() } })
    if (moved.count !== 1) throw AppError.conflict('response_decided', 'This response is already decided')
    await this.audit.record({ action: accept ? 'announcement.response.accept' : 'announcement.response.decline', entityType: 'AnnouncementResponse', entityId: responseId, after: { contactsOpened: accept } })
    const repId = r.company.representative?.id
    if (repId) {
      const type = accept ? 'announcement.responseAccepted' : 'announcement.responseDeclined'
      await this.notifications.safely(type, () => this.notifications.notify({ tenantId, userIds: [repId], type, params: { institutionName: inst.name, announcementId: r.announcementId }, dedupeKey: `announcement-response-decision:${responseId}` }))
    }
    return this.responses(actor, r.announcementId)
  }

  // ───────────── company ─────────────

  /** Published announcements with at least one line of the company's industries; only those lines (ТЗ 5.1). */
  async companyList(actor: RequestActor, q: AnnouncementsQuery): Promise<CompanyAnnouncementDto[]> {
    const company = await this.ownCompany(actor)
    if (!company.industries.length) return []
    const rows = await this.prisma.client.graduationAnnouncement.findMany({
      where: { status: 'PUBLISHED', institution: { approvedAt: { not: null }, blockedAt: null, mergedIntoId: null }, ...(q.year ? { year: q.year } : {}), lines: { some: { direction: this.ofIndustries(company.industries) } } },
      orderBy: { publishedAt: 'desc' }, take: 200, select: { id: true },
    })
    return Promise.all(rows.map((r) => this.companyAnnouncement(company, r.id, false)))
  }

  /** One announcement with the graduates of the visible lines; anything not visible to the company is «not found». */
  async companyGet(actor: RequestActor, id: string): Promise<CompanyAnnouncementDto> {
    return this.companyAnnouncement(await this.ownCompany(actor), id, true)
  }

  /** ТЗ 5.1 «Откликнуться»: one answer per company and announcement, on visible lines only; the institution is notified. */
  async respond(tenantId: string, actor: RequestActor, id: string, input: ResponseInput): Promise<CompanyAnnouncementDto> {
    const company = await this.ownCompany(actor)
    const visible = await this.companyAnnouncement(company, id, false)
    const lineIds = new Set(visible.lines.map((l) => l.id))
    if (input.lines.some((l) => !lineIds.has(l.lineId))) throw AppError.invalid('invalid_line', 'Choose lines of the announcement you see')
    let responseId: string
    try {
      responseId = (await this.prisma.client.announcementResponse.create({
        data: { tenantId, announcementId: id, companyId: company.id, comment: input.comment ?? null, lines: { create: input.lines.map((l) => ({ lineId: l.lineId, wantedCount: l.wantedCount })) } },
        select: { id: true },
      })).id
    } catch (err) {
      if (isUniqueViolation(err)) throw AppError.conflict('response_exists', 'Your company has already answered this announcement')
      throw err
    }
    await this.audit.record({ action: 'announcement.response', entityType: 'AnnouncementResponse', entityId: responseId, after: { announcementId: id, lines: input.lines } })
    const repId = (await this.prisma.client.user.findFirst({ where: { institutionId: visible.institution.id }, select: { id: true } }))?.id
    if (repId) await this.notifications.safely('announcement.response', () => this.notifications.notify({ tenantId, userIds: [repId], type: 'announcement.response', params: { companyName: company.name, announcementId: id }, dedupeKey: `announcement-response:${responseId}` }))
    return this.companyAnnouncement(company, id, true)
  }

  /** ТЗ 5.1 «Пригласить»: a contact request to a graduate the company sees in this announcement — nobody else. */
  async invite(tenantId: string, actor: RequestActor, cardId: string, announcementId: string): Promise<CompanyAnnouncementDto> {
    const company = await this.ownCompany(actor)
    const userId = (await this.companyView(company, announcementId, true)).userByCard.get(cardId)
    if (!userId) throw AppError.notFound('Graduate')
    await this.contacts.request(tenantId, company, userId, 'GRADUATE', { announcementId })
    return this.companyAnnouncement(company, announcementId, true)
  }

  // ───────────── helpers ─────────────

  /**
   * A graduate card's id: a keyed hash of the company, the announcement and the student. Stable within the announcement
   * for this company, unrelated across companies and years, and it cannot be turned back into the account id (№127).
   */
  private cardId(companyId: string, announcementId: string, userId: string) {
    // Its own secret (Н-6); without it a key derived from the sign-in secret, as before.
    const key = this.env.CARD_ID_SECRET ?? hmacSha256(this.env.JWT_ACCESS_SECRET, 'ilmora-graduate-card')
    return hmacSha256(key, `${companyId}:${announcementId}:${userId}`).slice(0, 32)
  }

  private ofIndustries(ids: string[]): Prisma.DirectionWhereInput {
    return { OR: [{ mergedIntoId: null, industryId: { in: ids } }, { mergedInto: { industryId: { in: ids } } }] }
  }

  private async companyAnnouncement(company: { id: string; industries: string[] }, id: string, withGraduates: boolean): Promise<CompanyAnnouncementDto> {
    return (await this.companyView(company, id, withGraduates)).dto
  }

  /** The announcement as the company sees it, and which account stands behind each graduate card (never sent out). */
  private async companyView(company: { id: string; industries: string[] }, id: string, withGraduates: boolean): Promise<{ dto: CompanyAnnouncementDto; userByCard: Map<string, string> }> {
    const ann = await this.prisma.client.graduationAnnouncement.findFirst({
      where: { id, status: 'PUBLISHED', institution: { approvedAt: { not: null }, blockedAt: null, mergedIntoId: null } },
      select: { id: true, year: true, publishedAt: true, institutionId: true, institution: { select: { id: true, name: true, type: true, region: { select: { id: true, name: true } }, phone: true, email: true, website: true, address: true, representative: REP } }, lines: { select: LINE_SELECT } },
    })
    const lines = ann ? ann.lines.filter((l) => company.industries.includes(industryOf(l))) : []
    if (!ann || !lines.length) throw AppError.notFound('Announcement')
    const mine = await this.prisma.client.announcementResponse.findFirst({ where: { announcementId: id, companyId: company.id }, select: { id: true, status: true, comment: true, lines: { select: { lineId: true, wantedCount: true } } } })
    const i = ann.institution
    const contacts: PartyContactsDto | null = mine?.status === 'ACCEPTED' ? { phone: i.phone, email: i.email, website: i.website, address: i.address, representative: rep(i.representative) } : null
    const dto: CompanyAnnouncementDto = {
      id: ann.id, year: ann.year, publishedAt: iso(ann.publishedAt),
      institution: { id: i.id, name: i.name, type: i.type, region: place(i.region) },
      lines: lines.map((l) => ({ id: l.id, direction: mainOf(l.direction), count: l.count })),
      total: lines.reduce((n, l) => n + l.count, 0),
      myResponse: mine ? { id: mine.id, status: mine.status, comment: mine.comment, lines: mine.lines, contacts } : null,
    }
    const userByCard = new Map<string, string>()
    if (withGraduates) {
      const cards = await this.cards(company.id, ann, lines)
      dto.graduates = cards.map(({ userId, ...card }) => (userByCard.set(card.cardId, userId), card))
    }
    return { dto, userByCard }
  }

  /** The cards of the visible lines (ТЗ 5.1 «Что видит компания»): no phone, e-mail or files. */
  private async cards(companyId: string, ann: { id: string; year: number; institutionId: string; institution: { name: string } }, lines: LineRow[]): Promise<(GraduateCardDto & { userId: string })[]> {
    const byDirection = new Map(lines.map((l) => [l.directionId, l]))
    const excluded = new Set((await this.prisma.client.announcementExclusion.findMany({ where: { announcementId: ann.id }, select: { userId: true } })).map((e) => e.userId))
    const rows = await this.prisma.client.studentProfile.findMany({
      where: { institutionId: ann.institutionId, mode: 'STUDYING', studyConfirmation: 'CONFIRMED', graduationYear: ann.year, directionId: { in: [...byDirection.keys()] }, user: CARD_CONSENT },
      select: {
        userId: true, directionId: true, about: true, birthDate: true, region: { select: { id: true, name: true } },
        user: { select: { displayName: true, studentConsents: { where: { kind: 'PARENT_CONSENT', revokedAt: null, companyId: null }, select: { id: true } }, studentCertificates: { select: { title: true }, orderBy: { createdAt: 'asc' } }, enrollments: { where: { status: { in: ['ACTIVE', 'COMPLETED'] } }, select: { course: { select: { title: true } } } } } },
      },
      orderBy: { user: { displayName: 'asc' } },
    })
    // A minor's card needs the parent's consent in force at every read, as on the contract-help card (ТЗ 8; cybersecurity
    // check 9.4, 11.11): the questionnaire checks it when saving, but a birth date or the parent's consent can change later.
    const now = new Date()
    const adultOrAllowed = (r: { birthDate: Date | null; user: { studentConsents: unknown[] } }) => {
      const age = r.birthDate ? ageOn(dateColumnToIso(r.birthDate), now) : null
      return age === null || age >= 18 || r.user.studentConsents.length > 0
    }
    const visible = rows.filter((r) => !excluded.has(r.userId) && adultOrAllowed(r))
    // Only requests sent from announcements: a request from the anonymous contract-help card must not show on the named
    // card, or the company learns who asked for help with the fee (matrix check 11.11, №126).
    const requests = new Map((await this.prisma.client.contactRequest.findMany({ where: { companyId, source: 'GRADUATE', userId: { in: visible.map((r) => r.userId) } }, select: { userId: true, status: true } })).map((c) => [c.userId, c.status as MatchStatus]))
    return visible.map((r) => ({
      userId: r.userId, cardId: this.cardId(companyId, ann.id, r.userId), name: r.user.displayName, institution: ann.institution.name, direction: mainOf(byDirection.get(r.directionId!)!.direction), graduationYear: ann.year,
      region: place(r.region), about: r.about, certificates: r.user.studentCertificates.map((c) => c.title),
      ilmoraCourses: [...new Map(r.user.enrollments.map((e) => [JSON.stringify(e.course.title), e.course.title as L])).values()],
      studyConfirmed: true as const, contactRequest: requests.get(r.userId) ?? null,
    }))
  }

  private async announcementOf(institutionId: string, id: string): Promise<AnnouncementDto> {
    const ann = await this.prisma.client.graduationAnnouncement.findFirst({ where: { id, institutionId }, select: { id: true, year: true, status: true, publishedAt: true, closedAt: true, lines: { select: LINE_SELECT } } })
    if (!ann) throw AppError.notFound('Announcement')
    const excluded = new Set((await this.prisma.client.announcementExclusion.findMany({ where: { announcementId: id }, select: { userId: true } })).map((e) => e.userId))
    const students = await this.prisma.client.studentProfile.findMany({
      where: { institutionId, mode: 'STUDYING', studyConfirmation: 'CONFIRMED', graduationYear: ann.year, directionId: { in: ann.lines.map((l) => l.directionId) }, user: CARD_CONSENT },
      select: { userId: true, directionId: true, course: true, user: { select: { displayName: true } } },
      orderBy: { user: { displayName: 'asc' } },
    })
    const [pending, accepted] = await Promise.all([
      this.prisma.client.announcementResponse.count({ where: { announcementId: id, status: 'PENDING' } }),
      this.prisma.client.announcementResponse.count({ where: { announcementId: id, status: 'ACCEPTED' } }),
    ])
    return {
      id: ann.id, year: ann.year, status: ann.status, publishedAt: iso(ann.publishedAt), closedAt: iso(ann.closedAt),
      lines: ann.lines.map((l) => ({
        id: l.id, direction: mainOf(l.direction), count: l.count,
        students: students.filter((s) => s.directionId === l.directionId).map((s) => ({ studentId: s.userId, name: s.user.displayName, course: s.course, excluded: excluded.has(s.userId) })),
      })),
      total: ann.lines.reduce((n, l) => n + l.count, 0),
      responses: { pending, accepted },
    }
  }

  /** Lines on the institution's own directions only (an alias counts as its main direction); each direction once. */
  private async ownLines(institutionId: string, lines: { directionId: string; count: number }[]) {
    const found = await this.prisma.client.direction.findMany({ where: { id: { in: lines.map((l) => l.directionId) } }, select: { id: true, mergedIntoId: true } })
    const main = new Map(found.map((d) => [d.id, d.mergedIntoId ?? d.id]))
    const own = new Set((await this.prisma.client.institutionDirection.findMany({ where: { institutionId }, select: { directionId: true } })).map((d) => d.directionId))
    const out = lines.map((l) => ({ directionId: main.get(l.directionId) ?? '', count: l.count }))
    if (out.some((l) => !own.has(l.directionId))) throw AppError.invalid('invalid_direction', 'Choose directions of your institution')
    if (new Set(out.map((l) => l.directionId)).size !== out.length) throw AppError.invalid('direction_listed_twice', 'Each direction can be listed once')
    return out
  }

  /** ТЗ 5.1 step 5: approved companies of the lines' industries, each once per announcement (dedupe key). */
  private async notifyCompanies(tenantId: string, inst: { id: string; name: string }, id: string) {
    await this.notifications.safely('announcement.published', async () => {
      const ann = await this.prisma.client.graduationAnnouncement.findFirstOrThrow({ where: { id }, select: { year: true, lines: { select: LINE_SELECT } } })
      const industries = [...new Set(ann.lines.map(industryOf))]
      const recipients = await this.prisma.client.user.findMany({ where: { isActive: true, company: { is: { approvedAt: { not: null }, blockedAt: null, industries: { some: { industryId: { in: industries } } } } } }, select: { id: true } })
      await this.notifications.notify({ tenantId, userIds: recipients.map((u) => u.id), type: 'announcement.published', params: { institutionName: inst.name, year: ann.year, announcementId: id }, dedupeKey: `announcement:${id}` })
    })
  }

  private async ownAnnouncement(institutionId: string, id: string) {
    const ann = await this.prisma.client.graduationAnnouncement.findFirst({ where: { id, institutionId }, select: { id: true, status: true } })
    if (!ann) throw AppError.notFound('Announcement')
    return ann
  }

  private async ownInstitution(actor: RequestActor) {
    const user = await this.prisma.client.user.findFirst({ where: { id: actor.id }, select: { institution: { select: { id: true, name: true } } } })
    if (!user?.institution) throw AppError.notFound('Institution')
    return user.institution
  }

  private async ownCompany(actor: RequestActor) {
    const user = await this.prisma.client.user.findFirst({ where: { id: actor.id }, select: { company: { select: { id: true, name: true, industries: { select: { industryId: true } } } } } })
    if (!user?.company) throw AppError.notFound('Company')
    return { id: user.company.id, name: user.company.name, industries: user.company.industries.map((i) => i.industryId) }
  }
}
