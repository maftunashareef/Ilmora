import { Injectable } from '@nestjs/common'
import {
  type ConsentGiveBlock, consentGiveBlock, type InstitutionStudentDto, isMinor, type StudentConsentActionKind, type StudentConsentDto, normalizeUzPhone, QUESTIONNAIRE_STEPS, registrySearchKey,
  STUDENT_CONSENT_KEYS, STUDENT_CONSENT_TEXT_VERSION, type StudentQuestionnaire, validateQuestionnaireStep,
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
import { dateColumnToIso } from '../../common/time'

/** The answer the web wizard expects (apps/web/src/services/questionnaire.ts). */
export interface QuestionnaireState {
  questionnaire: StudentQuestionnaire | null
  complete: boolean
  studyConfirmed: 'CONFIRMED' | 'PENDING' | 'REJECTED' | null
  /**
   * The parent's consent is in the journal, in force or taken back: the questionnaire no longer asks for the mark of
   * step 3 — the consent is given and taken back on «Мои согласия». `complete` still needs it in force for a minor.
   */
  parentConsentOnRecord: boolean
}

/** Why `POST students/me/consents/:kind/give` refuses (the code is the `ConsentGiveBlock` itself). */
const GIVE_REFUSED: Record<ConsentGiveBlock, string> = {
  questionnaire_required: 'Fill in the questionnaire first',
  consent_studying_only: 'This consent is for students who already study',
  parent_consent_required: 'A minor needs the parent’s consent in force',
  guardian_details_required: 'The questionnaire needs the parent’s or guardian’s name and phone',
  parent_consent_adult: 'The parent’s consent is for students under 18',
}

const PROFILE_SELECT = {
  mode: true, institutionType: true, institutionId: true, course: true, enrollYear: true, graduationYear: true, studyForm: true, contractAmountMinor: true,
  birthDate: true, about: true, contactPhone: true, parentName: true, parentPhone: true, studyConfirmation: true,
  institution: { select: { id: true, name: true, region: { select: { slug: true } } } },
  direction: { select: DIRECTION_WITH_MAIN },
  region: { select: { slug: true } },
  user: { select: { displayName: true, district: true, email: true, phoneE164: true, phoneVerifiedAt: true } },
} as const satisfies Prisma.StudentProfileSelect

/** One writer of a student's consent journal at a time (the consent actions, the questionnaire, the contract-help form, the deletion of the account). */
export const lockConsents = (tx: TransactionClient, userId: string) => tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext($1))`, `consents:${userId}`)

/**
 * The student's questionnaire (ТЗ 4.1) in the shape of the web wizard (`StudentQuestionnaire`, @ilmora/shared), and
 * the institution's confirmation that a student studies there. Saved whole, after the same step rules the wizard uses.
 * An institution or a direction the student typed goes to the shared registry (ТЗ 3.2, 3.5). Consents (ТЗ 8) are rows
 * of the StudentConsent journal: giving one adds a row, taking it back stamps `revokedAt`; nothing is overwritten.
 * They are given and taken back by their own actions (`giveConsent`, `revokeConsent`), never by saving the questionnaire:
 * a student whose questionnaire no longer passes the step rules must still be able to take a consent back, and a tab
 * opened before a revocation must not give the consent again. The one exception is the parent's consent of a minor's
 * first questionnaire (`syncParentConsent`).
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
    if (!row) return { questionnaire: null, complete: false, studyConfirmed: null, parentConsentOnRecord: false }
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
      birthDate: row.birthDate ? dateColumnToIso(row.birthDate) : '',
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
    // `complete` is strict: a minor's questionnaire is complete only with the parent's consent in force (help with the contract and applications rely on it).
    return { questionnaire: q, complete: this.missing(q).length === 0, studyConfirmed: row.studyConfirmation === 'NONE' ? null : row.studyConfirmation, parentConsentOnRecord: consents.has('PARENT_CONSENT') || (await this.parentConsentOnRecord(actor.id)) }
  }

  async save(tenantId: string, actor: RequestActor, input: QuestionnaireInput, ip?: string): Promise<QuestionnaireState> {
    if (!actor.roles.includes('STUDENT')) throw AppError.forbidden('Only a student fills in the questionnaire')
    const q = input as StudentQuestionnaire
    // The mark «согласие родителя получено» is asked for only until that consent is in the journal: taken back later, it must not block the questionnaire.
    const errors = this.missing(q, await this.parentConsentOnRecord(actor.id))
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

    const before = await this.prisma.client.studentProfile.findFirst({ where: { userId: actor.id }, select: { institutionId: true, studyConfirmation: true, mode: true, directionId: true, graduationYear: true, user: { select: { displayName: true } } } })
    const fullName = q.fullName.trim().replace(/\s+/g, ' ')
    // What the institution confirmed: the name, the direction and the year of graduation (ТЗ 4.1). A change asks again.
    const confirmedChanged = !!before && (before.user.displayName !== fullName || before.directionId !== directionId || before.graduationYear !== (studying ? q.graduationYear : null))
    const confirmation = await this.confirmationFor(studying, institutionId, before, confirmedChanged)
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
      await tx.user.update({ where: { id: actor.id }, data: { displayName: fullName, district: q.district.trim(), email: q.email.trim() || null } })
      // `q.consents` is not read: the card consents change only by their own actions (a tab opened before a revocation would give them back).
      await this.syncParentConsent(tx, tenantId, actor.id, minor, q.guardianConsent, ip, now)
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

  /**
   * «Дать согласие» (ТЗ 8): a new journal row with the text version, the time and the IP — unless one of the kind is in
   * force already. Needs a saved questionnaire; the rule for minors and for «компании моей отрасли» is `consentGiveBlock`,
   * checked under the journal lock with the questionnaire and the parent's consent as they are now. Audited in the same transaction.
   */
  async giveConsent(tenantId: string, actor: RequestActor, kind: StudentConsentActionKind, ip?: string): Promise<StudentConsentDto[]> {
    if (!actor.roles.includes('STUDENT')) throw AppError.forbidden('Only a student gives these consents')
    const now = new Date()
    await this.prisma.client.$transaction(async (tx) => {
      await lockConsents(tx, actor.id)
      const profile = await tx.studentProfile.findFirst({ where: { userId: actor.id, user: { deletedAt: null } }, select: { mode: true, birthDate: true, parentName: true, parentPhone: true } })
      const active = new Set((await tx.studentConsent.findMany({ where: { userId: actor.id, revokedAt: null, companyId: null }, select: { kind: true } })).map((r) => r.kind))
      const block = consentGiveBlock(kind, profile && { status: profile.mode, birthDate: profile.birthDate ? dateColumnToIso(profile.birthDate) : '', hasGuardian: !!profile.parentName && !!profile.parentPhone, parentConsent: active.has('PARENT_CONSENT') }, now)
      if (block) throw AppError.invalid(block, GIVE_REFUSED[block], { kind })
      if (active.has(kind)) return
      const row = await tx.studentConsent.create({ data: { tenantId, userId: actor.id, kind, textVersion: STUDENT_CONSENT_TEXT_VERSION, ip: ip ?? null, givenAt: now }, select: { id: true } })
      await this.audit.record({ tx, tenantId, action: 'student.consent.give', entityType: 'StudentConsent', entityId: row.id, after: { kind, userId: actor.id, textVersion: STUDENT_CONSENT_TEXT_VERSION } })
    })
    return this.consents(actor)
  }

  /**
   * «Отозвать» (ТЗ 8): works at once and asks nothing of the questionnaire — a student whose questionnaire no longer
   * passes the step rules (the graduation year has passed, a parent changed their mind) takes a consent back all the
   * same. Every row of the kind in force gets `revokedAt`; nothing is deleted. Cards are hidden by the readers, which
   * check the consent at every read; contact requests already sent and contacts already opened stay as they are.
   */
  async revokeConsent(tenantId: string, actor: RequestActor, kind: StudentConsentActionKind): Promise<StudentConsentDto[]> {
    const now = new Date()
    await this.prisma.client.$transaction(async (tx) => {
      await lockConsents(tx, actor.id)
      await this.closeConsents(tx, tenantId, actor.id, kind, now)
    })
    return this.consents(actor)
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

  /**
   * Confirms or rejects what the institution saw (Н-8): the direction (the list shows the main one of an alias) and the
   * year must still be the student's, checked in the same update; otherwise 409 `study_changed` and the list is re-read.
   */
  async decideStudy(tenantId: string, actor: RequestActor, studentId: string, confirm: boolean, seen: { directionId: string | null; graduationYear: number | null }): Promise<InstitutionStudentDto[]> {
    const institutionId = await this.ownInstitution(actor)
    const status = confirm ? 'CONFIRMED' : 'REJECTED'
    const mine: Prisma.StudentProfileWhereInput = { userId: studentId, institutionId, mode: 'STUDYING', studyConfirmation: { in: ['PENDING', 'CONFIRMED', 'REJECTED'] } }
    const asSeen: Prisma.StudentProfileWhereInput = {
      graduationYear: seen.graduationYear,
      ...(seen.directionId ? { OR: [{ directionId: seen.directionId }, { direction: { mergedIntoId: seen.directionId } }] } : { directionId: null }),
    }
    const moved = await this.prisma.client.studentProfile.updateMany({ where: { ...mine, ...asSeen }, data: { studyConfirmation: status, studyConfirmedAt: new Date(), studyConfirmedById: actor.id } })
    if (moved.count !== 1) {
      if (await this.prisma.client.studentProfile.count({ where: mine })) throw AppError.conflict('study_changed', 'The student changed the direction or the year meanwhile; check the list again')
      throw AppError.notFound('Student')
    }
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
  private missing(q: StudentQuestionnaire, parentConsentOnRecord = false) {
    const today = new Date()
    const out: { step: number; field: string; key: string }[] = []
    for (let s = 1; s < QUESTIONNAIRE_STEPS; s++) {
      for (const [field, key] of Object.entries(validateQuestionnaireStep(s, q, today, [], parentConsentOnRecord))) {
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
  /**
   * The confirmation stays only while the student studies at the same institution under the same name, direction and
   * year; otherwise it starts over — «ждёт» at an approved institution, «нечего подтверждать» elsewhere.
   */
  private async confirmationFor(studying: boolean, institutionId: string | null, before: { institutionId: string | null; studyConfirmation: string; mode: string } | null, confirmedChanged: boolean) {
    if (!studying || !institutionId) return { studyConfirmation: 'NONE' as const, studyConfirmedAt: null, studyConfirmedById: null }
    if (before && before.mode === 'STUDYING' && before.institutionId === institutionId && before.studyConfirmation !== 'NONE' && !confirmedChanged) return {}
    const approved = await this.prisma.client.institution.findFirst({ where: { id: institutionId, approvedAt: { not: null }, blockedAt: null }, select: { id: true } })
    return { studyConfirmation: approved ? ('PENDING' as const) : ('NONE' as const), studyConfirmedAt: null, studyConfirmedById: null }
  }

  private async activeConsents(userId: string): Promise<Set<ConsentKind>> {
    const rows = await this.prisma.client.studentConsent.findMany({ where: { userId, revokedAt: null, companyId: null }, select: { kind: true } })
    return new Set(rows.map((r) => r.kind))
  }

  /** The parent's consent is in the journal at all — in force or taken back. */
  private async parentConsentOnRecord(userId: string): Promise<boolean> {
    return !!(await this.prisma.client.studentConsent.findFirst({ where: { userId, kind: 'PARENT_CONSENT', companyId: null }, select: { id: true } }))
  }

  /**
   * What saving the questionnaire does to the parent's consent — and to no other consent:
   * - a minor's questionnaire with no parent consent in the journal yet: the mark of step 3 (required then) gives it;
   * - once it is in the journal, the mark is ignored: taken back on «Мои согласия», it comes back only from there — not
   *   from a tab opened before the revocation, and not as a condition of saving;
   * - the student is of age: the consent in force is closed.
   * Serialized per student (cybersecurity check 9.4, 11.11): two saves at once both saw «no consent in force» and wrote two rows.
   */
  private async syncParentConsent(tx: TransactionClient, tenantId: string, userId: string, minor: boolean, marked: boolean, ip: string | undefined, now: Date) {
    await lockConsents(tx, userId)
    if (!minor) return this.closeConsents(tx, tenantId, userId, 'PARENT_CONSENT', now, 'of_age')
    if (!marked || (await tx.studentConsent.findFirst({ where: { userId, kind: 'PARENT_CONSENT', companyId: null }, select: { id: true } }))) return
    const row = await tx.studentConsent.create({ data: { tenantId, userId, kind: 'PARENT_CONSENT', textVersion: STUDENT_CONSENT_TEXT_VERSION, ip: ip ?? null, givenAt: now }, select: { id: true } })
    await this.audit.record({ tx, tenantId, action: 'student.consent.give', entityType: 'StudentConsent', entityId: row.id, after: { kind: 'PARENT_CONSENT', userId, textVersion: STUDENT_CONSENT_TEXT_VERSION }, reason: 'questionnaire' })
  }

  /** Stamps `revokedAt` on every row of the kind in force (older duplicates go too) and audits each; the caller holds the journal lock. */
  private async closeConsents(tx: TransactionClient, tenantId: string, userId: string, kind: ConsentKind, now: Date, reason?: string) {
    const rows = await tx.studentConsent.findMany({ where: { userId, kind, companyId: null, revokedAt: null }, select: { id: true } })
    if (!rows.length) return
    await tx.studentConsent.updateMany({ where: { id: { in: rows.map((r) => r.id) }, revokedAt: null }, data: { revokedAt: now } })
    for (const r of rows) await this.audit.record({ tx, tenantId, action: 'student.consent.revoke', entityType: 'StudentConsent', entityId: r.id, after: { kind, userId }, reason })
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

