import { Inject, Injectable } from '@nestjs/common'
import { type CompanyStudentCardDto, type CompanyStudentsPageDto, type L, type MatchStatus, STUDENT_CARDS_PER_DAY, STUDENTS_PAGE_SIZE, type StudentsBlockDto } from '@ilmora/shared'
import { companyCardId } from '../../common/card-id'
import { AppError } from '../../common/errors'
import { isoToDateColumn, todayLocal } from '../../common/time'
import { ENV, type Env } from '../../config/env'
import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infra/prisma/prisma.service'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { ContactsService, NAMED_CONTACT_SOURCES } from '../contacts/contacts.service'
import { DIRECTION_WITH_MAIN, mainOf, regionIdByRef } from '../registry/registry.mappers'
import { lockConsents } from '../students/students.service'
import type { CompanyStudentsQuery } from './graduates.schemas'

const place = (r: { id: string; name: unknown } | null) => (r ? { id: r.id, name: r.name as L } : null)
/** The place a «Студенты» card is shown, for its id (the announcements use their own id). */
const SCOPE = 'students'
const DAY_MS = 86_400_000

/**
 * The company's «Студенты» section (ТЗ «Студенты у компании, Вакансии у учреждения», 2). A student is listed only if
 * all hold (2.1): studies («уже учусь»), the institution confirmed it, the institution is approved, not blocked and
 * not merged into another (the confirmations are kept: unblocked, its students show again by themselves), the consent
 * «show my card to companies of my industry» (INDUSTRY_CARD) is in force, 18 or older or with the parent's consent in
 * force (checked on every read, as on the graduate cards), an account neither disabled nor deleted, and the industry of
 * the student's direction (its main one for an alias) is one of the company's. A revoked consent hides the card at
 * once. The cards carry no contacts; «Запросить контакты» is a contact request by name (STUDENTS), shared with the
 * announcements' «Пригласить».
 *
 * Every card shown is in the audit log (`student.card.view`), and a company is shown at most STUDENT_CARDS_PER_DAY
 * cards in 24 hours, counted in the database (CompanyStudentCardView) — see `account`.
 */
@Injectable()
export class CompanyStudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly contacts: ContactsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Institutions with the number of matching students (2.2): the company's region first, then by the number. */
  async blocks(actor: RequestActor, q: CompanyStudentsQuery): Promise<StudentsBlockDto[]> {
    const company = await this.ownCompany(actor)
    const where = await this.listed(company.industries, q)
    if (!where) return []
    const groups = await this.prisma.client.studentProfile.groupBy({ by: ['institutionId'], where, _count: { _all: true } })
    const ids = groups.map((g) => g.institutionId).filter((id): id is string => !!id)
    const institutions = new Map((await this.prisma.client.institution.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, type: true, regionId: true, region: { select: { id: true, name: true } } } })).map((i) => [i.id, i]))
    return groups
      .filter((g) => g.institutionId && institutions.has(g.institutionId))
      .map((g) => ({ i: institutions.get(g.institutionId!)!, n: g._count._all }))
      .sort((a, b) => Number(b.i.regionId === company.regionId) - Number(a.i.regionId === company.regionId) || b.n - a.n || a.i.name.localeCompare(b.i.name))
      .map(({ i, n }) => ({ institution: { id: i.id, name: i.name, type: i.type, region: place(i.region) }, students: n }))
  }

  /**
   * One institution's matching students, a page at a time (2.2). Every card shown is counted in the company's daily
   * limit and written to the audit log before the answer leaves: a page that does not fit in the limit, or whose
   * audit rows could not be written, is not given at all. An empty page costs nothing and leaves no rows.
   */
  async page(actor: RequestActor, institutionId: string, q: CompanyStudentsQuery, page: number): Promise<CompanyStudentsPageDto> {
    const company = await this.ownCompany(actor)
    const where = await this.listed(company.industries, q)
    if (!where) return { items: [], total: 0, page, pageSize: STUDENTS_PAGE_SIZE }
    const mine: Prisma.StudentProfileWhereInput = { AND: [where, { institutionId }] }
    const [total, rows] = await Promise.all([
      this.prisma.client.studentProfile.count({ where: mine }),
      this.prisma.client.studentProfile.findMany({ where: mine, orderBy: [{ user: { displayName: 'asc' } }, { userId: 'asc' }], skip: (page - 1) * STUDENTS_PAGE_SIZE, take: STUDENTS_PAGE_SIZE, select: CARD_SELECT }),
    ])
    const items = await this.cards(company.id, rows)
    await this.account(company.id, institutionId, page, rows.map((r) => r.userId))
    return { items, total, page, pageSize: STUDENTS_PAGE_SIZE }
  }

  /**
   * «Запросить контакты» (2.4): the card is found among the institution's matching students by its id — the company
   * never names an account. One request by name per company and student (shared with «Пригласить»), counted in the
   * company's daily limit; the student is notified.
   */
  async request(tenantId: string, actor: RequestActor, institutionId: string, cardId: string): Promise<CompanyStudentCardDto> {
    const company = await this.ownCompany(actor)
    const where = await this.listed(company.industries, {})
    const ids = where ? await this.prisma.client.studentProfile.findMany({ where: { AND: [where, { institutionId }] }, select: { userId: true } }) : []
    const userId = ids.find((r) => companyCardId(this.env, company.id, SCOPE, r.userId) === cardId)?.userId
    if (!userId) throw AppError.notFound('Student')
    // Looked at again in the request's transaction, under the lock the student's consents are written with: a consent
    // taken back after the look above gives no request (it used to slip between the two).
    await this.contacts.request(tenantId, company, userId, 'STUDENTS', {}, async (tx) => {
      await lockConsents(tx, userId)
      if (!(await tx.studentProfile.count({ where: { AND: [where!, { institutionId, userId }] } }))) throw AppError.notFound('Student')
    })
    const [card] = await this.cards(company.id, [await this.prisma.client.studentProfile.findUniqueOrThrow({ where: { userId }, select: CARD_SELECT })])
    return card
  }

  // ───────────── helpers ─────────────

  /**
   * Counts the cards of a page about to be shown and writes one audit row per card, in one transaction under a lock per
   * company — pages asked for at once (from any of the company's accounts or servers) are counted one at a time and
   * cannot all see «under the limit». The count is the sum of `cards` over the company's CompanyStudentCardView rows of
   * the last 24 hours: by company, so a new representative does not reset it; a card shown again counts again. A page
   * that does not fit whole is refused (429 `rate_limited`) with the time until the oldest counted page leaves the
   * window. Nothing is written when it is refused or when an audit row fails.
   */
  private async account(companyId: string, institutionId: string, page: number, userIds: string[]): Promise<void> {
    if (!userIds.length) return
    await this.prisma.tx(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `student-cards:${companyId}`)
      // The clock is read after the lock is taken: a request that waited for it counts what the ones before it wrote.
      const now = Date.now()
      const shown = await tx.companyStudentCardView.aggregate({ where: { companyId, createdAt: { gt: new Date(now - DAY_MS) } }, _sum: { cards: true }, _min: { createdAt: true } })
      if ((shown._sum.cards ?? 0) + userIds.length > STUDENT_CARDS_PER_DAY) {
        const oldest = shown._min.createdAt?.getTime() ?? now
        throw AppError.tooMany(`At most ${STUDENT_CARDS_PER_DAY} student cards a day`, Math.max(1, Math.ceil((oldest + DAY_MS - now) / 1000)))
      }
      await tx.companyStudentCardView.create({ data: { companyId, cards: userIds.length, createdAt: new Date(now) } })
      // One row per card, in this transaction (AuditService.recordMany writes outside it): at most STUDENTS_PAGE_SIZE rows.
      for (const userId of userIds) await this.audit.record({ tx, action: 'student.card.view', entityType: 'User', entityId: userId, after: { companyId, institutionId, page } })
    })
  }

  /** The conditions of 2.1 and the filters of 2.2; null when a filter names nothing (no such region or direction). */
  private async listed(industries: string[], q: CompanyStudentsQuery): Promise<Prisma.StudentProfileWhereInput | null> {
    if (!industries.length) return null
    // 18 or older on the Tashkent calendar: born on or before this day 18 years ago (a 29 February birthday counts from 28 February).
    const t = todayLocal()
    const y = Number(t.slice(0, 4)) - 18
    const md = t.slice(5) === '02-29' && !(y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0)) ? '02-28' : t.slice(5)
    const adultBorn = isoToDateColumn(`${y}-${md}`)
    const and: Prisma.StudentProfileWhereInput[] = [
      { mode: 'STUDYING', studyConfirmation: 'CONFIRMED', institutionId: { not: null } },
      // The institution itself is in the registry: approved, not blocked, not merged into another (as on the announcements).
      { institution: { is: { approvedAt: { not: null }, blockedAt: null, mergedIntoId: null } } },
      { direction: { OR: [{ mergedIntoId: null, industryId: { in: industries } }, { mergedInto: { industryId: { in: industries } } }] } },
      { user: { isActive: true, deletedAt: null, studentConsents: { some: { kind: 'INDUSTRY_CARD', revokedAt: null, companyId: null } } } },
      // A minor's card needs the parent's consent in force (ТЗ 8; 2.1 п. 4); an unknown birth date is treated as an adult's, as on the other cards.
      { OR: [{ birthDate: null }, { birthDate: { lte: adultBorn } }, { user: { studentConsents: { some: { kind: 'PARENT_CONSENT', revokedAt: null, companyId: null } } } }] },
    ]
    if (q.direction) {
      const d = await this.prisma.client.direction.findFirst({ where: { id: q.direction }, select: { id: true, mergedIntoId: true } })
      if (!d) return null
      const main = d.mergedIntoId ?? d.id
      and.push({ OR: [{ directionId: main }, { direction: { mergedIntoId: main } }] })
    }
    if (q.type) and.push({ institution: { is: { type: q.type } } })
    if (q.region) {
      const regionId = await regionIdByRef(this.prisma, q.region)
      if (!regionId) return null
      and.push({ institution: { is: { regionId } } })
    }
    if (q.course) and.push({ course: q.course })
    if (q.graduationYear) and.push({ graduationYear: q.graduationYear })
    return { AND: and }
  }

  private async cards(companyId: string, rows: CardRow[]): Promise<CompanyStudentCardDto[]> {
    const requests = new Map((await this.prisma.client.contactRequest.findMany({ where: { companyId, source: { in: [...NAMED_CONTACT_SOURCES] }, userId: { in: rows.map((r) => r.userId) } }, select: { userId: true, status: true } })).map((c) => [c.userId, c.status as MatchStatus]))
    return rows.map((r) => ({
      cardId: companyCardId(this.env, companyId, SCOPE, r.userId),
      name: r.user.displayName,
      institution: { id: r.institution!.id, name: r.institution!.name, type: r.institution!.type },
      direction: r.direction ? mainOf(r.direction) : null,
      course: r.course, graduationYear: r.graduationYear, region: place(r.region), about: r.about,
      certificates: r.user.studentCertificates.map((c) => c.title),
      ilmoraCourses: [...new Map(r.user.enrollments.map((e) => [JSON.stringify(e.course.title), e.course.title as L])).values()],
      studyConfirmed: true as const,
      contactRequest: requests.get(r.userId) ?? null,
    }))
  }

  private async ownCompany(actor: RequestActor) {
    const user = await this.prisma.client.user.findFirst({ where: { id: actor.id }, select: { company: { select: { id: true, name: true, regionId: true, industries: { select: { industryId: true } } } } } })
    if (!user?.company) throw AppError.notFound('Company')
    return { id: user.company.id, name: user.company.name, regionId: user.company.regionId, industries: user.company.industries.map((i) => i.industryId) }
  }
}

/** What a card shows (2.3) — no phone, e-mail, birth date, files, parent's data or anything of a contract-help request. */
const CARD_SELECT = {
  userId: true, course: true, graduationYear: true, about: true,
  region: { select: { id: true, name: true } },
  institution: { select: { id: true, name: true, type: true } },
  direction: { select: DIRECTION_WITH_MAIN },
  user: {
    select: {
      displayName: true,
      studentCertificates: { select: { title: true }, orderBy: { createdAt: 'asc' } },
      enrollments: { where: { status: { in: ['ACTIVE', 'COMPLETED'] } }, select: { course: { select: { title: true } } } },
    },
  },
} as const satisfies Prisma.StudentProfileSelect
type CardRow = Prisma.StudentProfileGetPayload<{ select: typeof CARD_SELECT }>
