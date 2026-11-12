import { Injectable } from '@nestjs/common'
import { COMPANY_REVIEW_FIELDS, type CompanyPendingChanges, type CompanyProfileDto, type CompanyRequiredField, type DocumentLinkDto, type DocumentUploadDto, type L, REGISTRY_DRAFT_HOLD_DAYS, registrySearchKey } from '@ilmora/shared'
import { AppError } from '../../common/errors'
import { Prisma } from '../../generated/prisma/client'
import { PrismaService, type TransactionClient } from '../../infra/prisma/prisma.service'
import { DOC_LINK_SECONDS, PrivateDocsService } from '../../infra/storage/private-docs.service'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { NotificationsService } from '../notifications/notifications.service'
import { DIRECTION_WITH_MAIN, INDUSTRY_SELECT, isUniqueViolation, lastEdit, mainOf, regionIdByRef, toIndustry, changedKey } from '../registry/registry.mappers'
import type { CertificateConfirmInput, CertificateUploadInput, CompanyCreateInput, CompanyPatch } from './companies.schemas'

export const PROFILE_SELECT = {
  id: true, stir: true, name: true, address: true, website: true, about: true, certificateFileKey: true,
  status: true, rejectReason: true, submittedAt: true, approvedAt: true, regionId: true, districtId: true,
  pendingChanges: true, blockedAt: true, blockReason: true,
  region: { select: { id: true, slug: true, name: true } },
  district: { select: { id: true, name: true } },
  industries: { select: { industry: { select: { ...INDUSTRY_SELECT, sortOrder: true } } } },
  directions: { select: { direction: { select: DIRECTION_WITH_MAIN } } },
  representative: { select: { id: true, displayName: true, jobTitle: true, email: true } },
} as const satisfies Prisma.CompanySelect

type ProfileRow = Prisma.CompanyGetPayload<{ select: typeof PROFILE_SELECT }>

const iso = (d: Date | null) => d?.toISOString() ?? null
const sortKeys = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)))
const isLocked = (r: { status: string; approvedAt: Date | null }) => r.status === 'PENDING' && !r.approvedAt
const certPrefix = (tenantId: string, companyId: string) => `company-certs/${tenantId}/${companyId}/`

/** What waits in `Company.pendingChanges`: the fields shown to people, and the storage key of a new certificate. */
export type StoredCompanyChanges = Omit<CompanyPendingChanges, 'certificate'> & { certificateFileKey?: string }

/** The waiting change as the company and the reviewer see it: a new certificate as a flag, never its storage key. */
export function pendingView(raw: unknown): CompanyPendingChanges | null {
  if (!raw) return null
  const { certificateFileKey, ...rest } = raw as StoredCompanyChanges
  return { ...rest, ...(certificateFileKey ? { certificate: true } : {}) }
}

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
    workspaceOpen: r.approvedAt !== null && r.blockedAt === null,
    editable: !isLocked(r),
    representative: { name: r.representative?.displayName ?? '', jobTitle: r.representative?.jobTitle ?? null, email: r.representative?.email ?? null },
    pendingChanges: pendingView(r.pendingChanges),
    blocked: r.blockedAt ? { at: r.blockedAt.toISOString(), reason: r.blockReason } : null,
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
 * A company is never handed over (decision 11.11): whoever claims the record next gets none of the students' or the
 * institutions' data — the consents end, opened contacts are taken back with their copies, the vacancies close and the
 * applications to them (with the contacts the students sent) are removed; the training requests close and the offers
 * and the responses to announcements (which open the institutions' contacts) are withdrawn (cybersecurity check 9.4).
 */
export async function closeCompanyData(tx: TransactionClient, id: string, now: Date) {
  const consents = await tx.studentConsent.updateMany({ where: { kind: 'COMPANY_CONTACTS', companyId: id, revokedAt: null }, data: { revokedAt: now } })
  const contacts = await tx.contactRequest.updateMany({ where: { companyId: id, status: { in: ['PENDING', 'ACCEPTED'] } }, data: { status: 'WITHDRAWN', decidedAt: now, sharedName: null, sharedPhone: null, sharedEmail: null } })
  await tx.vacancy.updateMany({ where: { companyId: id, status: 'OPEN' }, data: { status: 'CLOSED' } })
  const applications = await tx.vacancyApplication.deleteMany({ where: { vacancy: { companyId: id } } })
  const offers = await tx.trainingOffer.updateMany({ where: { request: { companyId: id }, status: { in: ['PENDING', 'ACCEPTED'] } }, data: { status: 'WITHDRAWN', decidedAt: now } })
  await tx.trainingRequest.updateMany({ where: { companyId: id, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: now } })
  const responses = await tx.announcementResponse.updateMany({ where: { companyId: id, status: { in: ['PENDING', 'ACCEPTED'] } }, data: { status: 'WITHDRAWN', decidedAt: now } })
  return { consents: consents.count, contacts: contacts.count, applications: applications.count, offers: offers.count, responses: responses.count }
}

/** The company goes back to a draft nobody holds, and none of its data stays (release, or the account deleted — №84). */
export async function unclaimCompany(tx: TransactionClient, id: string, now: Date) {
  // A block set because of the one who held it goes with them (re-check 11.11 №112).
  await tx.company.update({ where: { id }, data: { status: 'DRAFT', approvedAt: null, submittedAt: null, rejectReason: null, pendingChanges: Prisma.DbNull, claimedAt: null, blockedAt: null, blockReason: null, blockedById: null } })
  return closeCompanyData(tx, id, now)
}

/** The account becomes the representative only if it represents nothing yet: two registrations at once roll one back (9.4). */
const bindRepresentative = async (tx: TransactionClient, userId: string, companyId: string) => {
  const bound = await tx.user.updateMany({ where: { id: userId, companyId: null }, data: { companyId } })
  if (bound.count !== 1) throw AppError.conflict('already_has_company', 'This account already represents a company')
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
    const registered = () => AppError.conflict('company_registered', 'A company with this STIR is already registered. Write to support if it is yours.')
    // A record nobody represents (released by the Super Admin, or abandoned) is taken over as a fresh draft (security review №17).
    const existing = await this.prisma.client.company.findFirst({ where: { stir: input.stir }, select: { id: true, representative: { select: { id: true } } } })
    if (existing?.representative && (await this.isAbandoned(existing.id))) await this.release(tenantId, existing.id, 'abandoned-draft')
    let id: string
    try {
      id = await this.prisma.client.$transaction(async (tx) => {
        if (existing) {
          const holder = await tx.user.findFirst({ where: { companyId: existing.id }, select: { id: true } })
          if (holder) throw registered()
          // Whatever the previous representative left (a record unlinked other than by `release`) is not handed over.
          await closeCompanyData(tx, existing.id, new Date())
          await tx.companyIndustry.deleteMany({ where: { companyId: existing.id } })
          await tx.companyDirection.deleteMany({ where: { companyId: existing.id } })
          await tx.company.update({ where: { id: existing.id }, data: { name: input.name, searchKey: registrySearchKey(input.name), status: 'DRAFT', approvedAt: null, submittedAt: null, reviewedAt: null, rejectReason: null, certificateFileKey: null, about: null, website: null, address: null, pendingChanges: Prisma.DbNull, claimedAt: new Date() } })
          await bindRepresentative(tx, actor.id, existing.id)
          return existing.id
        }
        const row = await tx.company.create({ data: { tenantId, stir: input.stir, name: input.name, searchKey: registrySearchKey(input.name), claimedAt: new Date() }, select: { id: true } })
        await bindRepresentative(tx, actor.id, row.id)
        return row.id
      })
    } catch (err) {
      if (isUniqueViolation(err)) throw registered()
      throw err
    }
    await this.audit.record({ action: existing ? 'company.takeover' : 'company.create', entityType: 'Company', entityId: id, after: { stir: input.stir, name: input.name, representativeId: actor.id } })
    return this.profileOf(id)
  }

  /**
   * Abandoned: never approved, a draft (or rejected) untouched for REGISTRY_DRAFT_HOLD_DAYS since it was created, claimed
   * by its present representative or reviewed — the latest of the three. Counting from the creation only let a hijacker
   * take an old record straight back from the company that claimed it after a release (security review 11.11, №83).
   */
  private async isAbandoned(id: string): Promise<boolean> {
    const row = await this.prisma.client.company.findFirst({ where: { id }, select: { status: true, approvedAt: true, reviewedAt: true, createdAt: true, claimedAt: true } })
    if (!row || row.approvedAt || !['DRAFT', 'REJECTED'].includes(row.status)) return false
    // Also the last edit (audit log): a draft worked on yesterday is not abandoned (re-check 11.11 №110).
    const last = Math.max(row.createdAt.getTime(), row.claimedAt?.getTime() ?? 0, row.reviewedAt?.getTime() ?? 0, await lastEdit(this.prisma, 'Company', id))
    return Date.now() - last > REGISTRY_DRAFT_HOLD_DAYS * 86_400_000
  }

  /**
   * Releases the company from its representative (the Super Admin, or an abandoned draft): the account no longer
   * represents it and the workspace closes; the next representative of the STIR starts it over as a draft.
   */
  async release(tenantId: string, id: string, reason: string): Promise<void> {
    const found = await this.prisma.client.company.findFirst({ where: { id }, select: { name: true, status: true, approvedAt: true } })
    if (!found) throw AppError.notFound('Company')
    // A deleted account still holding the company is found too (№84).
    const representative = (await this.prisma.client.user.findFirst({ where: { companyId: id }, select: { id: true }, includeDeleted: true } as never)) as { id: string } | null
    if (!representative) throw AppError.conflict('not_claimed', 'Nobody represents this company')
    const row = { ...found, representative }
    const now = new Date()
    const closed = await this.prisma.client.$transaction(async (tx) => {
      await tx.user.updateMany({ where: { id: representative.id }, data: { companyId: null }, includeDeleted: true } as never)
      return unclaimCompany(tx, id, now)
    })
    await this.audit.record({ action: 'company.release', entityType: 'Company', entityId: id, before: { status: row.status, approved: !!row.approvedAt, representativeId: row.representative.id }, after: { closed }, reason })
    await this.notifications.safely('registry.released', () =>
      this.notifications.notify({ tenantId, userIds: [row.representative!.id], type: 'registry.released', params: { name: row.name }, dedupeKey: `registry-released:${id}:${Date.now()}` }),
    )
  }

  async profile(actor: RequestActor): Promise<CompanyProfileDto> {
    return this.profileOf(await this.ownId(actor))
  }

  /**
   * Saves the profile in parts. Locked while the first review is pending. After approval a change of the STIR, the
   * name or the industries waits in `pendingChanges` for the Super Admin (the workspace keeps working with the approved
   * ones); the rest changes at once. Audited.
   */
  async update(tenantId: string, actor: RequestActor, input: CompanyPatch): Promise<CompanyProfileDto> {
    const id = await this.editableId(actor)
    const current = await this.prisma.client.company.findFirstOrThrow({ where: { id }, select: PROFILE_SELECT })
    if (isLocked(current)) throw AppError.conflict('under_review', 'The profile is under review; wait for the decision')

    const data: Prisma.CompanyUncheckedUpdateInput = {}
    if (input.stir !== undefined) data.stir = input.stir
    if (input.name !== undefined) Object.assign(data, { name: input.name, searchKey: registrySearchKey(input.name) })
    if (input.address !== undefined) data.address = input.address || null
    if (input.website !== undefined) data.website = input.website || null
    if (input.about !== undefined) data.about = input.about || null
    if (input.regionId !== undefined || input.districtId !== undefined) Object.assign(data, await this.place(current, input))
    let industryIds = input.industryIds !== undefined ? await this.checkedIndustries(input.industryIds) : undefined
    const directionIds = input.directionIds !== undefined ? await this.mainDirections(input.directionIds) : undefined

    // After approval the name, the STIR and the industries wait for the Super Admin in `pendingChanges`; the approved
    // ones stay live — a company cannot open other industries' announcements by itself (security review №13, №46).
    const now = new Date()
    let backToReview = false
    let pending: Record<string, unknown> | null = null
    if (current.approvedAt !== null) {
      const was = (current.pendingChanges ?? {}) as Record<string, unknown>
      const next: Record<string, unknown> = { ...was }
      const d = data as Record<string, unknown>
      for (const f of COMPANY_REVIEW_FIELDS) {
        if (!(f in d)) continue
        if (d[f] === (current as Record<string, unknown>)[f]) delete next[f]
        else next[f] = d[f]
        delete d[f]
      }
      if (!('name' in d)) delete d.searchKey
      if (industryIds) {
        const live = current.industries.map((i) => i.industry.id).sort()
        if (JSON.stringify([...industryIds].sort()) === JSON.stringify(live)) delete next.industryIds
        else next.industryIds = [...industryIds].sort()
        industryIds = undefined
      }
      if (typeof next.stir === 'string' && next.stir !== was.stir && (await this.prisma.client.company.findFirst({ where: { stir: next.stir, id: { not: id } }, select: { id: true } }))) {
        throw AppError.conflict('stir_taken', 'Another company is registered with this STIR')
      }
      backToReview = JSON.stringify(sortKeys(next)) !== JSON.stringify(sortKeys(was))
      if (backToReview) {
        pending = Object.keys(next).length ? next : null
        Object.assign(data, { pendingChanges: pending ?? Prisma.DbNull, ...(pending ? { submittedAt: now, rejectReason: null } : {}) })
      }
    }
    const changed = Object.keys(data).filter((k) => !['searchKey', 'pendingChanges', 'submittedAt', 'rejectReason'].includes(k) && (data as Record<string, unknown>)[k] !== (current as Record<string, unknown>)[k])
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
    if (changed.length || industryIds || directionIds || backToReview || Object.keys(repData).length) {
      await this.audit.record({
        action: backToReview ? 'company.update.review' : 'company.update', entityType: 'Company', entityId: id,
        before: { ...pick(current, changed), ...(industryIds ? { industryIds: current.industries.map((i) => i.industry.id) } : {}) },
        after: { ...pick(data, changed), ...(industryIds ? { industryIds } : {}), ...(directionIds ? { directionIds } : {}), ...(backToReview ? { pendingChanges: pending } : {}), ...(Object.keys(repData).length ? { representative: repData } : {}) },
      })
    }
    if (backToReview && pending) await this.notifyReviewers(tenantId, id, current.name, 'company.changed', changedKey('company', id, now))
    return this.profileOf(id)
  }

  /** Step 1 of the certificate: a presigned PUT under the company's own prefix (the browser uploads to the private bucket). */
  async certificateUploadUrl(tenantId: string, actor: RequestActor, input: CertificateUploadInput): Promise<DocumentUploadDto> {
    const id = await this.editableId(actor)
    const current = await this.prisma.client.company.findFirstOrThrow({ where: { id }, select: { status: true, approvedAt: true } })
    if (isLocked(current)) throw AppError.conflict('under_review', 'The profile is under review; wait for the decision')
    const key = this.docs.newKey(certPrefix(tenantId, id), input.contentType)
    return { uploadUrl: await this.docs.uploadUrl(key, input.contentType, input.fileSize), key, expiresInSeconds: 600 }
  }

  /**
   * Step 2: the server checks what was uploaded — under the company's prefix, at most 10 MB, a real PDF/JPEG/PNG by its
   * first bytes — and only then attaches it; anything else is deleted. Before approval it is part of the profile. After
   * approval it waits in `pendingChanges` like the other key fields (re-check 11.11 №106): the approved certificate stays
   * in force and is replaced only when the Super Admin approves the new one; a rejection drops the new one.
   */
  async confirmCertificate(tenantId: string, actor: RequestActor, input: CertificateConfirmInput): Promise<CompanyProfileDto> {
    const id = await this.editableId(actor)
    const current = await this.prisma.client.company.findFirstOrThrow({ where: { id }, select: { name: true, status: true, approvedAt: true, certificateFileKey: true, pendingChanges: true } })
    if (isLocked(current)) throw AppError.conflict('under_review', 'The profile is under review; wait for the decision')
    const { type, size, key } = await this.docs.verifyUpload(input.key, certPrefix(tenantId, id))
    const now = new Date()
    if (current.approvedAt === null) {
      await this.prisma.client.company.update({ where: { id }, data: { certificateFileKey: key } })
      if (current.certificateFileKey && current.certificateFileKey !== key) await this.removeCertificateFile(current.certificateFileKey)
      await this.audit.record({ action: 'company.certificate', entityType: 'Company', entityId: id, after: { type, size } })
      return this.profileOf(id)
    }
    const was = (current.pendingChanges ?? {}) as StoredCompanyChanges
    // Every new file is a new version for the reviewer (submittedAt): they approve the file they looked at (review 11.11).
    await this.prisma.client.company.update({ where: { id }, data: { pendingChanges: { ...was, certificateFileKey: key }, submittedAt: now, rejectReason: null } })
    if (was.certificateFileKey && was.certificateFileKey !== key) await this.removeCertificateFile(was.certificateFileKey)
    await this.audit.record({ action: 'company.certificate.review', entityType: 'Company', entityId: id, after: { type, size } })
    await this.notifyReviewers(tenantId, id, current.name, 'company.changed', changedKey('company', id, now))
    return this.profileOf(id)
  }

  /** Deletes a certificate file that is no longer the company's (replaced, or a rejected new one); a failure is left to the bucket. */
  async removeCertificateFile(key: string): Promise<void> {
    await this.docs.remove(key).catch(() => undefined)
  }

  /** The company's own certificate, through a 5-minute link. */
  async certificateLink(actor: RequestActor): Promise<DocumentLinkDto> {
    return this.certificateLinkOf(await this.ownId(actor))
  }

  /** A 5-minute link to a company's certificate (the company itself and the Super Admin — ТЗ 9.4); every link is audited. */
  async certificateLinkOf(companyId: string): Promise<DocumentLinkDto> {
    const row = await this.prisma.client.company.findFirst({ where: { id: companyId }, select: { certificateFileKey: true, pendingChanges: true } })
    // The newest certificate: the one waiting for review if there is one — what the company sent and the reviewer decides on.
    const key = ((row?.pendingChanges ?? {}) as StoredCompanyChanges).certificateFileKey ?? row?.certificateFileKey
    if (!key) throw AppError.notFound('Certificate')
    const url = await this.docs.downloadUrl(key)
    await this.audit.record({ action: 'company.certificate.download', entityType: 'Company', entityId: companyId })
    return { url, expiresInSeconds: DOC_LINK_SECONDS }
  }

  /** DRAFT or REJECTED → PENDING when every required field is filled; the Super Admins are notified. */
  async submit(tenantId: string, actor: RequestActor): Promise<CompanyProfileDto> {
    const id = await this.editableId(actor)
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

  /** Blocked: the workspace is closed, the profile too — no edits and no new submission (cybersecurity check 9.4, 11.11). */
  private async editableId(actor: RequestActor): Promise<string> {
    const id = await this.ownId(actor)
    const row = await this.prisma.client.company.findFirst({ where: { id }, select: { blockedAt: true } })
    if (row?.blockedAt) throw AppError.forbidden('The company is blocked; write to support')
    return id
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
