import { Injectable } from '@nestjs/common'
import { type DocumentLinkDto, type DocumentUploadDto, type IlmoraCourseDto, type L, STUDENT_CERTIFICATES_MAX, type StudentCertificateDto } from '@ilmora/shared'
import { AppError } from '../../common/errors'
import { PrismaService } from '../../infra/prisma/prisma.service'
import { DOC_LINK_SECONDS, PrivateDocsService } from '../../infra/storage/private-docs.service'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import type { CertificateInput, CertificatePatch, CertificateUploadInput } from './certificates.schemas'

const SELECT = { id: true, title: true, issuer: true, issuedAt: true, contentType: true, sizeBytes: true, createdAt: true } as const
type Row = { id: string; title: string; issuer: string | null; issuedAt: Date | null; contentType: string; sizeBytes: number; createdAt: Date }
const toDto = (r: Row): StudentCertificateDto => ({
  id: r.id, title: r.title, issuer: r.issuer, issuedAt: r.issuedAt?.toISOString().slice(0, 10) ?? null, contentType: r.contentType, sizeBytes: r.sizeBytes, createdAt: r.createdAt.toISOString(),
})
const prefixOf = (tenantId: string, userId: string) => `student-certs/${tenantId}/${userId}/`
const dateOf = (s: string | null | undefined) => (s ? new Date(`${s}T00:00:00Z`) : null)

/**
 * The student's certificates (ТЗ 5.5): files in the private bucket (PDF / JPG / PNG up to 10 MB, at most 20), a title,
 * the issuer and the date; renamed and deleted by the student. Authenticity is not checked. Only the student reads the
 * files here — companies get them later through an accepted contact request or a vacancy application (ТЗ 9.4).
 * «Курсы в ILMORA» are the student's own subscriptions to learning centers, with attendance — ILMORA issues no certificates.
 */
@Injectable()
export class CertificatesService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly docs: PrivateDocsService) {}

  async list(actor: RequestActor): Promise<StudentCertificateDto[]> {
    const rows = await this.prisma.client.studentCertificate.findMany({ where: { userId: actor.id }, orderBy: { createdAt: 'desc' }, select: SELECT })
    return rows.map(toDto)
  }

  /** Step 1: a presigned PUT under the student's own prefix — refused once the 20 files are there. */
  async uploadUrl(tenantId: string, actor: RequestActor, input: CertificateUploadInput): Promise<DocumentUploadDto> {
    await this.assertRoom(actor)
    const key = this.docs.newKey(prefixOf(tenantId, actor.id), input.contentType)
    return { uploadUrl: await this.docs.uploadUrl(key, input.contentType, input.fileSize), key, expiresInSeconds: 600 }
  }

  /** Step 2: the server checks the upload (prefix, size, real type) and only then records the certificate. */
  async add(tenantId: string, actor: RequestActor, input: CertificateInput): Promise<StudentCertificateDto> {
    await this.assertRoom(actor)
    if (await this.prisma.client.studentCertificate.findFirst({ where: { userId: actor.id, fileKey: input.key }, select: { id: true } })) throw AppError.conflict('certificate_exists', 'This file is already added')
    const { type, size } = await this.docs.verifyUpload(input.key, prefixOf(tenantId, actor.id))
    const row = await this.prisma.client.studentCertificate.create({
      data: { tenantId, userId: actor.id, title: input.title, issuer: input.issuer ?? null, issuedAt: dateOf(input.issuedAt), fileKey: input.key, contentType: type, sizeBytes: size },
      select: SELECT,
    })
    await this.audit.record({ action: 'student.certificate.add', entityType: 'StudentCertificate', entityId: row.id, after: { title: row.title, type, size } })
    return toDto(row)
  }

  async update(actor: RequestActor, id: string, input: CertificatePatch): Promise<StudentCertificateDto> {
    await this.own(actor, id)
    const row = await this.prisma.client.studentCertificate.update({
      where: { id },
      data: { ...(input.title !== undefined ? { title: input.title } : {}), ...(input.issuer !== undefined ? { issuer: input.issuer } : {}), ...(input.issuedAt !== undefined ? { issuedAt: dateOf(input.issuedAt) } : {}) },
      select: SELECT,
    })
    return toDto(row)
  }

  /** The row and the file go together. */
  async remove(actor: RequestActor, id: string): Promise<void> {
    const cert = await this.own(actor, id)
    await this.prisma.client.studentCertificate.delete({ where: { id } })
    await this.docs.remove(cert.fileKey).catch(() => undefined)
    await this.audit.record({ action: 'student.certificate.delete', entityType: 'StudentCertificate', entityId: id, before: { title: cert.title } })
  }

  /** The student's own file through a 5-minute link. */
  async link(actor: RequestActor, id: string): Promise<DocumentLinkDto> {
    const cert = await this.own(actor, id)
    return { url: await this.docs.downloadUrl(cert.fileKey), expiresInSeconds: DOC_LINK_SECONDS }
  }

  /**
   * «Курсы в ILMORA» (ТЗ 5.5): every course the student had a seat in through a subscription, with the lessons held
   * since enrolment (until it ended) and those attended. Pending seats of unpaid checkouts are not courses yet.
   */
  async courses(actor: RequestActor): Promise<IlmoraCourseDto[]> {
    const enrollments = await this.prisma.client.enrollment.findMany({
      where: { studentId: actor.id, status: { in: ['ACTIVE', 'COMPLETED', 'CANCELLED'] } },
      orderBy: { enrolledAt: 'desc' },
      select: {
        status: true, enrolledAt: true, cancelledAt: true, updatedAt: true, groupId: true,
        course: { select: { id: true, title: true, center: { select: { name: true } } } },
        group: { select: { name: true } },
      },
    })
    return Promise.all(
      enrollments.map(async (e) => {
        const until = e.status === 'ACTIVE' ? new Date() : (e.cancelledAt ?? e.updatedAt)
        const window = { groupId: e.groupId, status: 'COMPLETED' as const, startsAt: { gte: e.enrolledAt, lte: until } }
        const [held, attended] = await Promise.all([
          this.prisma.client.lessonSession.count({ where: window }),
          this.prisma.client.attendanceRecord.count({ where: { studentId: actor.id, status: 'PRESENT', session: window } }),
        ])
        return {
          courseId: e.course.id, title: e.course.title as L, center: e.course.center.name, group: e.group.name,
          status: e.status as IlmoraCourseDto['status'], enrolledAt: e.enrolledAt.toISOString(),
          lessonsHeld: held, lessonsAttended: attended, attendancePercent: held > 0 ? Math.round((attended / held) * 100) : null,
        }
      }),
    )
  }

  private async assertRoom(actor: RequestActor) {
    if ((await this.prisma.client.studentCertificate.count({ where: { userId: actor.id } })) >= STUDENT_CERTIFICATES_MAX) {
      throw AppError.conflict('certificates_limit', `At most ${STUDENT_CERTIFICATES_MAX} certificates`)
    }
  }

  /** The student's own certificate; anyone else's reads as «not found». */
  private async own(actor: RequestActor, id: string) {
    const cert = await this.prisma.client.studentCertificate.findFirst({ where: { id, userId: actor.id }, select: { id: true, title: true, fileKey: true } })
    if (!cert) throw AppError.notFound('Certificate')
    return cert
  }
}
