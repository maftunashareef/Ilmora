import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { DB_AVAILABLE, TestContext } from './helpers'

/**
 * Homework files (ТЗ 2026-11-18, 8.4; migration 20261126000300): what the database itself holds, before any code uploads a
 * ZIP — the size up to 1024 MB, the key only in the homework area of the bucket, a .zip name, a refusal with its reason,
 * a center's 20 GB by default, a hand-in that is only a file.
 */
describe.skipIf(!DB_AVAILABLE)('Homework files: database checks (ТЗ 18.11, 8.4)', () => {
  const ctx = new TestContext()
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  const refused = (p: Promise<unknown>, constraint: string) =>
    p.then(() => 'ok', (e: Error) => (e.message.includes(constraint) ? 'refused' : e.message))

  it('holds the size, the key, the name, the refusal reason, the quota and a hand-in of a file only', async () => {
    const t = await ctx.makeTenant('hwfile')
    const db = ctx.prisma.client
    await TenantContext.system(async () => {
      const center = await db.center.findUniqueOrThrow({ where: { id: t.center.id } })
      expect(center.homeworkQuotaBytes).toBe(20n * 1024n ** 3n)

      const hw = await db.homework.create({ data: { tenantId: t.tenantId, groupId: t.group.id, title: 'Vazifa', description: 'Matn', submitModes: ['ZIP'], dueAt: new Date(Date.now() + 86_400_000) } })
      let n = 0
      const file = (over: Record<string, unknown> = {}) =>
        db.homeworkFile.create({ data: { tenantId: t.tenantId, centerId: t.center.id, homeworkId: hw.id, kind: 'SUBMISSION', objectKey: `incoming/homework/${t.tenantId}/${++n}.zip`, fileName: 'site.zip', sizeBytes: 1024n, ...over } })

      expect(await refused(file({ sizeBytes: 1024n ** 3n + 1n }), 'HomeworkFile_size_check')).toBe('refused')
      expect(await refused(file({ sizeBytes: 0n }), 'HomeworkFile_size_check')).toBe('refused')
      expect(await refused(file({ objectKey: 'docs/passport.pdf' }), 'HomeworkFile_key_check')).toBe('refused')
      expect(await refused(file({ fileName: 'virus.exe' }), 'HomeworkFile_name_check')).toBe('refused')
      expect(await refused(file({ status: 'REJECTED' }), 'HomeworkFile_reject_check')).toBe('refused')
      expect(await refused(file({ status: 'READY', uploadId: 'up-1' }), 'HomeworkFile_upload_check')).toBe('refused')
      expect(await refused(db.center.update({ where: { id: t.center.id }, data: { homeworkQuotaBytes: -1n } }), 'Center_homeworkQuotaBytes_check')).toBe('refused')

      const ok = await file({ sizeBytes: 1024n ** 3n, fileName: 'Site.ZIP', status: 'READY', objectKey: `homework/${t.tenantId}/ready.zip` })
      expect(await refused(file({ status: 'REJECTED', rejectReason: 'zip_bomb' }), 'HomeworkFile_reject_check')).toBe('ok')

      // A hand-in may be only the ZIP; still not empty.
      const student = await db.user.create({ data: { tenantId: t.tenantId, login: `st-${t.tenantId}`, displayName: 'Student' } })
      const sub = await db.homeworkSubmission.create({ data: { tenantId: t.tenantId, homeworkId: hw.id, studentId: student.id, fileId: ok.id } })
      expect(sub.fileId).toBe(ok.id)
      expect(await refused(db.homeworkSubmission.create({ data: { tenantId: t.tenantId, homeworkId: hw.id, studentId: student.id } }), 'HomeworkSubmission_content_check')).toBe('refused')
      // A file handed in cannot be deleted from under the hand-in.
      expect(await refused(db.homeworkFile.delete({ where: { id: ok.id } }), 'HomeworkSubmission_fileId_fkey')).toBe('refused')
    })
  })
})
