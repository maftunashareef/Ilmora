import { Injectable } from '@nestjs/common'
import type { CompanyContactDto, ContactSource, DocumentLinkDto, L, PartyContactsDto, StudentContactRequestDto, StudentFullCardDto } from '@ilmora/shared'
import { AppError } from '../../common/errors'
import { PrismaService } from '../../infra/prisma/prisma.service'
import { DOC_LINK_SECONDS, PrivateDocsService } from '../../infra/storage/private-docs.service'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { NotificationsService } from '../notifications/notifications.service'
import { DIRECTION_WITH_MAIN, INDUSTRY_SELECT, isUniqueViolation, mainOf, toIndustry } from '../registry/registry.mappers'
import { dateColumnToIso } from '../../common/time'

const iso = (d: Date | null) => d?.toISOString() ?? null
/** The contacts a student agreed to show, as copied into a request or an application (security review №15). */
export interface SharedContacts { sharedName: string | null; sharedPhone: string | null; sharedEmail: string | null }
const COMPANY_CARD = {
  id: true, name: true, about: true, website: true, address: true, region: { select: { id: true, name: true } },
  representative: { select: { displayName: true, jobTitle: true, email: true } },
  industries: { select: { industry: { select: { ...INDUSTRY_SELECT, sortOrder: true } } } },
} as const

/** What the student sees of a company they opened contacts to: its site, address and representative. */
const companyContacts = (c: { website: string | null; address: string | null; representative: { displayName: string; jobTitle: string | null; email: string | null } | null }): PartyContactsDto => ({
  phone: null, email: c.representative?.email ?? null, website: c.website, address: c.address,
  representative: c.representative ? { name: c.representative.displayName, jobTitle: c.representative.jobTitle, email: c.representative.email } : null,
})

/**
 * Contact requests (ТЗ 5.1 «Пригласить», 5.3 «Заинтересованы», 8): a company asks a student to open their contacts;
 * the student decides each request. One request per channel (partial unique indexes, migration 20261119000000, #76):
 * from announcements once per company and student, from an anonymous card once per company and card — a declined request
 * is not sent again there, and «Заинтересованы» never answers «already asked» because of an invitation by name (№126). Accepting writes a COMPANY_CONTACTS consent row; only then the company sees the
 * full card (name, phone, e-mail, certificate files), and every view or download is audited.
 */
@Injectable()
export class ContactsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly docs: PrivateDocsService,
  ) {}

  /** Called by the features that found the student (graduates, contract help) after their own visibility checks. */
  async request(tenantId: string, company: { id: string; name: string }, userId: string, source: ContactSource, ref: { announcementId?: string; contractHelpId?: string }) {
    let id: string
    try {
      id = (await this.prisma.client.contactRequest.create({ data: { tenantId, companyId: company.id, userId, source, announcementId: ref.announcementId ?? null, contractHelpId: ref.contractHelpId ?? null }, select: { id: true } })).id
    } catch (err) {
      if (isUniqueViolation(err)) throw AppError.conflict('contact_request_exists', 'Your company has already asked this student')
      throw err
    }
    await this.audit.record({ action: 'contact.request', entityType: 'ContactRequest', entityId: id, after: { companyId: company.id, userId, source, ...ref } })
    await this.notifications.safely('contact.request', () =>
      this.notifications.notify({ tenantId, userIds: [userId], type: 'contact.request', params: { companyName: company.name, requestId: id }, dedupeKey: `contact-request:${id}` }),
    )
    return id
  }

  /**
   * «Мои контакты» (ТЗ 4.3): accepted contact requests and the applications to the company's vacancies (applying is the
   * student's consent), newest first. Names only — the full card is opened one by one, so every view is audited.
   * Pending and declined requests show on the cards where they were sent (announcements, contract help).
   */
  async companyList(actor: RequestActor): Promise<CompanyContactDto[]> {
    const companyId = await this.ownCompany(actor)
    const student = { select: { id: true, displayName: true } } as const
    // A disabled or deleted student leaves the company's contacts (relation reads skip the soft-delete scope: stated here).
    const live = { isActive: true, deletedAt: null }
    const [requests, applications] = await Promise.all([
      this.prisma.client.contactRequest.findMany({ where: { companyId, status: 'ACCEPTED', user: live }, orderBy: { decidedAt: 'desc' }, take: 500, select: { id: true, source: true, status: true, createdAt: true, decidedAt: true, sharedName: true, user: student } }),
      this.prisma.client.vacancyApplication.findMany({ where: { vacancy: { companyId }, user: live }, orderBy: { createdAt: 'desc' }, take: 500, select: { id: true, status: true, createdAt: true, statusChangedAt: true, sharedName: true, vacancy: { select: { id: true, title: true } }, user: student } }),
    ])
    const items: (CompanyContactDto & { at: number })[] = [
      ...requests.map((r) => ({ id: r.id, source: r.source, status: r.status, createdAt: r.createdAt.toISOString(), decidedAt: iso(r.decidedAt), vacancy: null, student: { id: r.user.id, name: r.sharedName ?? r.user.displayName, full: null }, at: (r.decidedAt ?? r.createdAt).getTime() })),
      ...applications.map((a) => ({ id: a.id, source: 'VACANCY' as const, status: a.status, createdAt: a.createdAt.toISOString(), decidedAt: iso(a.statusChangedAt), vacancy: a.vacancy, student: { id: a.user.id, name: a.sharedName ?? a.user.displayName, full: null }, at: a.createdAt.getTime() })),
    ]
    return items.sort((a, b) => b.at - a.at).map(({ at: _at, ...dto }) => dto)
  }

  /**
   * One accepted request with the full card. Anything else — pending, declined, taken back, or the student disabled — is
   * not found: the company learns who the student is only once the student agreed (review 11.11: the name and the id
   * used to come back for a pending or declined request, and the anonymous «contract help» card lost its anonymity).
   */
  async companyContact(actor: RequestActor, id: string): Promise<CompanyContactDto> {
    const companyId = await this.ownCompany(actor)
    const r = await this.prisma.client.contactRequest.findFirst({ where: { id, companyId, status: 'ACCEPTED', user: { isActive: true, deletedAt: null } }, select: { id: true, source: true, status: true, createdAt: true, decidedAt: true, userId: true, sharedName: true, sharedPhone: true, sharedEmail: true } })
    const consent = r ? await this.activeConsent(r.userId, companyId) : null
    if (!r || !consent) throw AppError.notFound('Contact request')
    const full = await this.fullCard(r.userId, consent.givenAt, r)
    await this.audit.record({ action: 'contact.view', entityType: 'User', entityId: r.userId, after: { companyId, requestId: id } })
    return { id: r.id, source: r.source, status: r.status, createdAt: r.createdAt.toISOString(), decidedAt: iso(r.decidedAt), vacancy: null, student: { id: r.userId, name: full.name, full } }
  }

  /** A certificate file of a student who accepted — a 5-minute link, audited (ТЗ 8 «скачал файл»). */
  async certificateLink(actor: RequestActor, requestId: string, certificateId: string): Promise<DocumentLinkDto> {
    const companyId = await this.ownCompany(actor)
    // A disabled or deleted student's files go to no company, as their card (cybersecurity check 9.4, 11.11).
    const r = await this.prisma.client.contactRequest.findFirst({ where: { id: requestId, companyId, status: 'ACCEPTED', user: { isActive: true, deletedAt: null } }, select: { userId: true } })
    const consent = r ? await this.activeConsent(r.userId, companyId) : null
    // Only a file the student had when they opened their contacts (ТЗ 8): what they add later is not shared.
    const cert = r && consent ? await this.prisma.client.studentCertificate.findFirst({ where: { id: certificateId, userId: r.userId, createdAt: { lte: consent.givenAt } }, select: { fileKey: true } }) : null
    if (!r || !cert) throw AppError.notFound('Certificate')
    await this.audit.record({ action: 'contact.certificate.download', entityType: 'StudentCertificate', entityId: certificateId, after: { companyId, userId: r.userId } })
    return { url: await this.docs.downloadUrl(cert.fileKey), expiresInSeconds: DOC_LINK_SECONDS }
  }

  async studentList(actor: RequestActor): Promise<StudentContactRequestDto[]> {
    const rows = await this.prisma.client.contactRequest.findMany({ where: { userId: actor.id }, orderBy: { createdAt: 'desc' }, take: 500, select: { id: true, source: true, status: true, createdAt: true, company: { select: COMPANY_CARD } } })
    return rows.map((r) => ({
      id: r.id, source: r.source, status: r.status, createdAt: r.createdAt.toISOString(),
      company: {
        id: r.company.id, name: r.company.name, about: r.company.about, website: r.company.website,
        region: r.company.region ? { id: r.company.region.id, name: r.company.region.name as L } : null,
        industries: r.company.industries.map((i) => i.industry).sort((a, b) => a.sortOrder - b.sortOrder).map(toIndustry),
      },
      contacts: r.status === 'ACCEPTED' ? companyContacts(r.company) : null,
    }))
  }

  /** The student decides; accepting is a consent to this company only (ТЗ 8 согласие 3), stored in the journal. */
  async decide(tenantId: string, actor: RequestActor, id: string, accept: boolean, ip?: string): Promise<StudentContactRequestDto[]> {
    const r = await this.prisma.client.contactRequest.findFirst({ where: { id, userId: actor.id }, select: { id: true, companyId: true, company: { select: { representative: { select: { id: true } } } } } })
    if (!r) throw AppError.notFound('Contact request')
    const now = new Date()
    // What the student opens is what they have now: the company keeps this copy, not later contacts (security review №15).
    const snapshot = accept ? await this.snapshotOf(actor.id) : {}
    await this.prisma.client.$transaction(async (tx) => {
      const moved = await tx.contactRequest.updateMany({ where: { id, status: 'PENDING' }, data: { status: accept ? 'ACCEPTED' : 'DECLINED', decidedAt: now, ...snapshot } })
      if (moved.count !== 1) throw AppError.conflict('contact_request_decided', 'This request is already decided')
      if (accept) await tx.studentConsent.create({ data: { tenantId, userId: actor.id, kind: 'COMPANY_CONTACTS', companyId: r.companyId, textVersion: 'contact-request', ip: ip ?? null, givenAt: now } })
    })
    await this.audit.record({ action: accept ? 'contact.accept' : 'contact.decline', entityType: 'ContactRequest', entityId: id, after: { companyId: r.companyId } })
    const repId = r.company.representative?.id
    if (repId) {
      const type = accept ? 'contact.accepted' : 'contact.declined'
      const name = (await this.prisma.client.user.findFirstOrThrow({ where: { id: actor.id }, select: { displayName: true } })).displayName
      await this.notifications.safely(type, () => this.notifications.notify({ tenantId, userIds: [repId], type, params: { studentName: accept ? name : '', requestId: id }, dedupeKey: `contact-decision:${id}` }))
    }
    return this.studentList(actor)
  }

  /**
   * «Отозвать доступ» (ТЗ 8): the student takes back the contacts opened to one company. The consent row gets its
   * revocation date, the request becomes WITHDRAWN (the company does not ask again); what the company already saw stays
   * with it — the student is warned about that on the screen.
   */
  async revoke(actor: RequestActor, id: string): Promise<StudentContactRequestDto[]> {
    const r = await this.prisma.client.contactRequest.findFirst({ where: { id, userId: actor.id }, select: { companyId: true } })
    if (!r) throw AppError.notFound('Contact request')
    const now = new Date()
    await this.prisma.client.$transaction(async (tx) => {
      // The copy of the contacts is personal data: it goes with the consent.
      const moved = await tx.contactRequest.updateMany({ where: { id, status: 'ACCEPTED' }, data: { status: 'WITHDRAWN', decidedAt: now, sharedName: null, sharedPhone: null, sharedEmail: null } })
      if (moved.count !== 1) throw AppError.conflict('contact_not_open', 'Only opened contacts can be taken back')
      // The consent is to the company, not to one request: its other accepted requests (another source) close with it.
      await tx.contactRequest.updateMany({ where: { userId: actor.id, companyId: r.companyId, status: 'ACCEPTED' }, data: { status: 'WITHDRAWN', decidedAt: now, sharedName: null, sharedPhone: null, sharedEmail: null } })
      await tx.studentConsent.updateMany({ where: { userId: actor.id, kind: 'COMPANY_CONTACTS', companyId: r.companyId, revokedAt: null }, data: { revokedAt: now } })
    })
    await this.audit.record({ action: 'contact.revoke', entityType: 'ContactRequest', entityId: id, after: { companyId: r.companyId } })
    return this.studentList(actor)
  }

  /** The student's consent to this company in force (checked at every read — a revocation works at once). */
  private activeConsent(userId: string, companyId: string) {
    return this.prisma.client.studentConsent.findFirst({ where: { userId, kind: 'COMPANY_CONTACTS', companyId, revokedAt: null }, orderBy: { givenAt: 'desc' }, select: { givenAt: true } })
  }

  /**
   * The full card: name, phone (contact phone, else the SMS sign-in number), e-mail, study, certificates — those the
   * student had by `certificatesUntil` (when they agreed), not the ones added later.
   */
  async fullCard(userId: string, certificatesUntil?: Date, shared?: SharedContacts): Promise<StudentFullCardDto> {
    const card = (await this.fullCards([userId], certificatesUntil ? new Map([[userId, certificatesUntil]]) : undefined, shared ? new Map([[userId, shared]]) : undefined)).get(userId)
    if (!card) throw AppError.notFound('Student')
    return card
  }

  /**
   * The contacts the student had when agreeing (accepting a request, applying), copied into the request or the
   * application; the full card shows this copy, not what the student changed later.
   */
  async snapshotOf(userId: string): Promise<SharedContacts> {
    const card = await this.fullCards([userId])
    const c = card.get(userId)
    return { sharedName: c?.name ?? null, sharedPhone: c?.phone ?? null, sharedEmail: c?.email ?? null }
  }

  /** Full cards of many students in two queries (a company opening its applications); `shared` — their copies of the contacts. */
  async fullCards(userIds: string[], certificatesUntil?: Map<string, Date>, shared?: Map<string, SharedContacts>): Promise<Map<string, StudentFullCardDto>> {
    if (!userIds.length) return new Map()
    // Only students who can still be reached: a disabled account is shown to no company.
    const users = await this.prisma.client.user.findMany({
      where: { id: { in: userIds }, isActive: true },
      select: {
        id: true, displayName: true, email: true, phoneE164: true, phoneVerifiedAt: true,
        studentProfile: { select: { contactPhone: true, graduationYear: true, about: true, institution: { select: { name: true } }, direction: { select: DIRECTION_WITH_MAIN } } },
      },
    })
    const certs = await this.prisma.client.studentCertificate.findMany({ where: { userId: { in: userIds } }, orderBy: { createdAt: 'desc' }, select: { userId: true, id: true, title: true, issuer: true, issuedAt: true, contentType: true, sizeBytes: true, createdAt: true } })
    const until = (userId: string) => certificatesUntil?.get(userId)?.getTime() ?? Infinity
    return new Map(users.map((u) => {
      const card = this.toFullCard(u, certs.filter((c) => c.userId === u.id && c.createdAt.getTime() <= until(u.id)))
      // A copy made when the student agreed wins (older rows have none — then the current contacts, as before).
      const s = shared?.get(u.id)
      return [u.id, s?.sharedName ? { ...card, name: s.sharedName, phone: s.sharedPhone, email: s.sharedEmail } : card]
    }))
  }

  private toFullCard(
    u: { displayName: string; email: string | null; phoneE164: string | null; phoneVerifiedAt: Date | null; studentProfile: { contactPhone: string | null; graduationYear: number | null; about: string | null; institution: { name: string } | null; direction: Parameters<typeof mainOf>[0] | null } | null },
    certs: { id: string; title: string; issuer: string | null; issuedAt: Date | null; contentType: string; sizeBytes: number; createdAt: Date }[],
  ): StudentFullCardDto {
    const p = u.studentProfile
    return {
      name: u.displayName,
      phone: p?.contactPhone ?? (u.phoneVerifiedAt ? u.phoneE164 : null),
      email: u.email,
      institution: p?.institution?.name ?? null,
      direction: p?.direction ? mainOf(p.direction) : null,
      graduationYear: p?.graduationYear ?? null,
      about: p?.about ?? null,
      certificates: certs.map((c) => ({ id: c.id, title: c.title, issuer: c.issuer, issuedAt: c.issuedAt ? dateColumnToIso(c.issuedAt) : null, contentType: c.contentType, sizeBytes: c.sizeBytes, createdAt: c.createdAt.toISOString() })),
    }
  }

  private async ownCompany(actor: RequestActor): Promise<string> {
    const user = await this.prisma.client.user.findFirst({ where: { id: actor.id }, select: { companyId: true } })
    if (!user?.companyId) throw AppError.notFound('Company')
    return user.companyId
  }
}
