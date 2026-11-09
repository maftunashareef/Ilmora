import { Injectable } from '@nestjs/common'
import {
  INSTITUTION_REVIEW_FIELDS, type InstitutionClaimResult, type InstitutionPassportDto, type InstitutionRequiredField, type L,
  normalizeUzPhone, registrySearchKey,
} from '@ilmora/shared'
import { AppError } from '../../common/errors'
import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infra/prisma/prisma.service'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { NotificationsService } from '../notifications/notifications.service'
import { DIRECTION_WITH_MAIN, isUniqueViolation, mainOf } from '../registry/registry.mappers'
import type { ClaimInput, DirectionsInput, InstitutionPatch } from './institutions.schemas'

const PASSPORT_SELECT = {
  id: true, type: true, ownership: true, name: true, stir: true, address: true, phone: true, email: true, website: true, directorName: true,
  status: true, rejectReason: true, submittedAt: true, approvedAt: true, regionId: true, districtId: true,
  region: { select: { id: true, name: true } },
  district: { select: { id: true, name: true } },
  directions: { select: { id: true, department: true, studentsCount: true, direction: { select: DIRECTION_WITH_MAIN } }, orderBy: { createdAt: 'asc' } },
  representative: { select: { displayName: true, jobTitle: true } },
} as const satisfies Prisma.InstitutionSelect

type PassportRow = Prisma.InstitutionGetPayload<{ select: typeof PASSPORT_SELECT }>

const iso = (d: Date | null) => d?.toISOString() ?? null
/** While the first review is pending the ministry looks at exactly this version: nothing changes under it. */
const isLocked = (r: { status: string; approvedAt: Date | null }) => r.status === 'PENDING' && !r.approvedAt

function toPassport(r: PassportRow): InstitutionPassportDto {
  const directions = r.directions.map((d) => ({ id: d.id, direction: mainOf(d.direction), department: d.department, studentsCount: d.studentsCount }))
  return {
    id: r.id, type: r.type, ownership: r.ownership, name: r.name, stir: r.stir,
    region: r.region ? { id: r.region.id, name: r.region.name as L } : null,
    district: r.district ? { id: r.district.id, name: r.district.name as L } : null,
    address: r.address, phone: r.phone, email: r.email, website: r.website, directorName: r.directorName,
    status: r.status, rejectReason: r.rejectReason, submittedAt: iso(r.submittedAt), approvedAt: iso(r.approvedAt),
    workspaceOpen: r.approvedAt !== null,
    editable: !isLocked(r),
    directions,
    totals: { students: directions.reduce((n, d) => n + d.studentsCount, 0), directions: directions.length },
    representative: { name: r.representative?.displayName ?? '', jobTitle: r.representative?.jobTitle ?? null },
  }
}

/**
 * Required fields of ТЗ 4.2 «Паспорт учреждения», checked on submit (a draft is saved in parts). The district is
 * required only once the region has districts in the reference data: districts are loaded from the official list only.
 */
function missingFields(r: PassportRow, regionHasDistricts: boolean): InstitutionRequiredField[] {
  const missing: InstitutionRequiredField[] = []
  const need = (ok: unknown, field: InstitutionRequiredField) => { if (!ok) missing.push(field) }
  need(r.type, 'type'); need(r.ownership, 'ownership'); need(r.name, 'name'); need(r.stir, 'stir')
  need(r.regionId, 'regionId'); need(r.districtId || !regionHasDistricts, 'districtId'); need(r.address, 'address'); need(r.phone, 'phone'); need(r.directorName, 'directorName')
  need(r.directions.length > 0, 'directions')
  need(r.representative?.displayName?.trim(), 'representativeName'); need(r.representative?.jobTitle?.trim(), 'representativeJobTitle')
  return missing
}

/**
 * The institution's own profile (ТЗ 4.2): claim by STIR, the passport, the directions, submit to the ministry.
 *
 * The institution an account represents is read from the database (`User.institutionId`, unique), never from the
 * request or the token, so a fresh claim works before the access token is renewed. One STIR — one representative:
 * the unique indexes on `Institution.stir` and `User.institutionId` hold it, the code only turns a lost race into 409.
 */
@Injectable()
export class InstitutionsService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly notifications: NotificationsService) {}

  /**
   * ТЗ 4.2 steps 2–3. A STIR from the registry that nobody represents yet: the record is taken over as a draft with its
   * data filled in. A STIR somebody already represents: 409 «write to support» — nobody takes over someone else's
   * institution. A STIR not in the registry: a new record, which needs the type and the name.
   */
  async claim(tenantId: string, actor: RequestActor, input: ClaimInput): Promise<InstitutionClaimResult> {
    // RolesGuard lets the Super Admin through every route; an institution is represented by its own account only.
    if (!actor.roles.includes('INSTITUTION_ADMIN')) throw AppError.forbidden('Only an institution account can claim an institution')
    if (await this.representedId(actor)) throw AppError.conflict('already_has_institution', 'This account already represents an institution')
    const alreadyClaimed = () => AppError.conflict('already_claimed', 'This institution is already registered. Write to support if it is yours.')

    const existing = await this.prisma.client.institution.findFirst({ where: { stir: input.stir }, select: { id: true, status: true, mergedIntoId: true, representative: { select: { id: true } } } })
    if (existing) {
      if (existing.representative || existing.status !== 'UNCLAIMED' || existing.mergedIntoId) throw alreadyClaimed()
      try {
        await this.prisma.client.$transaction(async (tx) => {
          // Only while still UNCLAIMED: of two people claiming one STIR at once, exactly one wins.
          const taken = await tx.institution.updateMany({ where: { id: existing.id, status: 'UNCLAIMED' }, data: { status: 'DRAFT' } })
          if (taken.count !== 1) throw alreadyClaimed()
          await tx.user.update({ where: { id: actor.id }, data: { institutionId: existing.id } })
        })
      } catch (err) {
        if (isUniqueViolation(err)) throw alreadyClaimed()
        throw err
      }
      await this.audit.record({ action: 'institution.claim', entityType: 'Institution', entityId: existing.id, after: { stir: input.stir, representativeId: actor.id } })
      return { institution: await this.passportOf(existing.id), created: false }
    }

    if (!input.type || !input.name) throw AppError.invalid('institution_details_required', 'This STIR is not in the registry: enter the type and the name of the institution')
    let createdId: string
    try {
      createdId = await this.prisma.client.$transaction(async (tx) => {
        const row = await tx.institution.create({
          data: { tenantId, stir: input.stir, type: input.type!, name: input.name!, searchKey: registrySearchKey(input.name!), source: 'SELF', status: 'DRAFT', createdById: actor.id },
          select: { id: true },
        })
        await tx.user.update({ where: { id: actor.id }, data: { institutionId: row.id } })
        return row.id
      })
    } catch (err) {
      if (isUniqueViolation(err)) throw alreadyClaimed()
      throw err
    }
    await this.audit.record({ action: 'institution.create', entityType: 'Institution', entityId: createdId, after: { stir: input.stir, type: input.type, name: input.name, representativeId: actor.id } })
    return { institution: await this.passportOf(createdId), created: true }
  }

  async passport(actor: RequestActor): Promise<InstitutionPassportDto> {
    return this.passportOf(await this.ownId(actor))
  }

  /**
   * Saves the profile in parts (ТЗ 4.2). Locked while the first review is pending. After approval, a change of the
   * name, STIR, type, ownership or region sends the profile back to the ministry (status PENDING, `approvedAt` stays,
   * the workspace keeps working); the other fields change at once. Every change is written to the audit log.
   */
  async update(tenantId: string, actor: RequestActor, input: InstitutionPatch): Promise<InstitutionPassportDto> {
    const id = await this.ownId(actor)
    const current = await this.prisma.client.institution.findFirstOrThrow({ where: { id }, select: { ...PASSPORT_SELECT, representative: { select: { id: true, displayName: true, jobTitle: true } } } })
    if (isLocked(current)) throw AppError.conflict('under_review', 'The profile is with the ministry; wait for the decision')

    const data: Prisma.InstitutionUncheckedUpdateInput = {}
    if (input.type !== undefined) data.type = input.type
    if (input.ownership !== undefined) data.ownership = input.ownership
    if (input.name !== undefined) Object.assign(data, { name: input.name, searchKey: registrySearchKey(input.name) })
    if (input.stir !== undefined) data.stir = input.stir
    if (input.address !== undefined) data.address = input.address || null
    if (input.email !== undefined) data.email = input.email || null
    if (input.website !== undefined) data.website = input.website || null
    if (input.directorName !== undefined) data.directorName = input.directorName || null
    if (input.phone !== undefined) {
      if (input.phone === null || input.phone === '') data.phone = null
      else {
        const parsed = normalizeUzPhone(input.phone)
        if (!parsed.ok) throw AppError.invalid('invalid_phone', 'Invalid phone number format (+998...)')
        data.phone = parsed.e164
      }
    }
    if (input.regionId !== undefined || input.districtId !== undefined) Object.assign(data, await this.place(current, input))

    const changed = Object.keys(data).filter((k) => k !== 'searchKey' && (data as Record<string, unknown>)[k] !== (current as Record<string, unknown>)[k])
    const backToReview = current.approvedAt !== null && current.status !== 'PENDING' && INSTITUTION_REVIEW_FIELDS.some((f) => changed.includes(f))
    const now = new Date()
    if (backToReview) Object.assign(data, { status: 'PENDING', submittedAt: now, rejectReason: null })

    const rep = input.representative ?? {}
    const repData = { ...(rep.name !== undefined ? { displayName: rep.name } : {}), ...(rep.jobTitle !== undefined ? { jobTitle: rep.jobTitle } : {}) }
    try {
      await this.prisma.client.$transaction(async (tx) => {
        if (Object.keys(data).length) await tx.institution.update({ where: { id }, data })
        if (Object.keys(repData).length) await tx.user.update({ where: { id: actor.id }, data: repData })
      })
    } catch (err) {
      if (isUniqueViolation(err)) throw AppError.conflict('stir_taken', 'Another institution is registered with this STIR')
      throw err
    }

    if (changed.length || Object.keys(repData).length) {
      const pick = (o: object, keys: string[]) => Object.fromEntries(keys.map((k) => [k, (o as Record<string, unknown>)[k]]))
      await this.audit.record({
        action: backToReview ? 'institution.update.review' : 'institution.update', entityType: 'Institution', entityId: id,
        before: { ...pick(current, changed), ...(Object.keys(repData).length ? { representative: current.representative } : {}) },
        after: { ...pick(data, changed), ...(Object.keys(repData).length ? { representative: repData } : {}) },
      })
    }
    if (backToReview) await this.notifyMinistry(tenantId, id, current.name, 'institution.changed', `inst-review:${id}:${now.getTime()}`)
    return this.passportOf(id)
  }

  /**
   * Replaces the list of directions (ТЗ 4.2): each from the shared dictionary (an alias becomes its main direction),
   * once per institution, with its number of students. Changes at once, also after approval; written to the audit log.
   */
  async setDirections(tenantId: string, actor: RequestActor, input: DirectionsInput): Promise<InstitutionPassportDto> {
    const id = await this.ownId(actor)
    const current = await this.prisma.client.institution.findFirstOrThrow({ where: { id }, select: { status: true, approvedAt: true, directions: { select: { directionId: true, department: true, studentsCount: true } } } })
    if (isLocked(current)) throw AppError.conflict('under_review', 'The profile is with the ministry; wait for the decision')

    const ids = [...new Set(input.directions.map((d) => d.directionId))]
    const found = await this.prisma.client.direction.findMany({ where: { id: { in: ids } }, select: { id: true, mergedIntoId: true } })
    const mainId = new Map(found.map((d) => [d.id, d.mergedIntoId ?? d.id]))
    const unknown = ids.filter((d) => !mainId.has(d))
    if (unknown.length) throw AppError.invalid('invalid_direction', 'Choose directions from the list', { unknown })
    const rows = input.directions.map((d) => ({ directionId: mainId.get(d.directionId)!, department: d.department ?? null, studentsCount: d.studentsCount }))
    if (new Set(rows.map((r) => r.directionId)).size !== rows.length) throw AppError.invalid('direction_listed_twice', 'Each direction can be listed once')

    await this.prisma.client.$transaction(async (tx) => {
      await tx.institutionDirection.deleteMany({ where: { institutionId: id } })
      if (rows.length) await tx.institutionDirection.createMany({ data: rows.map((r) => ({ tenantId, institutionId: id, ...r })) })
    })
    await this.audit.record({ action: 'institution.directions', entityType: 'Institution', entityId: id, before: current.directions, after: rows })
    return this.passportOf(id)
  }

  /** ТЗ 4.2 step 5: DRAFT or REJECTED → PENDING when every required field is filled; the ministry is notified. */
  async submit(tenantId: string, actor: RequestActor): Promise<InstitutionPassportDto> {
    const id = await this.ownId(actor)
    const current = await this.prisma.client.institution.findFirstOrThrow({ where: { id }, select: PASSPORT_SELECT })
    if (current.status === 'PENDING') throw AppError.conflict('already_submitted', 'The profile is already with the ministry')
    if (current.status === 'APPROVED') throw AppError.conflict('already_approved', 'The profile is approved; changes of key fields go to the ministry by themselves')
    const regionHasDistricts = current.regionId ? (await this.prisma.client.district.count({ where: { regionId: current.regionId } })) > 0 : false
    const missing = missingFields(current, regionHasDistricts)
    if (missing.length) throw AppError.invalid('incomplete_profile', 'Fill in the required fields', { missing })

    const now = new Date()
    const moved = await this.prisma.client.institution.updateMany({ where: { id, status: { in: ['DRAFT', 'REJECTED'] } }, data: { status: 'PENDING', submittedAt: now, rejectReason: null } })
    if (moved.count !== 1) throw AppError.conflict('already_submitted', 'The profile is already with the ministry')
    await this.audit.record({ action: 'institution.submit', entityType: 'Institution', entityId: id, before: { status: current.status }, after: { status: 'PENDING' } })
    await this.notifyMinistry(tenantId, id, current.name, 'institution.submitted', `inst-review:${id}:${now.getTime()}`)
    return this.passportOf(id)
  }

  // ───────────── helpers ─────────────

  private async representedId(actor: RequestActor): Promise<string | null> {
    const user = await this.prisma.client.user.findFirst({ where: { id: actor.id }, select: { institutionId: true } })
    return user?.institutionId ?? null
  }

  /** The institution this account represents; none reads as «not found», never as someone else's. */
  private async ownId(actor: RequestActor): Promise<string> {
    const id = await this.representedId(actor)
    if (!id) throw AppError.notFound('Institution')
    return id
  }

  private async passportOf(id: string): Promise<InstitutionPassportDto> {
    return toPassport(await this.prisma.client.institution.findFirstOrThrow({ where: { id }, select: PASSPORT_SELECT }))
  }

  /** Region and district from the lists; a district must lie in the region. A new region without a district clears the old one. */
  private async place(current: { regionId: string | null; districtId: string | null }, input: InstitutionPatch) {
    const regionId = input.regionId !== undefined ? input.regionId : current.regionId
    let districtId = input.districtId !== undefined ? input.districtId : current.districtId
    if (regionId && !(await this.prisma.client.region.findFirst({ where: { id: regionId }, select: { id: true } }))) throw AppError.invalid('invalid_region', 'Choose a region from the list')
    if (districtId) {
      const district = await this.prisma.client.district.findFirst({ where: { id: districtId }, select: { regionId: true } })
      if (!district) throw AppError.invalid('invalid_district', 'Choose a district of the selected region')
      if (district.regionId !== regionId) {
        if (input.districtId !== undefined) throw AppError.invalid('invalid_district', 'Choose a district of the selected region')
        districtId = null
      }
    }
    return { regionId, districtId }
  }

  /** ТЗ 6: a new or changed profile goes to every active ministry account. */
  private async notifyMinistry(tenantId: string, institutionId: string, institutionName: string, type: 'institution.submitted' | 'institution.changed', dedupeKey: string) {
    await this.notifications.safely(type, async () => {
      const ministry = await this.prisma.client.user.findMany({ where: { roles: { has: 'MINISTRY' }, isActive: true }, select: { id: true } })
      await this.notifications.notify({ tenantId, userIds: ministry.map((u) => u.id), type, params: { institutionName, institutionId }, dedupeKey })
    })
  }
}
