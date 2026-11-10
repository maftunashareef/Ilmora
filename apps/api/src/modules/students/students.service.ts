import { Injectable } from '@nestjs/common'
import {
  type InstitutionStudentDto, isMinor, type StudentConsentDto, normalizeUzPhone, QUESTIONNAIRE_STEPS, registrySearchKey, STUDENT_CONSENT_KEYS, STUDENT_CONSENT_TEXT_VERSION,
  type StudentConsentKey, type StudentQuestionnaire, validateQuestionnaireStep,
} from '@ilmora/shared'
import { AppError } from '../../common/errors'
import type { ConsentKind, InstitutionType, Prisma } from '../../generated/prisma/client'
import { PrismaService, type TransactionClient } from '../../infra/prisma/prisma.service'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { NotificationsService } from '../notifications/notifications.service'
import { DIRECTION_WITH_MAIN, mainOf, regionIdByRef } from '../registry/registry.mappers'
import { RegistryService } from '../registry/registry.service'
import type { QuestionnaireInput } from './students.schemas'

/** The answer the web wizard expects (apps/web/src/services/questionnaire.ts). */
export interface QuestionnaireState {
  questionnaire: StudentQuestionnaire | null
  complete: boolean
  studyConfirmed: 'CONFIRMED' | 'PENDING' | 'REJECTED' | null
}


const PROFILE_SELECT = {
  mode: true, institutionType: true, institutionId: true, course: true, enrollYear: true, graduationYear: true, studyForm: true, contractAmountMinor: true,
  birthDate: true, about: true, contactPhone: true, parentName: true, parentPhone: true, studyConfirmation: true,
  institution: { select: { id: true, name: true, region: { select: { slug: true } } } },
  direction: { select: DIRECTION_WITH_MAIN },
  region: { select: { slug: true } },
  user: { select: { displayName: true, district: true, email: true, phoneE164: true, phoneVerifiedAt: true } },
} as const satisfies Prisma.StudentProfileSelect

/**
 * The student's questionnaire (ТЗ 4.1) in the shape of the web wizard (`StudentQuestionnaire`, @ilmora/shared), and
 * the institution's confirmation that a student studies there. Saved whole, after the same step rules the wizard uses.
 * An institution or a direction the student typed goes to the shared registry (ТЗ 3.2, 3.5). Consents (ТЗ 8) are rows
 * of the StudentConsent journal: giving one adds a row, taking it back stamps `revokedAt`; nothing is overwritten.
 */
@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly registry: RegistryService,
  ) {}

  async questionnaire(actor: RequestActor): Promise<QuestionnaireState> {
    const row = await this.prisma.client.studentProfile.findFirst({ where: { userId: actor.id }, select: PROFILE_SELECT })
    if (!row) return { questionnaire: null, complete: false, studyConfirmed: null }
    const consents = await this.activeConsents(actor.id)
    const q: StudentQuestionnaire = {
      status: row.mode,
      institutionType: row.institutionType,
      institution: row.institution ? { id: row.institution.id, name: row.institution.name, region: row.institution.region?.slug ?? '' } : null,
      institutionUndecided: row.mode === 'APPLYING' && !row.institutionId,
      course: row.course,
      direction: row.direction ? (() => { const d = mainOf(row.direction); return { id: d.id, name: d.name, industryId: d.industry.id } })() : null,
      studyForm: row.studyForm === 'UNDECIDED' ? 'UNKNOWN' : row.studyForm,
      contractSum: row.contractAmountMinor !== null ? Number(row.contractAmountMinor) / 100 : null,
      graduationYear: row.graduationYear,
      admissionYear: row.enrollYear,
      fullName: row.user.displayName,
      birthDate: row.birthDate ? row.birthDate.toISOString().slice(0, 10) : '',
      region: row.region?.slug ?? '',
      district: row.user.district ?? '',
      phone: row.contactPhone ?? this.signInPhone(row.user),
      email: row.user.email ?? '',
      about: row.about ?? '',
      guardianName: row.parentName ?? '',
      guardianPhone: row.parentPhone ?? '',
      guardianConsent: consents.has('PARENT_CONSENT'),
      consents: Object.fromEntries(STUDENT_CONSENT_KEYS.map((k) => [k, consents.has(k)])),
    }
    return { questionnaire: q, complete: this.missing(q).length === 0, studyConfirmed: row.studyConfirmation === 'NONE' ? null : row.studyConfirmation }
  }

  async save(tenantId: string, actor: RequestActor, input: QuestionnaireInput, ip?: string): Promise<QuestionnaireState> {
    if (!actor.roles.includes('STUDENT')) throw AppError.forbidden('Only a student fills in the questionnaire')
    const q = input as StudentQuestionnaire
    const errors = this.missing(q)
    if (errors.length) throw AppError.invalid('questionnaire_incomplete', 'Fill in the questionnaire', { step: errors[0].step, errors: Object.fromEntries(errors.map((e) => [e.field, e.key])) })
    const now = new Date()
    const studying = q.status === 'STUDYING'
    const school = q.institutionType === 'SCHOOL'
    const type: InstitutionType = q.institutionType!

    const regionId = await regionIdByRef(this.prisma, q.region)
    if (!regionId) throw AppError.invalid('invalid_region', 'Choose a region from the list')
    const institutionId = !studying && q.institutionUndecided ? null : await this.institutionOf(tenantId, actor, q.institution!, type)
    const directionId = q.direction?.name.trim() ? await this.directionOf(tenantId, actor, q.direction) : null
    const minor = isMinor(q, now)
    const guardianPhone = minor ? normalizeUzPhone(q.guardianPhone) : null
    // The contact phone (checked by the step rules above): its own field — the sign-in number User.phoneE164 is never touched.
    const contactPhone = normalizeUzPhone(q.phone)

    const before = await this.prisma.client.studentProfile.findFirst({ where: { userId: actor.id }, select: { institutionId: true, studyConfirmation: true, mode: true } })
    const confirmation = await this.confirmationFor(studying, institutionId, before)
    const data = {
      mode: q.status!,
      institutionType: type,
      institutionId,
      course: studying ? q.course : null,
      enrollYear: studying ? null : q.admissionYear,
      graduationYear: studying ? q.graduationYear : null,
      directionId,
      studyForm: studying && school ? null : q.studyForm === 'UNKNOWN' ? ('UNDECIDED' as const) : q.studyForm,
      contractAmountMinor: q.contractSum && (q.studyForm === 'CONTRACT' || !studying) ? BigInt(Math.round(q.contractSum * 100)) : null,
      birthDate: new Date(`${q.birthDate}T00:00:00Z`),
      regionId,
      about: q.about.trim() || null,
      parentName: minor ? q.guardianName.trim() : null,
      contactPhone: contactPhone.ok ? contactPhone.e164 : null,
      parentPhone: guardianPhone?.ok ? guardianPhone.e164 : null,
      ...confirmation,
    }
    await this.prisma.client.$transaction(async (tx) => {
      await tx.studentProfile.upsert({ where: { userId: actor.id }, create: { tenantId, userId: actor.id, ...data }, update: data })
      await tx.user.update({ where: { id: actor.id }, data: { displayName: q.fullName.trim().replace(/\s+/g, ' '), district: q.district.trim(), email: q.email.trim() || null } })
      await this.syncConsents(tx, tenantId, actor.id, { GRADUATE_CARD: !!q.consents.GRADUATE_CARD, CONTRACT_HELP_CARD: !!q.consents.CONTRACT_HELP_CARD, PARENT_CONSENT: minor && q.guardianConsent }, ip, now)
    })
    await this.audit.record({ action: before ? 'student.questionnaire.update' : 'student.questionnaire.create', entityType: 'StudentProfile', entityId: actor.id, after: { mode: data.mode, institutionId, directionId, studyConfirmation: confirmation.studyConfirmation ?? before?.studyConfirmation } })
    if (confirmation.studyConfirmation === 'PENDING' && institutionId) await this.askInstitution(tenantId, institutionId, q.fullName)
    return this.questionnaire(actor)
  }

  /** The consent journal (ТЗ 8): every consent given, newest first, with the date it was taken back; nothing is erased. */
  async consents(actor: RequestActor): Promise<StudentConsentDto[]> {
    const rows = await this.prisma.client.studentConsent.findMany({
      where: { userId: actor.id }, orderBy: [{ givenAt: 'desc' }, { id: 'desc' }], take: 1000,
      select: { id: true, kind: true, textVersion: true, givenAt: true, revokedAt: true, company: { select: { id: true, name: true } } },
    })
    return rows.map((r) => ({ id: r.id, kind: r.kind, company: r.company, textVersion: r.textVersion, givenAt: r.givenAt.toISOString(), revokedAt: r.revokedAt?.toISOString() ?? null, active: r.revokedAt === null }))
  }

  // ───────────── the institution confirms its students (ТЗ 4.1 «Подтверждение учёбы») ─────────────

  async institutionStudents(actor: RequestActor, status?: 'PENDING' | 'CONFIRMED' | 'REJECTED'): Promise<InstitutionStudentDto[]> {
    const institutionId = await this.ownInstitution(actor)
    const rows = await this.prisma.client.studentProfile.findMany({
      where: { institutionId, mode: 'STUDYING', studyConfirmation: status ? status : { in: ['PENDING', 'CONFIRMED', 'REJECTED'] } },
      orderBy: [{ studyConfirmation: 'asc' }, { createdAt: 'asc' }],
      take: 2000,
      select: { userId: true, course: true, graduationYear: true, studyConfirmation: true, direction: { select: DIRECTION_WITH_MAIN }, user: { select: { displayName: true } } },
    })
    return rows.map((r) => ({ id: r.userId, name: r.user.displayName, course: r.course, graduationYear: r.graduationYear, direction: r.direction ? mainOf(r.direction) : null, confirmation: r.studyConfirmation as InstitutionStudentDto['confirmation'] }))
  }

  async decideStudy(tenantId: string, actor: RequestActor, studentId: string, confirm: boolean): Promise<InstitutionStudentDto[]> {
    const institutionId = await this.ownInstitution(actor)
    const status = confirm ? 'CONFIRMED' : 'REJECTED'
    const moved = await this.prisma.client.studentProfile.updateMany({
      where: { userId: studentId, institutionId, mode: 'STUDYING', studyConfirmation: { in: ['PENDING', 'CONFIRMED', 'REJECTED'] } },
      data: { studyConfirmation: status, studyConfirmedAt: new Date(), studyConfirmedById: actor.id },
    })
    if (moved.count !== 1) throw AppError.notFound('Student')
    await this.audit.record({ action: confirm ? 'student.study.confirm' : 'student.study.reject', entityType: 'StudentProfile', entityId: studentId, after: { institutionId, status } })
    const type = confirm ? 'student.studyConfirmed' : 'student.studyRejected'
    const inst = await this.prisma.client.institution.findFirstOrThrow({ where: { id: institutionId }, select: { name: true } })
    await this.notifications.safely(type, () => this.notifications.notify({ tenantId, userIds: [studentId], type, params: { institutionName: inst.name }, dedupeKey: `study:${studentId}:${institutionId}:${Date.now()}` }))
    return this.institutionStudents(actor)
  }

  // ───────────── helpers ─────────────

  /**
   * The phone the questionnaire offers when it has no contact phone of its own: the number the student signed in
   * with by SMS (User.phoneE164, confirmed); never one typed elsewhere.
   */
  private signInPhone(user: { phoneE164: string | null; phoneVerifiedAt: Date | null }): string {
    return user.phoneVerifiedAt && user.phoneE164 ? user.phoneE164 : ''
  }

  /** Step errors of the questionnaire (steps 1–3, the rules of the web wizard). */
  private missing(q: StudentQuestionnaire) {
    const today = new Date()
    const out: { step: number; field: string; key: string }[] = []
    for (let s = 1; s < QUESTIONNAIRE_STEPS; s++) {
      for (const [field, key] of Object.entries(validateQuestionnaireStep(s, q, today))) {
        out.push({ step: s, field, key: key as string })
      }
    }
    return out
  }

  /** A registry institution by id (a merged record → its target), else the one the student typed (added to the registry). */
  private async institutionOf(tenantId: string, actor: RequestActor, choice: { id?: string; name: string; region: string }, type: InstitutionType): Promise<string> {
    if (choice.id) {
      const found = await this.prisma.client.institution.findFirst({ where: { id: choice.id }, select: { id: true, mergedIntoId: true } })
      if (found) return found.mergedIntoId ?? found.id
    }
    // Not in the database (a typed name, or an id from the web app's own list that is not imported yet).
    const added = await this.registry.addStudentInstitution(tenantId, actor, { name: choice.name.trim().replace(/\s+/g, ' '), type: type === 'TRAINING_CENTER' ? 'TECHNIKUM' : type, regionId: choice.region })
    return added.institution.id
  }

  /** A direction by id (an alias → its main direction), by its normalized name, or a new one in the given industry. */
  private async directionOf(tenantId: string, actor: RequestActor, choice: { id?: string; name: string; industryId?: string }): Promise<string> {
    if (choice.id) {
      const found = await this.prisma.client.direction.findFirst({ where: { id: choice.id }, select: { id: true, mergedIntoId: true } })
      if (found) return found.mergedIntoId ?? found.id
    }
    const byName = await this.prisma.client.direction.findFirst({ where: { searchKey: registrySearchKey(choice.name) }, select: { id: true, mergedIntoId: true } })
    if (byName) return byName.mergedIntoId ?? byName.id
    if (!choice.industryId) throw AppError.invalid('invalid_direction', 'Choose a direction from the list or its industry')
    return (await this.registry.addDirection(tenantId, actor, { name: choice.name.trim().replace(/\s+/g, ' '), industryId: choice.industryId })).direction.id
  }

  /**
   * Studying at an approved institution: the institution confirms it (PENDING); a new institution starts over. Applying,
   * or an institution not (yet) in ILMORA: nothing to confirm.
   */
  private async confirmationFor(studying: boolean, institutionId: string | null, before: { institutionId: string | null; studyConfirmation: string; mode: string } | null) {
    if (!studying || !institutionId) return { studyConfirmation: 'NONE' as const, studyConfirmedAt: null, studyConfirmedById: null }
    if (before && before.mode === 'STUDYING' && before.institutionId === institutionId && before.studyConfirmation !== 'NONE') return {}
    const approved = await this.prisma.client.institution.findFirst({ where: { id: institutionId, approvedAt: { not: null } }, select: { id: true } })
    return { studyConfirmation: approved ? ('PENDING' as const) : ('NONE' as const), studyConfirmedAt: null, studyConfirmedById: null }
  }

  private async activeConsents(userId: string): Promise<Set<ConsentKind>> {
    const rows = await this.prisma.client.studentConsent.findMany({ where: { userId, revokedAt: null, companyId: null }, select: { kind: true } })
    return new Set(rows.map((r) => r.kind))
  }

  /** The journal (ТЗ 8): a new row for a consent given, `revokedAt` on the active row of one taken back. */
  private async syncConsents(tx: TransactionClient, tenantId: string, userId: string, want: Record<StudentConsentKey | 'PARENT_CONSENT', boolean>, ip: string | undefined, now: Date) {
    const active = await tx.studentConsent.findMany({ where: { userId, revokedAt: null, companyId: null }, select: { id: true, kind: true } })
    for (const [kind, on] of Object.entries(want) as [ConsentKind, boolean][]) {
      const row = active.find((a) => a.kind === kind)
      if (on && !row) await tx.studentConsent.create({ data: { tenantId, userId, kind, textVersion: STUDENT_CONSENT_TEXT_VERSION, ip: ip ?? null, givenAt: now } })
      if (!on && row) await tx.studentConsent.update({ where: { id: row.id }, data: { revokedAt: now } })
    }
  }

  private async askInstitution(tenantId: string, institutionId: string, studentName: string) {
    await this.notifications.safely('student.studyPending', async () => {
      const rep = await this.prisma.client.user.findFirst({ where: { institutionId }, select: { id: true } })
      if (rep) await this.notifications.notify({ tenantId, userIds: [rep.id], type: 'student.studyPending', params: { studentName }, dedupeKey: `study-pending:${institutionId}:${Date.now()}` })
    })
  }

  private async ownInstitution(actor: RequestActor): Promise<string> {
    const user = await this.prisma.client.user.findFirst({ where: { id: actor.id }, select: { institutionId: true } })
    if (!user?.institutionId) throw AppError.notFound('Institution')
    return user.institutionId
  }
}

