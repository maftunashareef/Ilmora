import { randomUUID } from 'node:crypto'
import { Inject, Injectable } from '@nestjs/common'
import {
  attendancePercent, countsAsAttended, EXPORT_EXTRA_COLUMNS, foldForSearch, FULL_NAME_MAX, formatUzPhone, GROUPS_SEPARATOR, IMPORT_COLUMNS, IMPORT_MAX_BYTES, IMPORT_MAX_ROWS,
  INVITE_SENDS_MAX, INVITE_TTL_DAYS, inviteState, inviteUrl, isMinorOn, maskPhone, normalizeUzPhone, parseSheetDate, pick, registrySearchKey, translate,
  type ImportColumnKey, type ImportRowError, type InviteState, type L, type Lang, type RegistryInstitutionType, type TKey,
} from '@ilmora/shared'
import { randomToken, sha256 } from '../../common/crypto'
import { AppError, uniqueConstraintOf } from '../../common/errors'
import { dateColumnToIso, isCalendarDate, isoToDateColumn, todayLocal } from '../../common/time'
import { buildXlsx, type Cell } from '../../common/xlsx'
import { DEFAULT_XLSX_LIMITS, readXlsxRows, XlsxReadError } from '../../common/xlsx-read'
import { ENV, type Env } from '../../config/env'
import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infra/prisma/prisma.service'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { TenantsService } from '../tenants/tenants.service'
import type { CenterStudentInput, CenterStudentPatch, InviteAcceptBody, RosterExportQuery, RosterQuery } from './center-students.schemas'

/** A center keeps a few hundred students; the table loads at most this many records at once. */
const ROSTER_MAX = 5000
const DAY = 86_400_000

const ROW_INCLUDE = {
  groups: { where: { group: { deletedAt: null } }, include: { group: { select: { id: true, name: true, course: { select: { id: true, title: true } } } } } },
  institution: { select: { id: true, name: true, type: true } },
  user: { select: { id: true, displayName: true, phoneE164: true, studentProfile: { select: { course: true, birthDate: true, institutionType: true, institution: { select: { id: true, name: true, type: true } } } } } },
} as const satisfies Prisma.CenterStudentInclude
type Row = Prisma.CenterStudentGetPayload<{ include: typeof ROW_INCLUDE }>
type EnrollmentRow = { studentId: string; groupId: string; enrolledAt: Date; group: { id: string; name: string; course: { id: string; title: unknown } } }

export interface RosterGroupDto { id: string; name: string; courseTitle: unknown; via: 'center' | 'ilmora' }
export interface RosterRowDto {
  id: string
  source: 'CENTER' | 'ILMORA'
  fullName: string
  /** The center's own entry in full; an ILMORA student's account phone masked. */
  phone: string | null
  birthDate: string | null
  minor: boolean
  institution: { id: string | null; name: string; type: RegistryInstitutionType | null } | null
  studyYear: number | null
  groups: RosterGroupDto[]
  parentName: string | null
  parentPhone: string | null
  status: 'STUDYING' | 'PAUSED' | 'LEFT'
  startedOn: string | null
  archivedAt: string | null
  attendance: { attended: number; total: number; percent: number | null }
  invite: { state: InviteState; sends: number; sendsLeft: number; expiresAt: string | null }
  /** A minor's parent gives the consent by an SMS code (second stage); until then it is waiting, the center cannot tick it. */
  parentConsent: 'adult' | 'waiting'
  linked: boolean
}

/** A student's fields as the form or a row of the file give them, before checking. */
interface RawFields { fullName?: string | null; phone?: string | null; birthDate?: string | null; studyYear?: number | null; parentName?: string | null; parentPhone?: string | null; startedOn?: string | null }
interface CleanFields { fullName: string; phoneE164: string | null; birthDate: Date; studyYear: number | null; parentName: string | null; parentPhoneE164: string | null; startedOn: Date | null }

const isUnique = (err: unknown) => (err as { code?: string }).code === 'P2002'
const fold = (s: string) => foldForSearch(s.normalize('NFC')).replace(/\s+/g, ' ').trim()
const ddmmyyyy = (iso: string | null) => (iso ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '')

/**
 * The center's table of students (ТЗ 2026-11-18, раздел 4): its own students (added by hand or from Excel, invited by a
 * one-time link) and the students who came through ILMORA (they get a record of their own). Everything is scoped to the
 * administrator's own center (`actor.centerId`); the Super Admin reaches any center through the twin routes.
 */
@Injectable()
export class CenterStudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tenants: TenantsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get db() {
    return this.prisma.client
  }

  /** The administrator's own center — never another one (the Super Admin's twin routes put the chosen id here). */
  private async own(tenantId: string, actor: RequestActor) {
    if (!actor.centerId) throw AppError.forbidden('Your account is not linked to a center', { code: 'center_required' })
    const center = await this.db.center.findFirst({ where: { tenantId, id: actor.centerId } })
    if (!center) throw AppError.notFound('Center')
    return center
  }

  private assertWritable(center: { status: string }) {
    if (center.status === 'BLOCKED' || center.status === 'REJECTED') throw AppError.forbidden('This center is blocked', { code: 'center_blocked' })
  }

  /**
   * A blocked or rejected center no longer reads or exports its students — children's data among them (проверка
   * безопасности 20.11, №9); the Super Admin still does, for support.
   */
  private assertReadable(center: { status: string }, actor: RequestActor) {
    if (actor.roles.includes('PLATFORM_ADMIN')) return
    this.assertWritable(center)
  }

  /** Invitations reach other people's accounts: only an approved center sends them (as with teachers). */
  private assertApproved(center: { status: string }, actor: RequestActor) {
    this.assertWritable(center)
    if (center.status !== 'ACTIVE' && !actor.roles.includes('PLATFORM_ADMIN')) throw AppError.forbidden('The center is not approved yet', { code: 'center_not_approved' })
  }

  // ───────── the table ─────────

  /**
   * Students who came through an ILMORA subscription get a record of their own the first time the center opens its table
   * after they enrolled (4.1: «попадают в таблицу сами»). Idempotent: a second call, or two at once, add nothing.
   */
  async syncIlmora(tenantId: string, centerId: string): Promise<number> {
    const enrolled = await this.db.enrollment.findMany({
      where: { tenantId, status: 'ACTIVE', course: { centerId } },
      select: { studentId: true, enrolledAt: true, student: { select: { displayName: true } } },
      orderBy: { enrolledAt: 'asc' },
    })
    if (!enrolled.length) return 0
    const known = new Set((await this.db.centerStudent.findMany({ where: { tenantId, centerId, userId: { in: [...new Set(enrolled.map((e) => e.studentId))] } }, select: { userId: true } })).map((r) => r.userId))
    const first = new Map<string, (typeof enrolled)[number]>()
    for (const e of enrolled) if (!known.has(e.studentId) && !first.has(e.studentId)) first.set(e.studentId, e)
    if (!first.size) return 0
    const created = await this.db.centerStudent.createMany({
      data: [...first.values()].map((e) => ({ tenantId, centerId, userId: e.studentId, source: 'ILMORA' as const, fullName: e.student.displayName, startedOn: isoToDateColumn(todayLocal(e.enrolledAt)) })),
      skipDuplicates: true,
    })
    return created.count
  }

  private async load(tenantId: string, centerId: string, where: Prisma.CenterStudentWhereInput): Promise<RosterRowDto[]> {
    const records = await this.db.centerStudent.findMany({ where: { tenantId, centerId, ...where }, include: ROW_INCLUDE, orderBy: [{ fullName: 'asc' }, { id: 'asc' }], take: ROSTER_MAX })
    const userIds = [...new Set(records.map((r) => r.userId).filter((x): x is string => !!x))]
    const enrollments: EnrollmentRow[] = userIds.length
      ? await this.db.enrollment.findMany({
          where: { tenantId, studentId: { in: userIds }, status: { in: ['ACTIVE', 'COMPLETED'] }, course: { centerId } },
          select: { studentId: true, groupId: true, enrolledAt: true, group: { select: { id: true, name: true, course: { select: { id: true, title: true } } } } },
        })
      : []
    const attendance = await this.attendanceOf(tenantId, centerId, records, enrollments)
    return records.map((r) => this.toDto(r, enrollments.filter((e) => e.studentId === r.userId), attendance.get(r.id) ?? { attended: 0, total: 0 }))
  }

  /**
   * Attendance over the lessons that already took place (5: «по прошедшим занятиям»), cancelled ones left out: in the
   * center's own groups by the teacher's marks since the student's start date; in groups the student is in through
   * ILMORA by the QR check-ins since they enrolled. A lesson without a mark is a lesson missed; a lesson before the start
   * date counts only when it was marked.
   */
  private async attendanceOf(tenantId: string, centerId: string, records: Row[], enrollments: EnrollmentRow[]) {
    const out = new Map<string, { attended: number; total: number }>()
    const groupIds = new Set([...records.flatMap((r) => r.groups.map((g) => g.groupId)), ...enrollments.map((e) => e.groupId)])
    if (!groupIds.size) return out
    const now = new Date()
    const sessions = await this.db.lessonSession.findMany({ where: { tenantId, groupId: { in: [...groupIds] }, status: { not: 'CANCELLED' }, endsAt: { lt: now } }, select: { id: true, groupId: true, date: true, startsAt: true } })
    const byGroup = new Map<string, typeof sessions>()
    for (const s of sessions) byGroup.set(s.groupId, [...(byGroup.get(s.groupId) ?? []), s])
    const own = records.filter((r) => r.groups.length)
    const marks = own.length ? await this.db.centerAttendanceMark.findMany({ where: { tenantId, centerStudentId: { in: own.map((r) => r.id) } }, select: { centerStudentId: true, sessionId: true, status: true } }) : []
    const markOf = new Map(marks.map((m) => [`${m.centerStudentId}:${m.sessionId}`, m.status]))
    const users = [...new Set(enrollments.map((e) => e.studentId))]
    const checkIns = users.length ? await this.db.attendanceRecord.findMany({ where: { tenantId, studentId: { in: users }, session: { course: { centerId } } }, select: { studentId: true, sessionId: true, status: true } }) : []
    const checkInOf = new Map(checkIns.map((c) => [`${c.studentId}:${c.sessionId}`, c.status]))
    for (const r of records) {
      let attended = 0
      let total = 0
      const viaIlmora = new Set(enrollments.filter((e) => e.studentId === r.userId).map((e) => e.groupId))
      for (const link of r.groups) {
        if (viaIlmora.has(link.groupId)) continue
        const from = r.startedOn ? dateColumnToIso(r.startedOn) : todayLocal(link.createdAt)
        for (const s of byGroup.get(link.groupId) ?? []) {
          // Lessons since the start date, and any earlier lesson the teacher did mark.
          const mark = markOf.get(`${r.id}:${s.id}`)
          if (dateColumnToIso(s.date) < from && !mark) continue
          total += 1
          if (countsAsAttended(mark)) attended += 1
        }
      }
      for (const e of enrollments.filter((x) => x.studentId === r.userId)) {
        for (const s of byGroup.get(e.groupId) ?? []) {
          if (s.startsAt < e.enrolledAt) continue
          total += 1
          if (checkInOf.get(`${e.studentId}:${s.id}`) === 'PRESENT') attended += 1
        }
      }
      out.set(r.id, { attended, total })
    }
    return out
  }

  private toDto(r: Row, enrollments: EnrollmentRow[], att: { attended: number; total: number }): RosterRowDto {
    const profile = r.source === 'ILMORA' ? r.user?.studentProfile ?? null : null
    const birthDate = r.birthDate ? dateColumnToIso(r.birthDate) : profile?.birthDate ? dateColumnToIso(profile.birthDate) : null
    const minor = isMinorOn(birthDate, todayLocal())
    const institution = r.institution
      ? { id: r.institution.id, name: r.institution.name, type: r.institution.type as RegistryInstitutionType }
      : r.institutionText
        ? { id: null, name: r.institutionText, type: (r.institutionType as RegistryInstitutionType | null) ?? null }
        : profile?.institution
          ? { id: profile.institution.id, name: profile.institution.name, type: profile.institution.type as RegistryInstitutionType }
          : null
    const groups: RosterGroupDto[] = []
    const viaIlmora = new Set(enrollments.map((e) => e.groupId))
    for (const e of enrollments) if (!groups.some((g) => g.id === e.groupId)) groups.push({ id: e.group.id, name: e.group.name, courseTitle: e.group.course.title, via: 'ilmora' })
    for (const g of r.groups) if (!viaIlmora.has(g.groupId)) groups.push({ id: g.group.id, name: g.group.name, courseTitle: g.group.course.title, via: 'center' })
    const phone = r.source === 'CENTER' ? (r.phoneE164 ? formatUzPhone(r.phoneE164) : null) : r.user?.phoneE164 ? maskPhone(r.user.phoneE164) : null
    return {
      id: r.id,
      source: r.source,
      fullName: r.source === 'ILMORA' && r.user ? r.user.displayName : r.fullName,
      phone,
      birthDate,
      minor,
      institution,
      studyYear: r.studyYear ?? profile?.course ?? null,
      groups,
      parentName: r.source === 'CENTER' ? r.parentName : null,
      parentPhone: r.source === 'CENTER' && r.parentPhoneE164 ? formatUzPhone(r.parentPhoneE164) : null,
      status: r.status,
      startedOn: r.startedOn ? dateColumnToIso(r.startedOn) : null,
      archivedAt: r.archivedAt?.toISOString() ?? null,
      attendance: { ...att, percent: attendancePercent(att.attended, att.total) },
      invite: { state: inviteState(r), sends: r.inviteSends, sendsLeft: Math.max(0, INVITE_SENDS_MAX - r.inviteSends), expiresAt: r.inviteExpiresAt?.toISOString() ?? null },
      parentConsent: minor ? 'waiting' : 'adult',
      linked: !!r.userId,
    }
  }

  /** Search by name or phone and the filters of 4.2, over the loaded rows (a center's table is small). */
  private filter(rows: RosterRowDto[], q: RosterQuery): RosterRowDto[] {
    const text = q.q ? fold(q.q) : ''
    const digits = q.q ? q.q.replace(/\D/g, '') : ''
    const inst = q.institution ? fold(q.institution) : ''
    return rows.filter((r) => {
      if (text && !fold(r.fullName).includes(text) && !(digits.length >= 3 && r.source === 'CENTER' && (r.phone ?? '').replace(/\D/g, '').includes(digits))) return false
      if (q.status && r.status !== q.status) return false
      if (q.groupId && !r.groups.some((g) => g.id === q.groupId)) return false
      if (inst && !fold(r.institution?.name ?? '').includes(inst)) return false
      if (q.below !== undefined && (r.attendance.percent === null || r.attendance.percent >= q.below)) return false
      return true
    })
  }

  private async centerGroups(tenantId: string, centerId: string) {
    const groups = await this.db.group.findMany({ where: { tenantId, course: { centerId, deletedAt: null } }, select: { id: true, name: true, course: { select: { id: true, title: true } } }, orderBy: [{ courseId: 'asc' }, { name: 'asc' }] })
    return groups.map((g) => ({ id: g.id, name: g.name, courseId: g.course.id, courseTitle: g.course.title }))
  }

  async roster(tenantId: string, actor: RequestActor, q: RosterQuery) {
    const center = await this.own(tenantId, actor)
    this.assertReadable(center, actor)
    await this.syncIlmora(tenantId, center.id)
    const archive = q.archive === '1'
    const [rows, groups] = await Promise.all([this.load(tenantId, center.id, archive ? { status: 'LEFT' } : { status: { not: 'LEFT' } }), this.centerGroups(tenantId, center.id)])
    return { center: { id: center.id, name: center.name, status: center.status }, total: rows.length, rows: this.filter(rows, { ...q, status: archive ? undefined : q.status }), groups }
  }

  async detail(tenantId: string, actor: RequestActor, id: string) {
    const center = await this.own(tenantId, actor)
    this.assertReadable(center, actor)
    const [row] = await this.load(tenantId, center.id, { id })
    if (!row) throw AppError.notFound('Student')
    return { center: { id: center.id, name: center.name }, student: row }
  }

  // ───────── checks of a student's fields (form and file alike) ─────────

  private clean(raw: RawFields, today: string): { value?: CleanFields; errors: ImportRowError[] } {
    const errors: ImportRowError[] = []
    const fullName = (raw.fullName ?? '').replace(/\s+/g, ' ').trim()
    if (fullName.length < 2 || fullName.length > FULL_NAME_MAX) errors.push('fullName')
    const birth = raw.birthDate ?? ''
    if (!isCalendarDate(birth) || birth > today || birth < '1900-01-01') errors.push('birthDate')
    const minor = isCalendarDate(birth) && isMinorOn(birth, today)
    let phoneE164: string | null = null
    if (raw.phone && raw.phone.trim()) {
      const p = normalizeUzPhone(raw.phone)
      if (p.ok) phoneE164 = p.e164
      else errors.push('phone')
    } else if (!minor) errors.push('phoneRequired')
    const parentName = raw.parentName?.replace(/\s+/g, ' ').trim() || null
    let parentPhoneE164: string | null = null
    if (raw.parentPhone && raw.parentPhone.trim()) {
      const p = normalizeUzPhone(raw.parentPhone)
      if (p.ok) parentPhoneE164 = p.e164
      else errors.push('parentPhone')
    }
    // The file is not checked by the request schema: the parent's name has the same limit as the form's (№9, 20.11).
    if ((minor && (!parentName || parentName.length < 2)) || (parentName && parentName.length > FULL_NAME_MAX)) errors.push('parentName')
    if (minor && !parentPhoneE164 && !errors.includes('parentPhone')) errors.push('parentPhone')
    const studyYear = raw.studyYear ?? null
    if (studyYear !== null && (!Number.isInteger(studyYear) || studyYear < 1 || studyYear > 11)) errors.push('studyYear')
    const started = raw.startedOn ?? null
    if (started !== null && !isCalendarDate(started)) errors.push('startedOn')
    if (errors.length) return { errors }
    return { errors, value: { fullName, phoneE164, birthDate: isoToDateColumn(birth), studyYear, parentName, parentPhoneE164, startedOn: started ? isoToDateColumn(started) : null } }
  }

  /** Groups of this center only; anything else is refused as if it did not exist. */
  private async ownGroups(tenantId: string, centerId: string, ids: string[]) {
    const unique = [...new Set(ids)]
    if (!unique.length) return []
    const found = await this.db.group.findMany({ where: { tenantId, id: { in: unique }, course: { centerId, deletedAt: null } }, select: { id: true } })
    if (found.length !== unique.length) throw AppError.invalid('student_invalid', 'A group is not of this center', { errors: ['group'] })
    return unique
  }

  /** A registry institution (not merged or blocked), or null. */
  private async registryInstitution(id: string | null | undefined) {
    if (!id) return null
    const found = await this.db.institution.findFirst({ where: { id, mergedIntoId: null, blockedAt: null }, select: { id: true } })
    if (!found) throw AppError.invalid('student_invalid', 'Unknown institution', { errors: ['institution'] })
    return found.id
  }

  private institutionColumns(input: { institutionId?: string | null; institutionText?: string | null; institutionType?: RegistryInstitutionType | null }, registryId: string | null) {
    if (registryId) return { institutionId: registryId, institutionText: null, institutionType: null }
    const text = input.institutionText?.replace(/\s+/g, ' ').trim() || null
    return { institutionId: null, institutionText: text, institutionType: text ? (input.institutionType ?? null) : null }
  }

  private phoneConflict(err: unknown): never {
    if (isUnique(err) && /phone/i.test(uniqueConstraintOf(err))) throw AppError.conflict('student_phone_taken', 'A student with this phone is already in the center')
    throw err
  }

  async create(tenantId: string, actor: RequestActor, input: CenterStudentInput) {
    const center = await this.own(tenantId, actor)
    this.assertWritable(center)
    const { value, errors } = this.clean(input, todayLocal())
    if (!value) throw AppError.invalid('student_invalid', 'Some fields are not valid', { errors })
    const groupIds = await this.ownGroups(tenantId, center.id, input.groupIds ?? [])
    const inst = this.institutionColumns(input, await this.registryInstitution(input.institutionId))
    let id: string
    try {
      id = await this.prisma.tx(async (tx) => {
        const row = await tx.centerStudent.create({ data: { tenantId, centerId: center.id, source: 'CENTER', ...value, ...inst, createdById: actor.id } })
        if (groupIds.length) await tx.centerStudentGroup.createMany({ data: groupIds.map((groupId) => ({ tenantId, centerStudentId: row.id, groupId })) })
        // Who and when, never the person's name or phone.
        await this.audit.record({ tx, action: 'center.student_create', entityType: 'CenterStudent', entityId: row.id, after: { centerId: center.id, groups: groupIds.length } })
        return row.id
      })
    } catch (err) {
      this.phoneConflict(err)
    }
    return this.detail(tenantId, actor, id)
  }

  async update(tenantId: string, actor: RequestActor, id: string, patch: CenterStudentPatch) {
    const center = await this.own(tenantId, actor)
    this.assertWritable(center)
    const record = await this.db.centerStudent.findFirst({ where: { tenantId, id, centerId: center.id } })
    if (!record) throw AppError.notFound('Student')
    const { status, groupIds, ...fields } = patch
    const changed = Object.keys(patch)
    // A student who came through ILMORA keeps their own details; the center changes the status only.
    if (record.source === 'ILMORA' && (groupIds !== undefined || Object.values(fields).some((v) => v !== undefined))) {
      throw AppError.invalid('ilmora_record_readonly', 'A student who came through ILMORA keeps their own details; only the status changes here')
    }
    const data: Prisma.CenterStudentUncheckedUpdateInput = {}
    if (status !== undefined && status !== record.status) Object.assign(data, { status, archivedAt: status === 'LEFT' ? new Date() : null })
    let groups: string[] | undefined
    if (record.source === 'CENTER') {
      const merged = {
        fullName: fields.fullName ?? record.fullName,
        phone: fields.phone !== undefined ? fields.phone : record.phoneE164,
        birthDate: fields.birthDate ?? (record.birthDate ? dateColumnToIso(record.birthDate) : null),
        studyYear: fields.studyYear !== undefined ? fields.studyYear : record.studyYear,
        parentName: fields.parentName !== undefined ? fields.parentName : record.parentName,
        parentPhone: fields.parentPhone !== undefined ? fields.parentPhone : record.parentPhoneE164,
        startedOn: fields.startedOn !== undefined ? fields.startedOn : record.startedOn ? dateColumnToIso(record.startedOn) : null,
      }
      const { value, errors } = this.clean(merged, todayLocal())
      if (!value) throw AppError.invalid('student_invalid', 'Some fields are not valid', { errors })
      Object.assign(data, value)
      if (fields.institutionId !== undefined || fields.institutionText !== undefined || fields.institutionType !== undefined) {
        const input = {
          institutionId: fields.institutionId !== undefined ? fields.institutionId : record.institutionId,
          institutionText: fields.institutionText !== undefined ? fields.institutionText : record.institutionText,
          institutionType: fields.institutionType !== undefined ? fields.institutionType : (record.institutionType as RegistryInstitutionType | null),
        }
        Object.assign(data, this.institutionColumns(input, await this.registryInstitution(input.institutionId)))
      }
      if (groupIds !== undefined) groups = await this.ownGroups(tenantId, center.id, groupIds)
    }
    // A link sent to the old phone (the student's or the parent's), or to a student who has left, stops working
    // (проверка безопасности 20.11, №4). The number of sends is kept: a new link still counts against the limit.
    const phoneChanged = data.phoneE164 !== undefined && data.phoneE164 !== record.phoneE164
    const parentPhoneChanged = data.parentPhoneE164 !== undefined && data.parentPhoneE164 !== record.parentPhoneE164
    const leaving = data.status === 'LEFT'
    const dropInvite = !!record.inviteTokenHash && (phoneChanged || parentPhoneChanged || leaving)
    if (dropInvite) Object.assign(data, { inviteTokenHash: null, inviteExpiresAt: null })
    try {
      await this.prisma.tx(async (tx) => {
        await tx.centerStudent.update({ where: { id: record.id }, data })
        if (groups) {
          await tx.centerStudentGroup.deleteMany({ where: { centerStudentId: record.id, groupId: { notIn: groups } } })
          await tx.centerStudentGroup.createMany({ data: groups.map((groupId) => ({ tenantId, centerStudentId: record.id, groupId })), skipDuplicates: true })
        }
        await this.audit.record({ tx, action: 'center.student_update', entityType: 'CenterStudent', entityId: record.id, before: { status: record.status }, after: { status: status ?? record.status, fields: changed, inviteCancelled: dropInvite } })
      })
    } catch (err) {
      this.phoneConflict(err)
    }
    return this.detail(tenantId, actor, record.id)
  }

  // ───────── invitation: the center's side ─────────

  private async webOrigin(tenantId: string) {
    return (await this.tenants.byTenantId(tenantId))?.webOrigin ?? this.env.PUBLIC_WEB_URL
  }

  /**
   * A one-time link (4.3): 256 random bits, only its SHA-256 is stored, it lives 7 days, and the center may send one 3 more
   * times after the first; a new link cancels the previous one. Until there is an SMS contract the center copies the link
   * and sends it itself — to the student, or to the parent of a minor. The link is in the answer once and never again.
   */
  async invite(tenantId: string, actor: RequestActor, id: string) {
    const center = await this.own(tenantId, actor)
    this.assertApproved(center, actor)
    const record = await this.db.centerStudent.findFirst({ where: { tenantId, id, centerId: center.id } })
    if (!record) throw AppError.notFound('Student')
    if (record.source !== 'CENTER') throw AppError.invalid('invite_not_needed', 'This student already has an ILMORA account linked')
    if (record.inviteAcceptedAt) throw AppError.conflict('invite_accepted', 'The student has already accepted the invitation')
    if (record.inviteSends >= INVITE_SENDS_MAX) throw AppError.conflict('invite_limit', 'The invitation was sent the maximum number of times', { max: INVITE_SENDS_MAX })
    const minor = isMinorOn(record.birthDate ? dateColumnToIso(record.birthDate) : null, todayLocal())
    const to = minor ? record.parentPhoneE164 : record.phoneE164
    if (!to) throw AppError.invalid('invite_no_phone', minor ? 'Add the parent’s phone first' : 'Add the student’s phone first')
    const token = randomToken(32)
    const now = new Date()
    const expiresAt = new Date(now.getTime() + INVITE_TTL_DAYS * DAY)
    // Only from the state that was read: two presses at once send one link and count one send.
    const claimed = await this.db.centerStudent.updateMany({
      where: { id: record.id, inviteSends: record.inviteSends, inviteAcceptedAt: null },
      data: { inviteTokenHash: sha256(token), inviteExpiresAt: expiresAt, invitedAt: now, inviteSends: { increment: 1 } },
    })
    if (claimed.count !== 1) throw AppError.conflict('version_conflict', 'The invitation was just changed; open it again')
    const sends = record.inviteSends + 1
    await this.audit.record({ action: 'center.student_invite', entityType: 'CenterStudent', entityId: record.id, after: { sends, expiresAt, to: minor ? 'parent' : 'student' } })
    return { url: inviteUrl(await this.webOrigin(tenantId), token), expiresAt: expiresAt.toISOString(), sends, sendsLeft: Math.max(0, INVITE_SENDS_MAX - sends), to: minor ? ('parent' as const) : ('student' as const), phone: formatUzPhone(to), centerName: center.name }
  }

  // ───────── invitation: the student's side ─────────

  /** The record a token opens, or one answer for «wrong, used, expired, center not working» (no oracle for guessing). */
  private async byToken(token: string) {
    const record = await this.db.centerStudent.findFirst({
      where: { inviteTokenHash: sha256(token) },
      include: { center: { select: { id: true, name: true, status: true, deletedAt: true } }, institution: { select: { id: true, name: true, type: true } }, groups: { where: { group: { deletedAt: null } }, include: { group: { select: { name: true, course: { select: { title: true } } } } } } },
    })
    // A record in the archive (LEFT) is never taken by a link, even one still on it (№4).
    const ok = record && record.status !== 'LEFT' && !record.inviteAcceptedAt && record.inviteExpiresAt && record.inviteExpiresAt.getTime() > Date.now() && record.center.status === 'ACTIVE' && !record.center.deletedAt
    if (!ok) throw AppError.invalid('invite_invalid', 'The invitation link does not work')
    return record
  }

  /** What the link is for, so the student can check it before accepting. Signed-in students only. */
  async invitePreview(token: string) {
    const r = await this.byToken(token)
    return {
      centerName: r.center.name,
      fullName: r.fullName,
      institution: r.institution ? { id: r.institution.id, name: r.institution.name, type: r.institution.type } : r.institutionText ? { id: null, name: r.institutionText, type: r.institutionType } : null,
      studyYear: r.studyYear,
      groups: r.groups.map((g) => ({ name: g.group.name, courseTitle: g.group.course.title })),
      expiresAt: r.inviteExpiresAt!.toISOString(),
    }
  }

  /**
   * The student accepts (4.3, steps 3–4): the record is linked to their account, the place of study is what they
   * confirmed, the link stops working. One account per center: a student who is already on this center's list (added
   * by the center) cannot take a second record; a record that came through ILMORA gives way to the center's one.
   */
  async acceptInvite(tenantId: string, actor: RequestActor, body: InviteAcceptBody) {
    const record = await this.byToken(body.token)
    const existing = await this.db.centerStudent.findFirst({ where: { tenantId, centerId: record.centerId, userId: actor.id }, select: { id: true, source: true } })
    if (existing && existing.source === 'CENTER') throw AppError.conflict('invite_already_member', 'You are already on this center’s list')
    const study: Prisma.CenterStudentUncheckedUpdateInput = {}
    if (body.institutionId !== undefined || body.institutionText !== undefined || body.institutionType !== undefined) {
      Object.assign(study, this.institutionColumns(body, await this.registryInstitution(body.institutionId)))
    }
    if (body.studyYear !== undefined) study.studyYear = body.studyYear
    const now = new Date()
    await this.prisma.tx(async (tx) => {
      if (existing) await tx.centerStudent.delete({ where: { id: existing.id } })
      const claimed = await tx.centerStudent.updateMany({
        where: { id: record.id, status: { not: 'LEFT' }, inviteTokenHash: sha256(body.token), inviteAcceptedAt: null, inviteExpiresAt: { gt: now } },
        data: { ...study, userId: actor.id, inviteAcceptedAt: now, inviteTokenHash: null },
      })
      if (claimed.count !== 1) throw AppError.invalid('invite_invalid', 'The invitation link does not work')
      await this.audit.record({ tx, action: 'center.student_invite_accept', entityType: 'CenterStudent', entityId: record.id, after: { centerId: record.centerId, userId: actor.id, replaced: existing?.id ?? null } })
    })
    return { ok: true as const, centerName: record.center.name }
  }

  /** The student's own records at centers (their cabinet): where they study, the groups, and «leave». */
  async myCenters(tenantId: string, actor: RequestActor) {
    const rows = await this.db.centerStudent.findMany({
      where: { tenantId, userId: actor.id, status: { not: 'LEFT' }, center: { deletedAt: null } },
      include: { center: { select: { id: true, name: true } }, institution: { select: { name: true, type: true } }, groups: { where: { group: { deletedAt: null } }, include: { group: { select: { id: true, name: true, course: { select: { title: true } } } } } } },
      orderBy: { createdAt: 'asc' },
    })
    return rows.map((r) => ({
      id: r.id, source: r.source, status: r.status, center: r.center,
      institution: r.institution ? { name: r.institution.name, type: r.institution.type } : r.institutionText ? { name: r.institutionText, type: r.institutionType } : null,
      studyYear: r.studyYear, groups: r.groups.map((g) => ({ id: g.group.id, name: g.group.name, courseTitle: g.group.course.title })),
    }))
  }

  /** The student leaves a center (4.3): the record goes to the center's archive, its history stays. */
  async leave(tenantId: string, actor: RequestActor, id: string) {
    const record = await this.db.centerStudent.findFirst({ where: { tenantId, id, userId: actor.id } })
    if (!record) throw AppError.notFound('Center record')
    if (record.status !== 'LEFT') {
      await this.db.centerStudent.update({ where: { id: record.id }, data: { status: 'LEFT', archivedAt: new Date() } })
      await this.audit.record({ action: 'center.student_leave', entityType: 'CenterStudent', entityId: record.id, before: { status: record.status }, after: { status: 'LEFT' } })
    }
    return { ok: true as const }
  }

  // ───────── Excel ─────────

  private rowCells(r: RosterRowDto, lang: Lang): Cell[] {
    const t = (k: TKey) => translate(lang, k)
    return [
      r.fullName, r.phone ?? '', ddmmyyyy(r.birthDate), r.institution?.name ?? '', r.studyYear ?? '',
      r.groups.map((g) => `${pick(lang, g.courseTitle as L)} / ${g.name}`).join(`${GROUPS_SEPARATOR} `),
      r.parentName ?? '', r.parentPhone ?? '', ddmmyyyy(r.startedOn),
      t(`cs.status.${r.status}` as TKey), t(`cs.source.${r.source}` as TKey), r.attendance.percent ?? '', t(`cs.invite.${r.invite.state}` as TKey), t(r.parentConsent === 'adult' ? 'cs.consent.adult' : 'cs.consent.waiting'),
    ]
  }

  /**
   * The table (or the empty template) as .xlsx (4.2, 11): the center's administrator and the Super Admin only, never a
   * teacher; every download is in the audit log with the number of rows. Cells are text, never formulas (buildXlsx).
   */
  async exportFile(tenantId: string, actor: RequestActor, q: RosterExportQuery): Promise<{ file: Buffer; filename: string; rows: number }> {
    const center = await this.own(tenantId, actor)
    this.assertReadable(center, actor)
    const lang = q.lang
    const template = q.template === '1'
    const header = [...IMPORT_COLUMNS.map((c) => translate(lang, c.label as TKey)), ...(template ? [] : EXPORT_EXTRA_COLUMNS.map((c) => translate(lang, c.label as TKey)))]
    let cells: Cell[][] = []
    if (!template) {
      await this.syncIlmora(tenantId, center.id)
      const archive = q.archive === '1'
      const rows = await this.load(tenantId, center.id, archive ? { status: 'LEFT' } : { status: { not: 'LEFT' } })
      cells = this.filter(rows, { ...q, status: archive ? undefined : q.status }).map((r) => this.rowCells(r, lang))
    }
    const file = buildXlsx(translate(lang, 'center.students'), header, cells)
    await this.audit.record({ action: 'center.students_export', entityType: 'Center', entityId: center.id, after: { rows: cells.length, template, lang, filters: { q: !!q.q, status: q.status ?? null, groupId: q.groupId ?? null, below: q.below ?? null, archive: q.archive === '1' } } })
    return { file, filename: `ilmora-${template ? 'shablon' : 'talabalar'}-${todayLocal()}.xlsx`, rows: cells.length }
  }

  /** Header cell → column: the label in any of the three languages, without the «*» of required columns. */
  private columnsOf(header: string[]): Map<number, ImportColumnKey> {
    const byLabel = new Map<string, ImportColumnKey>()
    for (const c of IMPORT_COLUMNS) for (const lang of ['uz', 'ru', 'en'] as const) byLabel.set(fold(translate(lang, c.label as TKey).replace(/\*/g, '')), c.key)
    const out = new Map<number, ImportColumnKey>()
    header.forEach((h, i) => {
      const key = byLabel.get(fold(h.replace(/\*/g, '')))
      if (key && ![...out.values()].includes(key)) out.set(i, key)
    })
    return out
  }

  /**
   * Reads and checks a file without writing anything: every row with its errors (4.2 «предпросмотр и ошибки по каждой
   * строке»). A file of more than 1000 rows, or one that is not an .xlsx of the template, is refused whole.
   */
  private async parseImport(tenantId: string, centerId: string, base64: string) {
    const buf = Buffer.from(base64, 'base64')
    if (buf.length > IMPORT_MAX_BYTES) throw AppError.invalid('import_bad_file', 'The file is too big')
    let sheet: { row: number; cells: string[] }[]
    try {
      sheet = readXlsxRows(buf, { ...DEFAULT_XLSX_LIMITS, maxBytes: IMPORT_MAX_BYTES, maxRows: IMPORT_MAX_ROWS + 1 })
    } catch (err) {
      if (err instanceof XlsxReadError && err.reason === 'too_many_rows') throw AppError.invalid('import_too_many_rows', 'Too many rows', { max: IMPORT_MAX_ROWS })
      if (err instanceof XlsxReadError) throw AppError.invalid('import_bad_file', 'Not an .xlsx file of the template')
      throw err
    }
    const [header, ...data] = sheet
    const columns = header ? this.columnsOf(header.cells) : new Map<number, ImportColumnKey>()
    const has = (k: ImportColumnKey) => [...columns.values()].includes(k)
    if (!has('fullName') || !has('birthDate') || !data.length) throw AppError.invalid('import_bad_file', 'Not an .xlsx file of the template')

    const groups = await this.centerGroups(tenantId, centerId)
    const byName = new Map<string, string[]>()
    const byFull = new Map<string, string>()
    for (const g of groups) {
      byName.set(fold(g.name), [...(byName.get(fold(g.name)) ?? []), g.id])
      for (const lang of ['uz', 'ru', 'en'] as const) byFull.set(`${fold(pick(lang, g.courseTitle as L))}/${fold(g.name)}`, g.id)
    }
    const taken = new Set((await this.db.centerStudent.findMany({ where: { tenantId, centerId, phoneE164: { not: null } }, select: { phoneE164: true } })).map((r) => r.phoneE164))
    const values = data.map((r) => {
      const v: Partial<Record<ImportColumnKey, string>> = {}
      for (const [i, key] of columns) v[key] = r.cells[i] ?? ''
      return { row: r.row, v }
    })
    // A name typed in the file links the registry record when exactly one record has that name.
    const keys = [...new Set(values.map((x) => registrySearchKey(x.v.institution ?? '')).filter(Boolean))]
    const registry = keys.length ? await this.db.institution.findMany({ where: { searchKey: { in: keys }, mergedIntoId: null, blockedAt: null }, select: { id: true, searchKey: true } }) : []
    const registryOf = new Map<string, string | null>()
    for (const r of registry) registryOf.set(r.searchKey, registryOf.has(r.searchKey) ? null : r.id)

    const today = todayLocal()
    const seen = new Set<string>()
    return values.map(({ row, v }) => {
      const yearText = (v.studyYear ?? '').trim()
      const yearMatch = yearText.match(/^\D*?(\d{1,2})(\D.*)?$/)
      const studyYear = yearText === '' ? null : yearMatch ? Number(yearMatch[1]) : NaN
      const startedText = (v.startedOn ?? '').trim()
      const { value, errors } = this.clean({
        fullName: v.fullName, phone: v.phone, birthDate: parseSheetDate(v.birthDate) ?? (v.birthDate ? 'x' : ''), studyYear,
        parentName: v.parentName, parentPhone: v.parentPhone, startedOn: startedText ? (parseSheetDate(startedText) ?? 'x') : null,
      }, today)
      // A phone already in the center or twice in the file — said even when the row has other errors too.
      const phone = v.phone?.trim() ? normalizeUzPhone(v.phone) : null
      if (phone?.ok) {
        if (taken.has(phone.e164)) errors.push('phoneTaken')
        else if (seen.has(phone.e164)) errors.push('phoneTwice')
        seen.add(phone.e164)
      }
      const institutionText = (v.institution ?? '').replace(/\s+/g, ' ').trim()
      if (institutionText.length > 200) errors.push('institution')
      const groupIds: string[] = []
      for (const token of (v.groups ?? '').split(GROUPS_SEPARATOR).map((x) => x.trim()).filter(Boolean)) {
        const slash = token.lastIndexOf('/')
        const id = slash > 0 ? byFull.get(`${fold(token.slice(0, slash))}/${fold(token.slice(slash + 1))}`) : undefined
        const named = slash > 0 ? (id ? [id] : []) : byName.get(fold(token)) ?? []
        if (named.length === 1) groupIds.push(named[0])
        else if (!errors.includes(named.length ? 'groupAmbiguous' : 'group')) errors.push(named.length ? 'groupAmbiguous' : 'group')
      }
      const registryId = institutionText ? registryOf.get(registrySearchKey(institutionText)) ?? null : null
      return { row, fullName: (v.fullName ?? '').trim(), errors, value: errors.length ? undefined : value, groupIds: [...new Set(groupIds)], institution: this.institutionColumns({ institutionText }, registryId) }
    })
  }

  /** Check only: rows and their errors, nothing written. The check is in the audit log too (a file was read). */
  async importCheck(tenantId: string, actor: RequestActor, base64: string) {
    const center = await this.own(tenantId, actor)
    // Only an approved center reads a file in (проверка безопасности 20.11, №1): a center registers itself.
    this.assertApproved(center, actor)
    const rows = await this.parseImport(tenantId, center.id, base64)
    const bad = rows.filter((r) => r.errors.length)
    await this.audit.record({ action: 'center.students_import_check', entityType: 'Center', entityId: center.id, after: { rows: rows.length, errors: bad.length } })
    return { total: rows.length, ready: rows.length - bad.length, errors: bad.map((r) => ({ row: r.row, fullName: r.fullName, errors: r.errors })) }
  }

  /**
   * Writes the file (4.2): only a file without errors, and all of it in one transaction — no partial write. A phone taken
   * in the meantime fails the whole file (409), nothing is written.
   */
  async importCommit(tenantId: string, actor: RequestActor, base64: string) {
    const center = await this.own(tenantId, actor)
    // Only an approved center reads a file in (проверка безопасности 20.11, №1): a center registers itself.
    this.assertApproved(center, actor)
    const rows = await this.parseImport(tenantId, center.id, base64)
    const bad = rows.filter((r) => r.errors.length)
    if (bad.length) throw AppError.invalid('import_has_errors', 'The file has rows with errors; nothing was written', { errors: bad.map((r) => ({ row: r.row, errors: r.errors })) })
    const prepared = rows.map((r) => ({ id: randomUUID(), ...r }))
    try {
      await this.prisma.tx(async (tx) => {
        await tx.centerStudent.createMany({ data: prepared.map((r) => ({ id: r.id, tenantId, centerId: center.id, source: 'CENTER' as const, ...r.value!, ...r.institution, createdById: actor.id })) })
        const links = prepared.flatMap((r) => r.groupIds.map((groupId) => ({ tenantId, centerStudentId: r.id, groupId })))
        if (links.length) await tx.centerStudentGroup.createMany({ data: links })
        await this.audit.record({ tx, action: 'center.students_import', entityType: 'Center', entityId: center.id, after: { rows: prepared.length, groups: links.length } })
      }, { timeoutMs: 30_000 })
    } catch (err) {
      this.phoneConflict(err)
    }
    return { created: prepared.length }
  }
}
