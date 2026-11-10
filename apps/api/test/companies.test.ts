import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { registrySearchKey } from '@ilmora/shared'
import { seedRegistryReference } from '../prisma/registry-reference'
import { ROLES_KEY } from '../src/common/decorators'
import { ApprovedGuard, APPROVED_KEY } from '../src/common/registry-access'
import { ZodValidationPipe } from '../src/common/zod.pipe'
import type { RedisService } from '../src/infra/redis/redis.service'
import { PrivateDocsService, sniffDocType } from '../src/infra/storage/private-docs.service'
import { TenantContext, type RequestActor } from '../src/infra/tenancy/tenant-context'
import { AccountService } from '../src/modules/auth/account.service'
import { CompaniesAdminController } from '../src/modules/companies/companies-admin.controller'
import { CertificateUploadInput, CompanyPatch } from '../src/modules/companies/companies.schemas'
import { CompaniesService } from '../src/modules/companies/companies.service'
import { CompanyReviewService } from '../src/modules/companies/company-review.service'
import type { NotifyInput, NotificationsService } from '../src/modules/notifications/notifications.service'
import { DB_AVAILABLE, TestContext, testEnv } from './helpers'
import { mfaStub } from './stubs'

const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n')
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])

describe('Private documents', () => {
  it('recognise PDF, JPEG and PNG by their first bytes, nothing else', () => {
    expect(sniffDocType(PDF)).toBe('application/pdf')
    expect(sniffDocType(PNG)).toBe('image/png')
    expect(sniffDocType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffDocType(Buffer.from('<html><script>'))).toBeNull()
    expect(sniffDocType(Buffer.from('PK\x03\x04'))).toBeNull()
  })

  it('answer 503 storage_unavailable without the docs bucket', async () => {
    const docs = new PrivateDocsService(testEnv({ S3_ENDPOINT: 'https://s3.test', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' }))
    expect(docs.configured).toBe(false)
    await expect(docs.uploadUrl('k', 'application/pdf', 10)).rejects.toMatchObject({ code: 'storage_unavailable' })
  })

  it('sign a PUT for the private bucket with the type fixed, and a 5-minute GET', async () => {
    const docs = new PrivateDocsService(testEnv({ S3_ENDPOINT: 'https://s3.test', S3_DOCS_BUCKET: 'ilmora-docs', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' }))
    expect(await docs.uploadUrl('company-certs/t/c/1.pdf', 'application/pdf', 1000)).toMatch(/^https:\/\/s3\.test\/ilmora-docs\/company-certs\/t\/c\/1\.pdf\?.*X-Amz-Signature=/)
    expect(await docs.downloadUrl('company-certs/t/c/1.pdf')).toMatch(/X-Amz-Expires=300/)
  })

  it('certificate input: PDF, JPG, PNG up to 10 MB; the company profile takes no status or certificate key', () => {
    const upload = new ZodValidationPipe(CertificateUploadInput)
    expect(() => upload.transform({ contentType: 'text/html', fileSize: 10 })).toThrow()
    expect(() => upload.transform({ contentType: 'application/pdf', fileSize: 10 * 1024 * 1024 + 1 })).toThrow()
    const patch = new ZodValidationPipe(CompanyPatch)
    expect(() => patch.transform({ status: 'APPROVED' })).toThrow()
    expect(() => patch.transform({ certificateFileKey: 'x' })).toThrow()
    expect(() => patch.transform({ about: '<script>alert(1)</script>' })).toThrow()
  })

  it('the company review routes are for the Super Admin only', () => {
    expect(Reflect.getMetadata(ROLES_KEY, CompaniesAdminController)).toEqual(['PLATFORM_ADMIN'])
  })
})

describe.skipIf(!DB_AVAILABLE)('Company profile and its review (ТЗ 4.3)', () => {
  const ctx = new TestContext()
  const sent: NotifyInput[] = []
  const notifications = {
    notify: async (n: NotifyInput) => (sent.push(n), n.userIds.length),
    safely: async (_l: string, fn: () => Promise<unknown>) => { await fn() },
    ownerIds: async (tenantId: string) => (await TenantContext.system(() => ctx.prisma.client.user.findMany({ where: { tenantId, isOwner: true }, select: { id: true } }))).map((u) => u.id),
  } as unknown as NotificationsService
  /** The private bucket in memory: what the browser «uploaded», and what the API deleted. */
  const objects = new Map<string, Buffer>()
  const removed: string[] = []
  /** The real document service with S3 replaced by the map above: the upload checks run as in production. */
  class MemoryDocs extends PrivateDocsService {
    constructor() { super(testEnv({ S3_ENDPOINT: 'https://s3.test', S3_DOCS_BUCKET: 'ilmora-docs', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' })) }
    override async uploadUrl(key: string) { return `https://s3.test/ilmora-docs/${key}?X-Amz-Signature=x` }
    override async downloadUrl(key: string) { return `https://s3.test/ilmora-docs/${key}?X-Amz-Expires=300` }
    override async inspect(key: string) { return objects.has(key) ? { size: objects.get(key)!.length, head: objects.get(key)!.subarray(0, 16) } : null }
    override async remove(key: string) { removed.push(key); objects.delete(key) }
  }
  const docs = new MemoryDocs()
  const service = new CompaniesService(ctx.prisma, ctx.audit, notifications, docs)
  const review = new CompanyReviewService(ctx.prisma, ctx.audit, notifications, service)
  const accounts = new AccountService(ctx.prisma, ctx.tokens, ctx.audit, {} as RedisService, notifications, ctx.env, mfaStub)
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  let n = 0
  const setup = async (label: string) => {
    const t = await ctx.makeTenant(label)
    const db = ctx.prisma.client
    const inT = <T>(fn: () => Promise<T>) => TenantContext.forTenant(t.tenantId, fn)
    await TenantContext.system(() => seedRegistryReference(db as never, t.tenantId))
    await TenantContext.system(() => db.region.updateMany({ where: { tenantId: t.tenantId, code: '1703' }, data: { slug: 'andijan' } }))
    return inT(async () => {
      const it = await db.industry.findFirstOrThrow({ where: { slug: 'it' } })
      const furniture = await db.industry.findFirstOrThrow({ where: { slug: 'furniture' } })
      const andijan = await db.region.findFirstOrThrow({ where: { code: '1703' } })
      const dasturlash = await db.direction.create({ data: { tenantId: t.tenantId, name: 'Dasturlaş', searchKey: registrySearchKey('Dasturlaş'), industryId: it.id } })
      const owner = await db.user.create({ data: { tenantId: t.tenantId, login: `owner-${label}`, displayName: 'Owner', roles: ['STUDENT'], isOwner: true } })
      const representative = async () => {
        const r = await accounts.register(t.tenantId, { role: 'COMPANY', login: `co-${label}-${++n}`, password: 'company-password-1', displayName: 'Dilnoza Rahimova', jobTitle: 'HR menejer' }, {})
        return { id: r.user.id, roles: r.user.roles } as RequestActor
      }
      /** Upload as the browser would: get the URL, «PUT» the bytes, confirm. */
      const upload = async (actor: RequestActor, bytes: Buffer, contentType: 'application/pdf' | 'image/png' = 'application/pdf') => {
        const { key } = await service.certificateUploadUrl(t.tenantId, actor, { contentType, fileSize: bytes.length })
        objects.set(key, bytes)
        return { key, profile: await service.confirmCertificate(t.tenantId, actor, { key }) }
      }
      /** A complete profile. */
      const complete = async (actor: RequestActor, stir: string) => {
        await service.create(t.tenantId, actor, { stir, name: 'Mebel Plus' })
        await service.update(t.tenantId, actor, { regionId: 'andijan', address: 'Andijon, Navoiy köçasi 1', industryIds: [furniture.id] })
        await upload(actor, PDF)
      }
      return { ...t, inT, it, furniture, andijan, dasturlash, owner, admin: { id: owner.id, roles: ['PLATFORM_ADMIN'] } as RequestActor, representative, upload, complete }
    })
  }

  it('registers a company representative; one STIR — one company, one account — one company', async () => {
    const s = await setup('co-create')
    await s.inT(async () => {
      const rep = await s.representative()
      expect(rep.roles).toEqual(['COMPANY_ADMIN'])
      const p = await service.create(s.tenantId, rep, { stir: '301234567', name: 'Mebel Plus' })
      expect(p).toMatchObject({ stir: '301234567', name: 'Mebel Plus', status: 'DRAFT', workspaceOpen: false, editable: true, certificateUploaded: false, representative: { name: 'Dilnoza Rahimova', jobTitle: 'HR menejer' } })
      await expect(service.create(s.tenantId, rep, { stir: '301234568', name: 'Ikkinçi' })).rejects.toMatchObject({ code: 'already_has_company' })
      await expect(service.create(s.tenantId, await s.representative(), { stir: '301234567', name: 'Nusxa' })).rejects.toMatchObject({ code: 'company_registered' })
      await expect(service.create(s.tenantId, s.admin, { stir: '301234569', name: 'Admin' })).rejects.toMatchObject({ code: 'forbidden' })
      await expect(accounts.register(s.tenantId, { role: 'COMPANY', login: 'co-nojob', password: 'company-password-1', displayName: 'Ali' }, {})).rejects.toMatchObject({ code: 'invalid_job_title' })
    })
  })

  it('saves industries, directions (alias → main), region by slug and the contact; refuses unknown industries', async () => {
    const s = await setup('co-patch')
    await s.inT(async () => {
      const rep = await s.representative()
      await service.create(s.tenantId, rep, { stir: '302222222', name: 'IT Soft' })
      const alias = await ctx.prisma.client.direction.create({ data: { tenantId: s.tenantId, name: 'Programmalaş', searchKey: 'programmalash', industryId: s.it.id, mergedIntoId: s.dasturlash.id } })
      const p = await service.update(s.tenantId, rep, { industryIds: [s.furniture.id, s.it.id, s.it.id], directionIds: [alias.id, s.dasturlash.id], regionId: 'andijan', website: 'https://itsoft.uz', representative: { email: 'hr@itsoft.uz' } })
      expect(p.industries.map((i) => i.slug)).toEqual(['it', 'furniture'])
      expect(p.directions.map((d) => d.id)).toEqual([s.dasturlash.id])
      expect(p).toMatchObject({ region: { id: s.andijan.id, slug: 'andijan' }, website: 'https://itsoft.uz', representative: { email: 'hr@itsoft.uz' } })
      await expect(service.update(s.tenantId, rep, { industryIds: ['nope'] })).rejects.toMatchObject({ code: 'invalid_industry' })
      await expect(service.update(s.tenantId, rep, { regionId: 'nowhere' })).rejects.toMatchObject({ code: 'invalid_region' })
      const other = await s.representative()
      await service.create(s.tenantId, other, { stir: '303333333', name: 'Boşqa' })
      await expect(service.update(s.tenantId, other, { stir: '302222222' })).rejects.toMatchObject({ code: 'stir_taken' })
    })
  })

  it('takes the certificate only under its own prefix and only a real PDF/JPG/PNG; a fake is deleted', async () => {
    const s = await setup('co-cert')
    await s.inT(async () => {
      const rep = await s.representative()
      const { id } = await service.create(s.tenantId, rep, { stir: '304444444', name: 'Doc Test' })
      const { uploadUrl, key } = await service.certificateUploadUrl(s.tenantId, rep, { contentType: 'application/pdf', fileSize: 5000 })
      expect(key).toMatch(new RegExp(`^company-certs/${s.tenantId}/${id}/\\d+-[0-9a-f]{16}\\.pdf$`))
      expect(uploadUrl).toContain(key)
      await expect(service.confirmCertificate(s.tenantId, rep, { key })).rejects.toMatchObject({ code: 'file_not_uploaded' })
      await expect(service.confirmCertificate(s.tenantId, rep, { key: `company-certs/${s.tenantId}/someone-else/1.pdf` })).rejects.toMatchObject({ code: 'invalid_file' })
      await expect(service.confirmCertificate(s.tenantId, rep, { key: `company-certs/${s.tenantId}/${id}/../x/1.pdf` })).rejects.toMatchObject({ code: 'invalid_file' })
      // HTML (or a PNG) uploaded under a .pdf key: refused and deleted.
      objects.set(key, Buffer.from('<html><script>x</script>'))
      await expect(service.confirmCertificate(s.tenantId, rep, { key })).rejects.toMatchObject({ code: 'invalid_file' })
      expect(removed).toContain(key)
      const first = await s.upload(rep, PDF)
      expect(first.profile.certificateUploaded).toBe(true)
      const second = await s.upload(rep, PNG, 'image/png')
      expect(removed).toContain(first.key)
      expect((await ctx.prisma.client.company.findUniqueOrThrow({ where: { id } })).certificateFileKey).toBe(second.key)
      expect((await service.certificateLink(rep)).url).toContain(second.key)
    })
  })

  it('submits only a complete profile to the Super Admin, then locks it', async () => {
    const s = await setup('co-submit')
    await s.inT(async () => {
      const rep = await s.representative()
      await service.create(s.tenantId, rep, { stir: '305555555', name: 'Mebel Plus' })
      await expect(service.submit(s.tenantId, rep)).rejects.toMatchObject({ code: 'incomplete_profile', details: { missing: ['regionId', 'address', 'industries', 'certificate'] } })
      await service.update(s.tenantId, rep, { regionId: 'andijan', address: 'Manzil', industryIds: [s.furniture.id] })
      await s.upload(rep, PDF)
      sent.length = 0
      expect((await service.submit(s.tenantId, rep))).toMatchObject({ status: 'PENDING', editable: false })
      expect(sent).toEqual([expect.objectContaining({ userIds: [s.owner.id], type: 'company.submitted' })])
      await expect(service.update(s.tenantId, rep, { about: 'x' })).rejects.toMatchObject({ code: 'under_review' })
      await expect(service.certificateUploadUrl(s.tenantId, rep, { contentType: 'application/pdf', fileSize: 10 })).rejects.toMatchObject({ code: 'under_review' })
      await expect(service.submit(s.tenantId, rep)).rejects.toMatchObject({ code: 'already_submitted' })
    })
  })

  it('the Super Admin sees the queue and the certificate, approves: the company workspace opens (guard by database)', async () => {
    const s = await setup('co-approve')
    await s.inT(async () => {
      const rep = await s.representative()
      await s.complete(rep, '306666666')
      await service.submit(s.tenantId, rep)
      const [item] = await review.queue()
      expect(item).toMatchObject({ stir: '306666666', certificateUploaded: true, reReview: false, representative: { name: 'Dilnoza Rahimova' } })
      expect((await review.certificate(item.id)).url).toContain('company-certs/')
      const guard = new ApprovedGuard(new Reflector(), ctx.prisma)
      const handler = () => undefined
      Reflect.defineMetadata(APPROVED_KEY, 'company', handler)
      const ctxFor = { getHandler: () => handler, getClass: () => class {}, switchToHttp: () => ({ getRequest: () => ({ actor: rep }) }) } as unknown as ExecutionContext
      await expect(guard.canActivate(ctxFor)).rejects.toMatchObject({ code: 'not_approved' })
      sent.length = 0
      expect(await review.approve(s.tenantId, s.admin, item.id)).toMatchObject({ status: 'APPROVED', workspaceOpen: true })
      expect(sent).toEqual([expect.objectContaining({ userIds: [rep.id], type: 'company.approved' })])
      await expect(guard.canActivate(ctxFor)).resolves.toBe(true)
      const detail = await review.detail(item.id)
      expect(detail.history.map((h) => h.action)).toEqual(['company.create', 'company.submit', 'company.approve'])
      expect(await ctx.prisma.client.auditEvent.count({ where: { action: 'company.certificate.download', entityId: item.id } })).toBe(1)

      // After approval a new name — or a new certificate — goes back to review; the workspace stays open.
      expect(await service.update(s.tenantId, rep, { about: 'Mebel işlab çiqariş' })).toMatchObject({ status: 'APPROVED' })
      expect(await service.update(s.tenantId, rep, { name: 'Mebel Plus Group' })).toMatchObject({ status: 'PENDING', workspaceOpen: true })
      await review.approve(s.tenantId, s.admin, item.id)
      expect((await s.upload(rep, PNG, 'image/png')).profile).toMatchObject({ status: 'PENDING', workspaceOpen: true })
    })
  })

  it('rejects with a reason; one decision when two reviewers act at once', async () => {
    const s = await setup('co-reject')
    await s.inT(async () => {
      const rep = await s.representative()
      await s.complete(rep, '307777777')
      const { id } = await service.submit(s.tenantId, rep)
      const results = await Promise.allSettled([review.reject(s.tenantId, s.admin, id, 'STIR differs from the certificate'), review.approve(s.tenantId, s.admin, id)])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      await expect(review.approve(s.tenantId, s.admin, 'nope')).rejects.toMatchObject({ code: 'not_found' })
    })
  })
})
