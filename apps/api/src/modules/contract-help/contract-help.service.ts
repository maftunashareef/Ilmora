import { Injectable } from '@nestjs/common'
import { ageOn, type ContractHelpCardDto, type ContractHelpDto, type L, type MatchStatus, STUDENT_CONSENT_TEXT_VERSION } from '@ilmora/shared'
import { AppError } from '../../common/errors'
import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infra/prisma/prisma.service'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { ContactsService } from '../contacts/contacts.service'
import { NotificationsService } from '../notifications/notifications.service'
import { DIRECTION_WITH_MAIN, isUniqueViolation, mainOf, regionIdByRef } from '../registry/registry.mappers'
import { StudentsService } from '../students/students.service'
import type { ContractHelpInput, ContractHelpQuery } from './contract-help.schemas'

const OPEN = ['ACTIVE', 'INTERESTED'] as const
const place = (r: { id: string; name: unknown } | null) => (r ? { id: r.id, name: r.name as L } : null)
const active = (kind: 'CONTRACT_HELP_CARD' | 'PARENT_CONSENT') => ({ kind, revokedAt: null, companyId: null })

/** Everything the anonymised card is built from — and nothing else: no name, birth date as such, contacts or files. */
const CARD_SELECT = {
  id: true, status: true, motivation: true, yearsToWork: true, createdAt: true, userId: true,
  workRegion: { select: { id: true, name: true } },
  user: {
    select: {
      studentConsents: { where: active('PARENT_CONSENT'), select: { id: true } },
      studentCertificates: { select: { title: true }, orderBy: { createdAt: 'asc' } },
      enrollments: { where: { status: { in: ['ACTIVE', 'COMPLETED'] } }, select: { course: { select: { title: true } } } },
      studentProfile: {
        select: {
          mode: true, course: true, enrollYear: true, studyForm: true, contractAmountMinor: true, birthDate: true, studyConfirmation: true,
          region: { select: { id: true, name: true } },
          institution: { select: { id: true, name: true, type: true, region: { select: { id: true, name: true } } } },
          direction: { select: DIRECTION_WITH_MAIN },
        },
      },
    },
  },
} as const satisfies Prisma.ContractHelpRequestSelect
type CardRow = Prisma.ContractHelpRequestGetPayload<{ select: typeof CARD_SELECT }>

const OWN_SELECT = {
  id: true, status: true, motivation: true, yearsToWork: true, createdAt: true, signedAt: true, withdrawnAt: true,
  workRegion: { select: { id: true, name: true } },
  signedWithCompany: { select: { id: true, name: true } },
  contactRequests: { orderBy: { createdAt: 'asc' }, select: { id: true, status: true, createdAt: true, company: { select: { id: true, name: true } } } },
} as const satisfies Prisma.ContractHelpRequestSelect

/**
 * Help with the contract fee (ТЗ 5.3). The student — whose questionnaire names the institution, the direction, the
 * contract form and amount — asks for help with consent 2 («обезличенная карточка»). Approved companies of the
 * direction's industry are notified and see the card without anything that names the student; «Заинтересованы» is a
 * contact request (source CONTRACT_HELP). The agreement is made outside ILMORA; the student marks it with a company
 * they opened contacts to. One open request per student (`openKey`, unique). Withdrawn or without consent 2 — the card
 * is gone from the feed at once; a minor's card needs the parent's consent as well.
 */
@Injectable()
export class ContractHelpService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly contacts: ContactsService,
    private readonly students: StudentsService,
  ) {}

  // ───────────── student ─────────────

  /** The latest request (open, signed or withdrawn) or null. */
  async mine(actor: RequestActor): Promise<ContractHelpDto | null> {
    const row = await this.prisma.client.contractHelpRequest.findFirst({ where: { userId: actor.id }, orderBy: { createdAt: 'desc' }, select: { id: true } })
    return row ? this.ownDto(actor, row.id) : null
  }

  async create(tenantId: string, actor: RequestActor, input: ContractHelpInput, ip?: string): Promise<ContractHelpDto> {
    // A complete questionnaire includes, for a minor, the parent's details and consent (ТЗ 4.1 step 3, 8).
    const state = await this.students.questionnaire(actor)
    if (!state.complete) throw AppError.invalid('questionnaire_incomplete', 'Fill in the questionnaire first')
    const profile = await this.prisma.client.studentProfile.findFirstOrThrow({
      where: { userId: actor.id },
      select: { institutionId: true, regionId: true, studyForm: true, contractAmountMinor: true, direction: { select: DIRECTION_WITH_MAIN } },
    })
    // ТЗ 5.3 step 1: the institution, the direction, the contract form and its amount.
    const missing = [
      !profile.institutionId && 'institution', !profile.direction && 'direction',
      profile.studyForm !== 'CONTRACT' && 'studyForm', !(profile.contractAmountMinor && profile.contractAmountMinor > 0n) && 'contractSum',
    ].filter(Boolean) as string[]
    if (missing.length) throw AppError.invalid('contract_help_profile', 'The questionnaire needs the institution, direction, contract form and amount', { missing })
    const now = new Date()

    let id: string
    try {
      id = await this.prisma.client.$transaction(async (tx) => {
        // Consent 2 is the tick on this form: a new journal row unless one is in force.
        if (!(await tx.studentConsent.findFirst({ where: { userId: actor.id, ...active('CONTRACT_HELP_CARD') }, select: { id: true } }))) {
          await tx.studentConsent.create({ data: { tenantId, userId: actor.id, kind: 'CONTRACT_HELP_CARD', textVersion: STUDENT_CONSENT_TEXT_VERSION, ip: ip ?? null, givenAt: now } })
        }
        const row = await tx.contractHelpRequest.create({
          data: { tenantId, userId: actor.id, motivation: input.motivation, yearsToWork: input.yearsToWork, workRegionId: input.workRegion === 'OWN' ? profile.regionId : null, openKey: actor.id },
          select: { id: true },
        })
        return row.id
      })
    } catch (err) {
      if (isUniqueViolation(err)) throw AppError.conflict('contract_help_exists', 'You already have an open request')
      throw err
    }
    await this.audit.record({ action: 'contract-help.create', entityType: 'ContractHelpRequest', entityId: id, after: { yearsToWork: input.yearsToWork, workRegion: input.workRegion } })
    const main = mainOf(profile.direction!)
    await this.notifications.safely('contractHelp.new', async () => {
      const recipients = await this.prisma.client.user.findMany({ where: { isActive: true, company: { is: { approvedAt: { not: null }, blockedAt: null, industries: { some: { industryId: main.industry.id } } } } }, select: { id: true } })
      await this.notifications.notify({ tenantId, userIds: recipients.map((u) => u.id), type: 'contractHelp.new', params: { directionName: main.name, requestId: id }, dedupeKey: `contract-help:${id}` })
    })
    return this.ownDto(actor, id)
  }

  /** «Отозвать»: the card leaves the feed at once; contacts already opened stay with the companies (ТЗ 8). */
  async withdraw(actor: RequestActor): Promise<ContractHelpDto> {
    const open = await this.ownOpen(actor)
    await this.prisma.client.contractHelpRequest.update({ where: { id: open.id }, data: { status: 'WITHDRAWN', withdrawnAt: new Date(), openKey: null } })
    await this.audit.record({ action: 'contract-help.withdraw', entityType: 'ContractHelpRequest', entityId: open.id })
    return this.ownDto(actor, open.id)
  }

  /** «Договор заключён» (ТЗ 5.3 step 5): only with a company the student opened contacts to; for the ministry's numbers. */
  async signed(actor: RequestActor, companyId: string): Promise<ContractHelpDto> {
    const open = await this.ownOpen(actor)
    const ok = await this.prisma.client.contactRequest.findFirst({ where: { userId: actor.id, companyId, status: 'ACCEPTED' }, select: { id: true } })
    if (!ok) throw AppError.notFound('Company')
    await this.prisma.client.contractHelpRequest.update({ where: { id: open.id }, data: { status: 'SIGNED', signedWithCompanyId: companyId, signedAt: new Date(), openKey: null } })
    await this.audit.record({ action: 'contract-help.signed', entityType: 'ContractHelpRequest', entityId: open.id, after: { companyId } })
    return this.ownDto(actor, open.id)
  }

  // ───────────── company ─────────────

  /** The feed: open requests of the company's industries with consent 2 in force — anonymised cards. */
  async feed(actor: RequestActor, q: ContractHelpQuery): Promise<ContractHelpCardDto[]> {
    const company = await this.ownCompany(actor)
    if (!company.industries.length) return []
    const regionId = q.region ? await regionIdByRef(this.prisma, q.region) : null
    if (q.region && !regionId) return []
    const rows = await this.prisma.client.contractHelpRequest.findMany({
      where: this.visible(company.industries, regionId),
      orderBy: { createdAt: 'desc' }, take: 200, select: CARD_SELECT,
    })
    return this.cards(company.id, rows)
  }

  async card(actor: RequestActor, id: string): Promise<ContractHelpCardDto> {
    const company = await this.ownCompany(actor)
    return this.cardOf(company, id)
  }

  /** «Заинтересованы»: a contact request to the student behind the card; the request shows «есть интерес компаний». */
  async interest(tenantId: string, actor: RequestActor, id: string): Promise<ContractHelpCardDto> {
    const company = await this.ownCompany(actor)
    const row = await this.prisma.client.contractHelpRequest.findFirst({ where: { id, ...this.visible(company.industries) }, select: CARD_SELECT })
    if (!row || !this.shown(row)) throw AppError.notFound('Contract help request')
    await this.contacts.request(tenantId, company, row.userId, 'CONTRACT_HELP', { contractHelpId: id })
    await this.prisma.client.contractHelpRequest.updateMany({ where: { id, status: 'ACTIVE' }, data: { status: 'INTERESTED' } })
    return this.cardOf(company, id)
  }

  // ───────────── helpers ─────────────

  /** Open, consent 2 in force, the student's direction (or its main one) in the company's industries; optionally the student's region. */
  private visible(industries: string[], regionId?: string | null): Prisma.ContractHelpRequestWhereInput {
    const direction: Prisma.DirectionWhereInput = { OR: [{ mergedIntoId: null, industryId: { in: industries } }, { mergedInto: { industryId: { in: industries } } }] }
    return {
      status: { in: [...OPEN] },
      // A disabled or deleted account leaves the feed (a relation filter skips the soft-delete scope).
      user: { isActive: true, deletedAt: null, studentConsents: { some: active('CONTRACT_HELP_CARD') }, studentProfile: { is: { direction, ...(regionId ? { regionId } : {}) } } },
    }
  }

  /** A minor's card needs the parent's consent too (ТЗ 8). */
  private shown(r: CardRow) {
    return !this.isMinor(r.user.studentProfile?.birthDate ?? null, new Date()) || r.user.studentConsents.length > 0
  }

  private isMinor(birthDate: Date | null, now: Date) {
    const age = birthDate ? ageOn(birthDate.toISOString().slice(0, 10), now) : null
    return age !== null && age < 18
  }

  private async cardOf(company: { id: string; industries: string[] }, id: string): Promise<ContractHelpCardDto> {
    const row = await this.prisma.client.contractHelpRequest.findFirst({ where: { id, ...this.visible(company.industries) }, select: CARD_SELECT })
    const [card] = row ? await this.cards(company.id, [row]) : []
    if (!card) throw AppError.notFound('Contract help request')
    return card
  }

  private async cards(companyId: string, rows: CardRow[]): Promise<ContractHelpCardDto[]> {
    const shown = rows.filter((r) => this.shown(r))
    const requests = new Map((await this.prisma.client.contactRequest.findMany({ where: { companyId, userId: { in: shown.map((r) => r.userId) } }, select: { userId: true, status: true } })).map((c) => [c.userId, c.status as MatchStatus]))
    const now = new Date()
    return shown.map((r) => {
      const p = r.user.studentProfile!
      const inst = p.institution
      return {
        id: r.id, number: r.id.slice(-6).toUpperCase(), status: r.status as ContractHelpCardDto['status'],
        age: p.birthDate ? ageOn(p.birthDate.toISOString().slice(0, 10), now) : null,
        region: place(p.region),
        institution: inst ? { id: inst.id, name: inst.name, type: inst.type, region: place(inst.region) } : null,
        direction: p.direction ? mainOf(p.direction) : null,
        mode: p.mode, course: p.course, enrollYear: p.enrollYear, studyForm: p.studyForm,
        contractAmount: p.contractAmountMinor !== null ? Number(p.contractAmountMinor / 100n) : null,
        motivation: r.motivation, yearsToWork: r.yearsToWork, workRegion: place(r.workRegion),
        certificates: r.user.studentCertificates.map((c) => c.title),
        ilmoraCourses: [...new Map(r.user.enrollments.map((e) => [JSON.stringify(e.course.title), e.course.title as L])).values()],
        studyConfirmed: p.studyConfirmation === 'CONFIRMED',
        createdAt: r.createdAt.toISOString(),
        contactRequest: requests.get(r.userId) ?? null,
      }
    })
  }

  private async ownDto(actor: RequestActor, id: string): Promise<ContractHelpDto> {
    const r = await this.prisma.client.contractHelpRequest.findFirstOrThrow({ where: { id, userId: actor.id }, select: OWN_SELECT })
    const accepted = await this.prisma.client.contactRequest.findMany({ where: { userId: actor.id, status: 'ACCEPTED' }, orderBy: { decidedAt: 'desc' }, select: { company: { select: { id: true, name: true } } } })
    return {
      id: r.id, status: r.status, motivation: r.motivation, yearsToWork: r.yearsToWork, workRegion: place(r.workRegion),
      createdAt: r.createdAt.toISOString(), signedAt: r.signedAt?.toISOString() ?? null, withdrawnAt: r.withdrawnAt?.toISOString() ?? null,
      signedWith: r.signedWithCompany,
      interests: r.contactRequests.map((c) => ({ requestId: c.id, company: c.company, status: c.status, createdAt: c.createdAt.toISOString() })),
      signableCompanies: accepted.map((a) => a.company),
    }
  }

  private async ownOpen(actor: RequestActor) {
    const open = await this.prisma.client.contractHelpRequest.findFirst({ where: { userId: actor.id, status: { in: [...OPEN] } }, select: { id: true } })
    if (!open) throw AppError.notFound('Contract help request')
    return open
  }

  private async ownCompany(actor: RequestActor) {
    const user = await this.prisma.client.user.findFirst({ where: { id: actor.id }, select: { company: { select: { id: true, name: true, industries: { select: { industryId: true } } } } } })
    if (!user?.company) throw AppError.notFound('Company')
    return { id: user.company.id, name: user.company.name, industries: user.company.industries.map((i) => i.industryId) }
  }
}
