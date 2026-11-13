import { HttpStatus, Injectable } from '@nestjs/common'
import { type InstitutionVacanciesDto, type InstitutionVacancyDto, VACANCY_BROADCASTS_PER_DAY, type VacancyBroadcastDto, type VacancyBroadcastPreviewDto } from '@ilmora/shared'
import { AppError } from '../../common/errors'
import type { Prisma } from '../../generated/prisma/client'
import { PrismaService, type TransactionClient } from '../../infra/prisma/prisma.service'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { OutboxService } from '../payments/outbox.service'
import { NotificationsService } from '../notifications/notifications.service'
import { DIRECTION_WITH_MAIN, mainOf, regionIdByRef } from '../registry/registry.mappers'
import type { BroadcastInput, InstitutionVacanciesQuery } from './vacancies.schemas'
import { toVacancy, VACANCY_SELECT, visibleVacancy } from './vacancies.service'

/** Students sent to in one go by the queue: one transaction per batch — its recipients and their notifications together. */
export const BROADCAST_BATCH = 500
const DAY_MS = 86_400_000

/**
 * Who a broadcast reaches (ТЗ «Студенты у компании, Вакансии у учреждения», 3.2): the institution's own students who
 * study there and whose study it confirmed, on the chosen directions (an alias counts as its main direction) and years,
 * with an account neither disabled nor deleted, who have not got this vacancy yet. No year chosen (an empty list) —
 * every year: all such students of the directions, those with no year in the questionnaire (`course` null) too; with
 * years chosen a student without one is left out. No consent is needed: the institution writes to its own students,
 * nothing leaves (3.2, п. 3).
 */
export const broadcastAudience = (institutionId: string, vacancyId: string, directionIds: string[], courses: number[]): Prisma.StudentProfileWhereInput => ({
  institutionId,
  mode: 'STUDYING',
  studyConfirmation: 'CONFIRMED',
  ...(courses.length ? { course: { in: courses } } : {}),
  OR: [{ directionId: { in: directionIds } }, { direction: { mergedIntoId: { in: directionIds } } }],
  user: { isActive: true, deletedAt: null, vacancyBroadcasts: { none: { vacancyId } } },
})

/**
 * Whether a broadcast may still be delivered: the vacancy is one students see (`visibleVacancy`: open, its company
 * approved and not blocked, the deadline not passed) and the sending institution is still approved, not blocked and not
 * merged into another — what the cabinet's own guard asks of it.
 */
async function stillDeliverable(prisma: PrismaService, b: { vacancyId: string; institutionId: string }): Promise<boolean> {
  const [vacancy, institution] = await Promise.all([
    prisma.client.vacancy.findFirst({ where: { id: b.vacancyId, AND: [visibleVacancy()] }, select: { id: true } }),
    prisma.client.institution.findFirst({ where: { id: b.institutionId, approvedAt: { not: null }, blockedAt: null, mergedIntoId: null }, select: { id: true } }),
  ])
  return !!vacancy && !!institution
}

/**
 * Delivers a broadcast (the outbox event `vacancy.broadcast`): the audience in batches, a recipient row each — unique per
 * vacancy and student, so a retried batch or a second broadcast adds nobody twice — and an in-app notification to the
 * students the batch added. A batch's recipient rows and its notifications are written in one transaction: a failure
 * between the two leaves neither, and the retried event finds those students still in the audience (a recipient row
 * without a notification would drop them from it for good). The audience is read anew at delivery, so a student who
 * stopped being the institution's confirmed student after «Разослать» gets nothing. Before every batch the vacancy and
 * the institution are checked again (`stillDeliverable`); once either fails nobody else is sent to and the broadcast is
 * closed. `finishedAt` marks the end.
 */
export async function deliverBroadcast(prisma: PrismaService, notifications: NotificationsService, broadcastId: string): Promise<{ sent: number }> {
  const b = await prisma.client.vacancyBroadcast.findFirst({
    where: { id: broadcastId },
    select: {
      id: true, tenantId: true, vacancyId: true, institutionId: true, courses: true, finishedAt: true,
      directions: { select: { directionId: true } },
      institution: { select: { name: true } },
      vacancy: { select: { title: true, company: { select: { name: true } } } },
    },
  })
  if (!b || b.finishedAt) return { sent: 0 }
  let sent = 0
  const where = broadcastAudience(b.institutionId, b.vacancyId, b.directions.map((d) => d.directionId), b.courses)
  while (await stillDeliverable(prisma, b)) {
    const batch = await prisma.client.studentProfile.findMany({ where, orderBy: { userId: 'asc' }, take: BROADCAST_BATCH, select: { userId: true } })
    if (!batch.length) break
    // Both inserts or neither. The unique recipient pair and the notification's own key (vacancy and student) keep a
    // retried event from telling anyone twice.
    sent += await prisma.tx(async (tx) => {
      const added = await tx.vacancyBroadcastRecipient.createManyAndReturn({
        data: batch.map((s) => ({ tenantId: b.tenantId, broadcastId: b.id, vacancyId: b.vacancyId, userId: s.userId })),
        skipDuplicates: true,
        select: { userId: true },
      })
      if (added.length) {
        await notifications.notify({
          tenantId: b.tenantId, userIds: added.map((r) => r.userId), type: 'vacancy.broadcast',
          params: { vacancyTitle: b.vacancy.title, companyName: b.vacancy.company.name, institutionName: b.institution.name, vacancyId: b.vacancyId },
          dedupeKey: `vacancy-broadcast:${b.vacancyId}`,
        }, tx)
      }
      return added.length
    }, { timeoutMs: 30_000 })
    // Rows already there (another broadcast got them meanwhile) leave the audience by the `none` filter above.
    if (batch.length < BROADCAST_BATCH) break
  }
  await prisma.client.vacancyBroadcast.updateMany({ where: { id: b.id, finishedAt: null }, data: { finishedAt: new Date() } })
  return { sent }
}

/**
 * «Вакансии компаний» in the institution's workspace and «Разослать студентам» (ТЗ «Студенты у компании, Вакансии у
 * учреждения», 3). The vacancies are those students see (open, approved company, deadline not passed) in the
 * industries of the institution's own directions; the institution's region first. A broadcast goes only to its own
 * confirmed students on its own directions that share an industry with the vacancy, once per student, at most
 * VACANCY_BROADCASTS_PER_DAY a day, through the queue; every broadcast is journaled and audited (the audit row in the
 * transaction that creates it). The journal shows the number the sender confirmed and the number actually delivered.
 */
@Injectable()
export class InstitutionVacanciesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
  ) {}

  async list(actor: RequestActor, q: InstitutionVacanciesQuery): Promise<InstitutionVacanciesDto> {
    const inst = await this.ownInstitution(actor)
    const industries = await this.industries(inst.id)
    if (!industries.length) return { hasDirections: false, items: [] }
    const and: Prisma.VacancyWhereInput[] = [visibleVacancy(), { directions: { some: { direction: { industryId: { in: industries } } } } }]
    if (q.kind) and.push({ kind: q.kind })
    if (q.format) and.push({ format: q.format })
    if (q.paid !== undefined) and.push({ paid: q.paid === 'true' })
    if (q.schedule) and.push({ schedule: q.schedule })
    if (q.experience) and.push({ experience: q.experience })
    if (q.direction) {
      const d = await this.prisma.client.direction.findFirst({ where: { id: q.direction }, select: { id: true, mergedIntoId: true } })
      if (!d) return { hasDirections: true, items: [] }
      and.push({ directions: { some: { directionId: d.mergedIntoId ?? d.id } } })
    }
    if (q.region) {
      const regionId = await regionIdByRef(this.prisma, q.region)
      if (!regionId) return { hasDirections: true, items: [] }
      and.push({ regionId })
    }
    const rows = await this.prisma.client.vacancy.findMany({ where: { AND: and }, orderBy: { createdAt: 'desc' }, take: 200, select: { ...VACANCY_SELECT, regionId: true } })
    // The institution's own region first (3.1), newest first within each part.
    rows.sort((a, b) => Number(b.regionId === inst.regionId) - Number(a.regionId === inst.regionId))
    return { hasDirections: true, items: await this.withSent(inst.id, rows) }
  }

  async get(actor: RequestActor, id: string): Promise<InstitutionVacancyDto> {
    const inst = await this.ownInstitution(actor)
    const row = await this.visibleTo(inst.id, id)
    const [dto] = await this.withSent(inst.id, [row])
    return dto
  }

  /** «Сколько студентов получат» (3.2, п. 2): the same checks and audience as sending, nothing written. */
  async preview(actor: RequestActor, id: string, input: BroadcastInput): Promise<VacancyBroadcastPreviewDto> {
    const inst = await this.ownInstitution(actor)
    await this.visibleTo(inst.id, id)
    const directionIds = await this.chosenDirections(inst.id, id, input.directionIds)
    const [recipients, all, today] = await Promise.all([
      this.prisma.client.studentProfile.count({ where: broadcastAudience(inst.id, id, directionIds, input.courses) }),
      this.prisma.client.studentProfile.count({ where: { ...broadcastAudience(inst.id, id, directionIds, input.courses), user: { isActive: true, deletedAt: null } } }),
      this.sentToday(this.prisma.client, inst.id),
    ])
    return { recipients, alreadySent: all - recipients, leftToday: Math.max(0, VACANCY_BROADCASTS_PER_DAY - today) }
  }

  /**
   * «Разослать студентам»: the journal row with the number the sender saw, the audit row (the number of recipients, never
   * who they are) and the outbox event the queue delivers in batches — one transaction, so none exists without the
   * others. Counted and written under a lock per institution, so broadcasts sent at once cannot all pass the daily
   * limit; a refusal says when the next one may go (when the broadcast holding the last place leaves the 24 hours).
   */
  async send(tenantId: string, actor: RequestActor, id: string, input: BroadcastInput): Promise<VacancyBroadcastDto> {
    const inst = await this.ownInstitution(actor)
    await this.visibleTo(inst.id, id)
    const directionIds = await this.chosenDirections(inst.id, id, input.directionIds)
    const created = await this.prisma.client.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `vacancy-broadcasts:${inst.id}`)
      // The VACANCY_BROADCASTS_PER_DAY-th newest broadcast of the last 24 hours, if there is one, holds the last place:
      // the limit is reached, and a place frees when that one turns 24 hours old (with exactly the limit — the oldest).
      const holder = await tx.vacancyBroadcast.findFirst({ where: { institutionId: inst.id, createdAt: { gte: new Date(Date.now() - DAY_MS) } }, orderBy: { createdAt: 'desc' }, skip: VACANCY_BROADCASTS_PER_DAY - 1, select: { createdAt: true } })
      if (holder) {
        const retryAfterSeconds = Math.max(1, Math.ceil((holder.createdAt.getTime() + DAY_MS - Date.now()) / 1000))
        throw new AppError('rate_limited', `At most ${VACANCY_BROADCASTS_PER_DAY} broadcasts a day`, HttpStatus.TOO_MANY_REQUESTS, { retryAfterSeconds })
      }
      const recipients = await tx.studentProfile.count({ where: broadcastAudience(inst.id, id, directionIds, input.courses) })
      if (!recipients) throw AppError.conflict('no_recipients', 'None of your students on these directions and years is left to send it to')
      const row = await tx.vacancyBroadcast.create({
        data: { tenantId, vacancyId: id, institutionId: inst.id, courses: input.courses, createdById: actor.id, recipientsCount: recipients, directions: { create: directionIds.map((directionId) => ({ directionId })) } },
        select: { id: true },
      })
      await this.audit.record({ action: 'vacancy.broadcast', entityType: 'VacancyBroadcast', entityId: row.id, after: { vacancyId: id, institutionId: inst.id, directionIds, courses: input.courses, recipients }, tx })
      await this.outbox.enqueue(tx, { tenantId, type: 'vacancy.broadcast', payload: { broadcastId: row.id }, dedupeKey: `vacancy-broadcast:${row.id}` })
      return { id: row.id }
    })
    return this.broadcastOf(inst.id, created.id)
  }

  /**
   * The institution's journal of broadcasts (3.2, п. 6): who sent which vacancy when and to how many — the number at
   * sending and the number delivered — newest first; all of them, or one vacancy's. Only its own.
   */
  async broadcasts(actor: RequestActor, vacancyId?: string): Promise<VacancyBroadcastDto[]> {
    const inst = await this.ownInstitution(actor)
    const rows = await this.prisma.client.vacancyBroadcast.findMany({ where: { institutionId: inst.id, ...(vacancyId ? { vacancyId } : {}) }, orderBy: { createdAt: 'desc' }, take: 200, select: BROADCAST_SELECT })
    return this.toBroadcasts(rows)
  }

  // ───────────── helpers ─────────────

  private async broadcastOf(institutionId: string, id: string): Promise<VacancyBroadcastDto> {
    const [dto] = await this.toBroadcasts([await this.prisma.client.vacancyBroadcast.findFirstOrThrow({ where: { id, institutionId }, select: BROADCAST_SELECT })])
    return dto
  }

  /** The senders' names in one read (createdById has no foreign key, as the registry's other «who» columns). */
  private async toBroadcasts(rows: BroadcastRow[]): Promise<VacancyBroadcastDto[]> {
    const names = new Map((await this.prisma.client.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, displayName: true } })).map((u) => [u.id, u.displayName]))
    return rows.map((b) => ({
      id: b.id, vacancyId: b.vacancyId, vacancyTitle: b.vacancy.title, companyName: b.vacancy.company.name,
      sentBy: names.has(b.createdById) ? { name: names.get(b.createdById)! } : null,
      directions: b.directions.map((d) => mainOf(d.direction)), courses: [...b.courses].sort((x, y) => x - y),
      recipientsCount: b.recipientsCount, deliveredCount: b._count.recipients, createdAt: b.createdAt.toISOString(), finishedAt: b.finishedAt?.toISOString() ?? null,
    }))
  }

  private sentToday(db: TransactionClient | PrismaService['client'], institutionId: string) {
    return db.vacancyBroadcast.count({ where: { institutionId, createdAt: { gte: new Date(Date.now() - DAY_MS) } } })
  }

  /** The industries of the institution's directions (an alias's main direction decides). */
  private async industries(institutionId: string): Promise<string[]> {
    const rows = await this.prisma.client.institutionDirection.findMany({ where: { institutionId }, select: { direction: { select: { industryId: true, mergedInto: { select: { industryId: true } } } } } })
    return [...new Set(rows.map((r) => r.direction.mergedInto?.industryId ?? r.direction.industryId))]
  }

  /** A vacancy the institution may see: visible to students and in the industries of its directions; else not found. */
  private async visibleTo(institutionId: string, id: string) {
    const industries = await this.industries(institutionId)
    const row = industries.length
      ? await this.prisma.client.vacancy.findFirst({ where: { id, AND: [visibleVacancy(), { directions: { some: { direction: { industryId: { in: industries } } } } }] }, select: { ...VACANCY_SELECT, regionId: true } })
      : null
    if (!row) throw AppError.notFound('Vacancy')
    return row
  }

  /**
   * The directions a broadcast may name (3.2, п. 1): the institution's own (an alias stands for its main direction), and
   * only those whose industry is the vacancy's. Anything else is refused, not silently dropped.
   */
  private async chosenDirections(institutionId: string, vacancyId: string, ids: string[]): Promise<string[]> {
    const found = await this.prisma.client.direction.findMany({ where: { id: { in: ids } }, select: { id: true, mergedIntoId: true } })
    if (found.length !== new Set(ids).size) throw AppError.invalid('invalid_direction', 'Choose directions from the list')
    const main = [...new Set(found.map((d) => d.mergedIntoId ?? d.id))]
    const own = await this.prisma.client.institutionDirection.findMany({ where: { institutionId, directionId: { in: main } }, select: { directionId: true, direction: { select: { industryId: true } } } })
    const vacancyIndustries = new Set((await this.prisma.client.vacancyDirection.findMany({ where: { vacancyId }, select: { direction: { select: { industryId: true } } } })).map((d) => d.direction.industryId))
    if (own.length !== main.length || own.some((d) => !vacancyIndustries.has(d.direction.industryId))) {
      throw AppError.invalid('invalid_direction', 'Choose your own directions of the vacancy’s industry')
    }
    return main
  }

  private async withSent(institutionId: string, rows: Parameters<typeof toVacancy>[0][]): Promise<InstitutionVacancyDto[]> {
    const groups = await this.prisma.client.vacancyBroadcastRecipient.groupBy({ by: ['vacancyId'], where: { vacancyId: { in: rows.map((r) => r.id) }, broadcast: { institutionId } }, _count: { _all: true } })
    const sent = new Map(groups.map((g) => [g.vacancyId, g._count._all]))
    return rows.map((r) => ({ ...toVacancy(r), sentTo: sent.get(r.id) ?? 0 }))
  }

  private async ownInstitution(actor: RequestActor) {
    const user = await this.prisma.client.user.findFirst({ where: { id: actor.id }, select: { institution: { select: { id: true, regionId: true } } } })
    if (!user?.institution) throw AppError.notFound('Institution')
    return user.institution
  }
}

const BROADCAST_SELECT = {
  id: true, vacancyId: true, courses: true, recipientsCount: true, createdAt: true, finishedAt: true, createdById: true,
  vacancy: { select: { title: true, company: { select: { name: true } } } },
  directions: { select: { direction: { select: DIRECTION_WITH_MAIN } } },
  // Delivered so far: this broadcast's recipient rows (a student another broadcast reached first is not among them).
  _count: { select: { recipients: true } },
} as const satisfies Prisma.VacancyBroadcastSelect
type BroadcastRow = Prisma.VacancyBroadcastGetPayload<{ select: typeof BROADCAST_SELECT }>

