import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ZodValidationPipe } from '../src/common/zod.pipe'
import { PrivateDocsService } from '../src/infra/storage/private-docs.service'
import { TenantContext, type RequestActor } from '../src/infra/tenancy/tenant-context'
import { CertificateInput, CertificatePatch } from '../src/modules/students/certificates.schemas'
import { CertificatesService } from '../src/modules/students/certificates.service'
import { DB_AVAILABLE, TestContext, testEnv } from './helpers'

const PDF = Buffer.from('%PDF-1.7\n%âãÏÓ\n')
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13])

describe('Certificate input', () => {
  it('a title of 2+ characters, no markup, a real date not in the future', () => {
    const pipe = new ZodValidationPipe(CertificateInput)
    expect(pipe.transform({ key: 'student-certs/t/u/1.pdf', title: ' IELTS  7.0 ', issuedAt: '2026-01-15' })).toMatchObject({ title: 'IELTS 7.0' })
    expect(() => pipe.transform({ key: 'student-certs/t/u/1.pdf', title: '<b>x</b>' })).toThrow()
    expect(() => pipe.transform({ key: 'student-certs/t/u/1.pdf', title: 'IELTS', issuedAt: '2999-01-01' })).toThrow()
    // Not a calendar day: «31 February» is refused, not turned into 2 March (security review №54).
    expect(() => pipe.transform({ key: 'student-certs/t/u/1.pdf', title: 'IELTS', issuedAt: '2024-02-31' })).toThrow()
    expect(() => new ZodValidationPipe(CertificatePatch).transform({ fileKey: 'other' })).toThrow()
  })
})

describe.skipIf(!DB_AVAILABLE)('Student certificates and «Курсы в ILMORA» (ТЗ 5.5)', () => {
  const ctx = new TestContext()
  const objects = new Map<string, Buffer>()
  const removed: string[] = []
  class MemoryDocs extends PrivateDocsService {
    constructor() { super(testEnv({ S3_ENDPOINT: 'https://s3.test', S3_DOCS_BUCKET: 'ilmora-docs', S3_ACCESS_KEY_ID: 'k', S3_SECRET_ACCESS_KEY: 's' })) }
    override async uploadUrl(key: string) { return `https://s3.test/ilmora-docs/${key}?X-Amz-Signature=x` }
    override async downloadUrl(key: string) { return `https://s3.test/ilmora-docs/${key}?X-Amz-Expires=300` }
    override async inspect(key: string) { return objects.has(key) ? { size: objects.get(key)!.length, head: objects.get(key)!.subarray(0, 16) } : null }
    override async remove(key: string) { removed.push(key); objects.delete(key) }
  }
  const service = new CertificatesService(ctx.prisma, ctx.audit, new MemoryDocs())
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  const setup = async (label: string) => {
    const t = await ctx.makeTenant(label)
    const student = async () => ({ id: (await ctx.makeStudent(t.tenantId)).id, roles: ['STUDENT'] }) as RequestActor
    /** Upload as the browser would, then add. */
    const upload = async (me: RequestActor, bytes: Buffer, title: string, contentType: 'application/pdf' | 'image/png' = 'application/pdf') => {
      const { key } = await service.uploadUrl(t.tenantId, me, { contentType, fileSize: bytes.length })
      objects.set(key, bytes)
      return service.add(t.tenantId, me, { key, title })
    }
    return { ...t, inT: <T>(fn: () => Promise<T>) => TenantContext.forTenant(t.tenantId, fn), student, upload }
  }

  it('adds a real PDF or PNG under the student’s own prefix, renames, links for 5 minutes, deletes the file too', async () => {
    const s = await setup('cert-crud')
    await s.inT(async () => {
      const me = await s.student()
      const { key, uploadUrl } = await service.uploadUrl(s.tenantId, me, { contentType: 'application/pdf', fileSize: PDF.length })
      expect(key).toMatch(new RegExp(`^student-certs/${s.tenantId}/${me.id}/\\d+-[0-9a-f]{16}\\.pdf$`))
      expect(uploadUrl).toContain(key)
      await expect(service.add(s.tenantId, me, { key, title: 'IELTS' })).rejects.toMatchObject({ code: 'file_not_uploaded' })
      objects.set(key, PDF)
      const cert = await service.add(s.tenantId, me, { key, title: 'IELTS 7.0', issuer: 'British Council', issuedAt: '2026-01-15' })
      expect(cert).toMatchObject({ title: 'IELTS 7.0', issuer: 'British Council', issuedAt: '2026-01-15', contentType: 'application/pdf', sizeBytes: PDF.length })
      await expect(service.add(s.tenantId, me, { key, title: 'Again' })).rejects.toMatchObject({ code: 'certificate_exists' })
      expect((await service.update(me, cert.id, { title: 'IELTS Academic', issuer: null })).issuer).toBeNull()
      expect((await service.link(me, cert.id)).url).toContain(key)
      await service.remove(me, cert.id)
      expect(removed).toContain(key)
      expect(await service.list(me)).toEqual([])
    })
  })

  it('refuses a fake file (deleted at once) and another student’s key; another student cannot touch it', async () => {
    const s = await setup('cert-guard')
    await s.inT(async () => {
      const me = await s.student()
      const other = await s.student()
      const { key } = await service.uploadUrl(s.tenantId, me, { contentType: 'application/pdf', fileSize: 30 })
      objects.set(key, Buffer.from('<html><script>alert(1)</script>'))
      await expect(service.add(s.tenantId, me, { key, title: 'Fake' })).rejects.toMatchObject({ code: 'invalid_file' })
      expect(removed).toContain(key)
      const mine = await s.upload(me, PNG, 'Olimpiada', 'image/png')
      const stolen = (await ctx.prisma.client.studentCertificate.findUniqueOrThrow({ where: { id: mine.id } })).fileKey
      await expect(service.add(s.tenantId, other, { key: stolen, title: 'Not mine' })).rejects.toMatchObject({ code: 'invalid_file' })
      for (const call of [() => service.link(other, mine.id), () => service.update(other, mine.id, { title: 'XX' }), () => service.remove(other, mine.id)]) {
        await expect(call()).rejects.toMatchObject({ code: 'not_found' })
      }
      expect((await service.list(me)).map((c) => c.id)).toEqual([mine.id])
    })
  })

  it('keeps at most 20 certificates', async () => {
    const s = await setup('cert-limit')
    await s.inT(async () => {
      const me = await s.student()
      for (let i = 0; i < 20; i++) await s.upload(me, PDF, `Sertifikat ${i + 1}`)
      await expect(service.uploadUrl(s.tenantId, me, { contentType: 'application/pdf', fileSize: 10 })).rejects.toMatchObject({ code: 'certificates_limit' })
      expect(await service.list(me)).toHaveLength(20)
    })
  })

  it('«Курсы в ILMORA»: courses of the student’s subscriptions with the lessons held and attended', async () => {
    const s = await setup('cert-courses')
    await s.inT(async () => {
      const me = await s.student()
      await ctx.checkout(s.tenantId, me.id, s.pkg.id, [s.group.id, s.group2.id])
      const enrolledAt = new Date(Date.now() - 30 * 86_400_000)
      await ctx.prisma.client.enrollment.updateMany({ where: { studentId: me.id, groupId: s.group.id }, data: { status: 'ACTIVE', enrolledAt } })
      // The second seat stayed pending (unpaid): not a course yet.
      const lesson = async (daysAgo: number, status: 'COMPLETED' | 'CANCELLED') => {
        const startsAt = new Date(Date.now() - daysAgo * 86_400_000)
        return ctx.prisma.client.lessonSession.create({ data: { tenantId: s.tenantId, groupId: s.group.id, courseId: s.course.id, date: startsAt, startsAt, endsAt: new Date(startsAt.getTime() + 5_400_000), status } })
      }
      const held = [await lesson(20, 'COMPLETED'), await lesson(13, 'COMPLETED'), await lesson(6, 'COMPLETED'), await lesson(40, 'COMPLETED')]
      await lesson(10, 'CANCELLED')
      for (const [i, status] of (['PRESENT', 'PRESENT', 'ABSENT'] as const).entries()) {
        await ctx.prisma.client.attendanceRecord.create({ data: { tenantId: s.tenantId, sessionId: held[i].id, studentId: me.id, status, checkedInAt: held[i].startsAt } })
      }
      const [course] = await service.courses(me)
      // The lesson 40 days ago was before enrolment; the cancelled one does not count.
      expect(course).toMatchObject({ courseId: s.course.id, title: { uz: 'Kurs' }, center: 'Center', group: 'A', status: 'ACTIVE', lessonsHeld: 3, lessonsAttended: 2, attendancePercent: 67 })
      expect(await service.courses(await s.student())).toEqual([])
    })
  })
})
