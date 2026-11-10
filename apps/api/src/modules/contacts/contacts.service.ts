import { Injectable } from '@nestjs/common'
import type { CompanyContactDto, ContactSource, DocumentLinkDto, L, StudentContactRequestDto, StudentFullCardDto } from '@ilmora/shared'
import { AppError } from '../../common/errors'
import { PrismaService } from '../../infra/prisma/prisma.service'
import { DOC_LINK_SECONDS, PrivateDocsService } from '../../infra/storage/private-docs.service'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { NotificationsService } from '../notifications/notifications.service'
import { DIRECTION_WITH_MAIN, INDUSTRY_SELECT, isUniqueViolation, mainOf, toIndustry } from '../registry/registry.mappers'

const iso = (d: Date | null) => d?.toISOString() ?? null
const COMPANY_CARD = {
  id: true, name: true, about: true, website: true, region: { select: { id: true, name: true } },
  industries: { select: { industry: { select: { ...INDUSTRY_SELECT, sortOrder: true } } } },
} as const

/**
 * Contact requests (ТЗ 5.1 «Пригласить», 5.3 «Заинтересованы», 8): a company asks a student to open their contacts;
 * the student decides each request. One request per company and student, whatever the source (unique index) — a
 * declined request is not sent again. Accepting writes a COMPANY_CONTACTS consent row; only then the company sees the
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

  /** The company's requests; the full card is opened one by one (`full`), so every view is in the audit log. */
  async companyList(actor: RequestActor): Promise<CompanyContactDto[]> {
    const companyId = await this.ownCompany(actor)
    const rows = await this.prisma.client.contactRequest.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' }, take: 500, select: { id: true, source: true, status: true, createdAt: true, decidedAt: true, user: { select: { id: true, displayName: true } } } })
    return rows.map((r) => ({ id: r.id, source: r.source, status: r.status, createdAt: r.createdAt.toISOString(), decidedAt: iso(r.decidedAt), student: { id: r.user.id, name: r.user.displayName, full: null } }))
  }

  /** One accepted request with the full card. */
  async companyContact(actor: RequestActor, id: string): Promise<CompanyContactDto> {
    const companyId = await this.ownCompany(actor)
    const r = await this.prisma.client.contactRequest.findFirst({ where: { id, companyId }, select: { id: true, source: true, status: true, createdAt: true, decidedAt: true, userId: true, user: { select: { displayName: true } } } })
    if (!r) throw AppError.notFound('Contact request')
    const full = r.status === 'ACCEPTED' ? await this.fullCard(r.userId) : null
    if (full) await this.audit.record({ action: 'contact.view', entityType: 'User', entityId: r.userId, after: { companyId, requestId: id } })
    return { id: r.id, source: r.source, status: r.status, createdAt: r.createdAt.toISOString(), decidedAt: iso(r.decidedAt), student: { id: r.userId, name: r.user.displayName, full } }
  }

  /** A certificate file of a student who accepted — a 5-minute link, audited (ТЗ 8 «скачал файл»). */
  async certificateLink(actor: RequestActor, requestId: string, certificateId: string): Promise<DocumentLinkDto> {
    const companyId = await this.ownCompany(actor)
    const r = await this.prisma.client.contactRequest.findFirst({ where: { id: requestId, companyId, status: 'ACCEPTED' }, select: { userId: true } })
    const cert = r ? await this.prisma.client.studentCertificate.findFirst({ where: { id: certificateId, userId: r.userId }, select: { fileKey: true } }) : null
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
    }))
  }

  /** The student decides; accepting is a consent to this company only (ТЗ 8 согласие 3), stored in the journal. */
  async decide(tenantId: string, actor: RequestActor, id: string, accept: boolean, ip?: string): Promise<StudentContactRequestDto[]> {
    const r = await this.prisma.client.contactRequest.findFirst({ where: { id, userId: actor.id }, select: { id: true, companyId: true, company: { select: { representative: { select: { id: true } } } } } })
    if (!r) throw AppError.notFound('Contact request')
    const now = new Date()
    await this.prisma.client.$transaction(async (tx) => {
      const moved = await tx.contactRequest.updateMany({ where: { id, status: 'PENDING' }, data: { status: accept ? 'ACCEPTED' : 'DECLINED', decidedAt: now } })
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

  /** The full card: name, phone (contact phone, else the SMS sign-in number), e-mail, study, certificates. */
  async fullCard(userId: string): Promise<StudentFullCardDto> {
    const u = await this.prisma.client.user.findFirstOrThrow({
      where: { id: userId },
      select: {
        displayName: true, email: true, phoneE164: true, phoneVerifiedAt: true,
        studentProfile: { select: { contactPhone: true, graduationYear: true, about: true, institution: { select: { name: true } }, direction: { select: DIRECTION_WITH_MAIN } } },
      },
    })
    const certs = await this.prisma.client.studentCertificate.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, select: { id: true, title: true, issuer: true, issuedAt: true, contentType: true, sizeBytes: true, createdAt: true } })
    const p = u.studentProfile
    return {
      name: u.displayName,
      phone: p?.contactPhone ?? (u.phoneVerifiedAt ? u.phoneE164 : null),
      email: u.email,
      institution: p?.institution?.name ?? null,
      direction: p?.direction ? mainOf(p.direction) : null,
      graduationYear: p?.graduationYear ?? null,
      about: p?.about ?? null,
      certificates: certs.map((c) => ({ id: c.id, title: c.title, issuer: c.issuer, issuedAt: c.issuedAt?.toISOString().slice(0, 10) ?? null, contentType: c.contentType, sizeBytes: c.sizeBytes, createdAt: c.createdAt.toISOString() })),
    }
  }

  private async ownCompany(actor: RequestActor): Promise<string> {
    const user = await this.prisma.client.user.findFirst({ where: { id: actor.id }, select: { companyId: true } })
    if (!user?.companyId) throw AppError.notFound('Company')
    return user.companyId
  }
}
