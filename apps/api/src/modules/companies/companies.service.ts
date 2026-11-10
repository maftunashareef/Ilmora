import { Injectable } from '@nestjs/common'
import { COMPANY_REVIEW_FIELDS, type CompanyProfileDto, type CompanyRequiredField, type DocumentLinkDto, type DocumentUploadDto, type L, registrySearchKey } from '@ilmora/shared'
import { AppError } from '../../common/errors'
import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infra/prisma/prisma.service'
import { DOC_LINK_SECONDS, PrivateDocsService } from '../../infra/storage/private-docs.service'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { NotificationsService } from '../notifications/notifications.service'
import { DIRECTION_WITH_MAIN, INDUSTRY_SELECT, isUniqueViolation, mainOf, regionIdByRef, toIndustry } from '../registry/registry.mappers'
import type { CertificateConfirmInput, CertificateUploadInput, CompanyCreateInput, CompanyPatch } from './companies.schemas'

export const PROFILE_SELECT = {
  id: true, stir: true, name: true, address: true, website: true, about: true, certificateFileKey: true,
  status: true, rejectReason: true, submittedAt: true, approvedAt: true, regionId: true, districtId: true,
  region: { select: { id: true, slug: true, name: true } },
  district: { select: { id: true, name: true } },
  industries: { select: { industry: { select: { ...INDUSTRY_SELECT, sortOrder: true } } } },
  directions: { select: { direction: { select: DIRECTION_WITH_MAIN } } },
  representative: { select: { id: true, displayName: true, jobTitle: true, email: true } },
} as const satisfies Prisma.CompanySelect

type ProfileRow = Prisma.CompanyGetPayload<{ select: typeof PROFILE_SELECT }>

const iso = (d: Date | null) => d?.toISOString() ?? null
const isLocked = (r: { status: string; approvedAt: Date | null }) => r.status === 'PENDING' && !r.approvedAt
const certPrefix = (tenantId: string, companyId: string) => `company-certs/${tenantId}/${companyId}/`

export function toProfile(r: ProfileRow): CompanyProfileDto {
  const directions = [...new Map(r.directions.map((d) => mainOf(d.direction)).map((d) => [d.id, d])).values()]
  return {
    id: r.id, stir: r.stir, name: r.name,
    region: r.region ? { id: r.region.id, slug: r.region.slug, name: r.region.name as L } : null,
    district: r.district ? { id: r.district.id, name: r.district.name as L } : null,
    address: r.address, website: r.website, about: r.about,
    industries: r.industries.map((i) => i.industry).sort((a, b) => a.sortOrder - b.sortOrder).map(toIndustry),
    directions,
    certificateUploaded: r.certificateFileKey !== null,
    status: r.status, rejectReason: r.rejectReason, submittedAt: iso(r.submittedAt), approvedAt: iso(r.approvedAt),
    workspaceOpen: r.approvedAt !== null,
    editable: !isLocked(r),
    representative: { name: r.representative?.displayName ?? '', jobTitle: r.representative?.jobTitle ?? null, email: r.representative?.email ?? null },
  }
}

function missingFields(r: ProfileRow): CompanyRequiredField[] {
  const missing: CompanyRequiredField[] = []
  const need = (ok: unknown, f: CompanyRequiredField) => { if (!ok) missing.push(f) }
  need(r.stir, 'stir'); need(r.name, 'name'); need(r.regionId, 'regionId'); need(r.address, 'address')
  need(r.industries.length > 0, 'industries'); need(r.certificateFileKey, 'certificate')
  need(r.representative?.displayName?.trim(), 'representativeName'); need(r.representative?.jobTitle?.trim(), 'representativeJobTitle')
  return missing
}

/**
 * The company's own profile (ТЗ 4.3): STIR and name, the profile with industries, the state-registration certificate
 * (private bucket), submit to the Super Admin. One STIR — one company, one company — one representative: the unique
 * indexes hold it, the code turns a lost race into 409. The company of an account is read from the database
 * (`User.companyId`), never from the request or the token. ILMORA is free for companies.
 */
@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly docs: PrivateDocsService,
  ) {}

  async create(tenantId: string, actor: RequestActor, input: CompanyCreateInput): Promise<CompanyProfileDto> {
    // RolesGuard lets the Super Admin through every route; a company is represented by its own account only.
    if (!actor.roles.includes('COMPANY_ADMIN')) throw AppError.forbidden('Only a company account can register a company')
    if (await this.representedId(actor)) throw AppError.conflict('already_has_company', 'This account already represents a company')
    let id: string
    try {
      id = await this.prisma.client.$transaction(async (tx) => {
        const row = await tx.company.create({ data: { tenantId, stir: input.stir, name: input.name, searchKey: registrySearchKey(input.name) }, select: { id: true } })
        await tx.user.update({ where: { id: actor.id }, data: { companyId: row.id } })
        return row.id
      })
    } catch (err) {
      if (isUniqueViolation(err)) throw AppError.conflict('company_registered', 'A company with this STIR is already registered. Write to support if it is yours.')
      throw err
    }
    await this.audit.record({ action: 'company.create', entityType: 'Company', entityId: id, after: { stir: input.stir, name: input.name, representativeId: actor.id } })
    return this.profileOf(id)
  }

  async profile(actor: RequestActor): Promise<CompanyProfileDto> {
    return this.profileOf(await this.ownId(actor))
  }

  /**
   * Saves the profile in parts. Locked while the first review is pending. After approval a change of the STIR or the
   * name sends the profile back to review (the workspace keeps working); the rest changes at once. Audited.
   */
  async update(tenantId: string, actor: RequestActor, input: CompanyPatch): Promise<CompanyProfileDto> {
    const id = await this.ownId(actor)
    const current = await this.prisma.client.company.findFirstOrThrow({ where: { id }, select: PROFILE_SELECT })
    if (isLocked(current)) throw AppError.conflict('under_review', 'The profile is under review; wait for the decision')

    const data: Prisma.CompanyUncheckedUpdateInput = {}
    if (input.stir !== undefined) data.stir = input.stir
    if (input.name !== undefined) Object.assign(data, { name: input.name, searchKey: registrySearchKey(input.name) })
    if (input.address !== undefined) data.address = input.address || null
    if (input.website !== undefined) data.website = input.website || null
    if (input.about !== undefined) data.about = input.about || null
    if (input.regionId !== undefined || input.districtId !== undefined) Object.assign(data, await this.place(current, input))
    const industryIds = input.industryIds !== undefined ? await this.checkedIndustries(input.industryIds) : undefined
    const directionIds = input.directionIds !== undefined ? await this.mainDirections(input.directionIds) : undefined

    const changed = Object.keys(data).filter((k) => k !== 'searchKey' && (data as Record<string, unknown>)[k] !== (current as Record<string, unknown>)[k])
    const backToReview = current.approvedAt !== null && current.status !== 'PENDING' && COMPANY_REVIEW_FIELDS.some((f) => changed.includes(f))
    const now = new Date()
    if (backToReview) Object.assign(data, { status: 'PENDING', submittedAt: now, rejectReason: null })
    const rep = input.representative ?? {}
    const repData = {
      ...(rep.name !== undefined ? { displayName: rep.name } : {}),
      ...(rep.jobTitle !== undefined ? { jobTitle: rep.jobTitle } : {}),
      ...(rep.email !== undefined ? { email: rep.email } : {}),
    }

    try {
      await this.prisma.client.$transaction(async (tx) => {
        if (Object.keys(data).length) await tx.company.update({ where: { id }, data })
        if (industryIds) {
          await tx.companyIndustry.deleteMany({ where: { companyId: id } })
          if (industryIds.length) await tx.companyIndustry.createMany({ data: industryIds.map((industryId) => ({ companyId: id, industryId })) })
        }
        if (directionIds) {
          await tx.companyDirection.deleteMany({ where: { companyId: id } })
          if (directionIds.length) await tx.companyDirection.createMany({ data: directionIds.map((directionId) => ({ companyId: id, directionId })) })
        }
        if (Object.keys(repData).length) await tx.user.update({ where: { id: actor.id }, data: repData })
      })
    } catch (err) {
      if (isUniqueViolation(err)) throw AppError.conflict('stir_taken', 'Another company is registered with this STIR')
      throw err
    }

    const pick = (o: object, keys: string[]) => Object.fromEntries(keys.map((k) => [k, (o as Record<string, unknown>)[k]]))
    if (changed.length || industryIds || directionIds || Object.keys(repData).length) {
      await this.audit.record({
        action: backToReview ? 'company.update.review' : 'company.update', entityType: 'Company', entityId: id,
        before: { ...pick(current, changed), ...(industryIds ? { industryIds: current.industries.map((i) => i.industry.id) } : {}) },
        after: { ...pick(data, changed), ...(industryIds ? { industryIds } : {}), ...(directionIds ? { directionIds } : {}), ...(Object.keys(repData).length ? { representative: repData } : {}) },
      })
    }
    if (backToReview) await this.notifyReviewers(tenantId, id, (data.name as string | undefined) ?? current.name, 'company.changed', `company-review:${id}:${now.getTime()}`)
    return this.profileOf(id)
  }

  /** Step 1 of the certificate: a presigned PUT under the company's own prefix (the browser uploads to the private bucket). */
  async certificateUploadUrl(tenantId: string, actor: RequestActor, input: CertificateUploadInput): Promise<DocumentUploadDto> {
    const id = await this.ownId(actor)
    const current = await this.prisma.client.company.findFirstOrThrow({ where: { id }, select: { status: true, approvedAt: true } })
    if (isLocked(current)) throw AppError.conflict('under_review', 'The profile is under review; wait for the decision')
    const key = this.docs.newKey(certPrefix(tenantId, id), input.contentType)
    return { uploadUrl: await this.docs.uploadUrl(key, input.contentType, input.fileSize), key, expiresInSeconds: 600 }
  }

  /**
   * Step 2: the server checks what was uploaded — under the company's prefix, at most 10 MB, a real PDF/JPEG/PNG by its
   * first bytes — and only then attaches it; anything else is deleted. After approval a new certificate goes to review.
   */
  async confirmCertificate(tenantId: string, actor: RequestActor, input: CertificateConfirmInput): Promise<CompanyProfileDto> {
    const id = await this.ownId(actor)
    const current = await this.prisma.client.company.findFirstOrThrow({ where: { id }, select: { name: true, status: true, approvedAt: true, certificateFileKey: true } })
    if (isLocked(current)) throw AppError.conflict('under_review', 'The profile is under review; wait for the decision')
    const { type, size } = await this.docs.verifyUpload(input.key, certPrefix(tenantId, id))
    const backToReview = current.approvedAt !== null && current.status !== 'PENDING'
    const now = new Date()
    await this.prisma.client.company.update({ where: { id }, data: { certificateFileKey: input.key, ...(backToReview ? { status: 'PENDING', submittedAt: now, rejectReason: null } : {}) } })
    if (current.certificateFileKey && current.certificateFileKey !== input.key) await this.docs.remove(current.certificateFileKey).catch(() => undefined)
    await this.audit.record({ action: backToReview ? 'company.certificate.review' : 'company.certificate', entityType: 'Company', entityId: id, after: { type, size } })
    if (backToReview) await this.notifyReviewers(tenantId, id, current.name, 'company.changed', `company-review:${id}:${now.getTime()}`)
    return this.profileOf(id)
  }

  /** The company's own certificate, through a 5-minute link. */
  async certificateLink(actor: RequestActor): Promise<DocumentLinkDto> {
    return this.certificateLinkOf(await this.ownId(actor))
  }

  /** A 5-minute link to a company's certificate (the company itself and the Super Admin — ТЗ 9.4); every link is audited. */
  async certificateLinkOf(companyId: string): Promise<DocumentLinkDto> {
    const row = await this.prisma.client.company.findFirst({ where: { id: companyId }, select: { certificateFileKey: true } })
    if (!row?.certificateFileKey) throw AppError.notFound('Certificate')
    const url = await this.docs.downloadUrl(row.certificateFileKey)
    await this.audit.record({ action: 'company.certificate.download', entityType: 'Company', entityId: companyId })
    return { url, expiresInSeconds: DOC_LINK_SECONDS }
  }

  /** DRAFT or REJECTED → PENDING when every required field is filled; the Super Admins are notified. */
  async submit(tenantId: string, actor: RequestActor): Promise<CompanyProfileDto> {
    const id = await this.ownId(actor)
    const current = await this.prisma.client.company.findFirstOrThrow({ where: { id }, select: PROFILE_SELECT })
    if (current.status === 'PENDING') throw AppError.conflict('already_submitted', 'The profile is already under review')
    if (current.status === 'APPROVED') throw AppError.conflict('already_approved', 'The profile is approved; changes of key fields go to review by themselves')
    const missing = missingFields(current)
    if (missing.length) throw AppError.invalid('incomplete_profile', 'Fill in the required fields', { missing })
    const now = new Date()
    const moved = await this.prisma.client.company.updateMany({ where: { id, status: { in: ['DRAFT', 'REJECTED'] } }, data: { status: 'PENDING', submittedAt: now, rejectReason: null } })
    if (moved.count !== 1) throw AppError.conflict('already_submitted', 'The profile is already under review')
    await this.audit.record({ action: 'company.submit', entityType: 'Company', entityId: id, before: { status: current.status }, after: { status: 'PENDING' } })
    await this.notifyReviewers(tenantId, id, current.name, 'company.submitted', `company-review:${id}:${now.getTime()}`)
    return this.profileOf(id)
  }

  async profileOf(id: string): Promise<CompanyProfileDto> {
    return toProfile(await this.prisma.client.company.findFirstOrThrow({ where: { id }, select: PROFILE_SELECT }))
  }

  // ───────────── helpers ─────────────

  private async representedId(actor: RequestActor): Promise<string | null> {
    const user = await this.prisma.client.user.findFirst({ where: { id: actor.id }, select: { companyId: true } })
    return user?.companyId ?? null
  }

  private async ownId(actor: RequestActor): Promise<string> {
    const id = await this.representedId(actor)
    if (!id) throw AppError.notFound('Company')
    return id
  }

  private async checkedIndustries(ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)]
    const found = await this.prisma.client.industry.findMany({ where: { id: { in: unique }, isActive: true }, select: { id: true } })
    if (found.length !== unique.length) throw AppError.invalid('invalid_industry', 'Choose industries from the list')
    return unique
  }

  /** Directions from the dictionary; an alias becomes its main direction. */
  private async mainDirections(ids: string[]): Promise<string[]> {
    const unique = [...new Set(ids)]
    const found = await this.prisma.client.direction.findMany({ where: { id: { in: unique } }, select: { id: true, mergedIntoId: true } })
    if (found.length !== unique.length) throw AppError.invalid('invalid_direction', 'Choose directions from the list')
    return [...new Set(found.map((d) => d.mergedIntoId ?? d.id))]
  }

  /** Region (id or the web app's slug) and district; a district must lie in the region; a new region clears the old district. */
  private async place(current: { regionId: string | null; districtId: string | null }, input: CompanyPatch) {
    let regionId = current.regionId
    if (input.regionId !== undefined) {
      regionId = input.regionId === null ? null : await regionIdByRef(this.prisma, input.regionId)
      if (input.regionId !== null && !regionId) throw AppError.invalid('invalid_region', 'Choose a region from the list')
    }
    let districtId = input.districtId !== undefined ? input.districtId : current.districtId
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

  private async notifyReviewers(tenantId: string, companyId: string, companyName: string, type: 'company.submitted' | 'company.changed', dedupeKey: string) {
    await this.notifications.safely(type, async () =>
      this.notifications.notify({ tenantId, userIds: await this.notifications.ownerIds(tenantId), type, params: { companyName, companyId }, dedupeKey }),
    )
  }
}
