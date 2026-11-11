import { registrySearchKey } from '@ilmora/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { seedRegistryReference } from '../prisma/registry-reference'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { DB_AVAILABLE, TestContext } from './helpers'

/**
 * ТЗ «Студенты у компании, Вакансии у учреждения» 11.11, раздел 6.1 (migrations 20261121000000 and 20261121000100): what
 * the database itself holds, whatever the code does.
 */
describe.skipIf(!DB_AVAILABLE)('students section and vacancy broadcasts: database rules', () => {
  const ctx = new TestContext()
  const db = ctx.prisma.client
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  /** An approved company, an institution, a direction, a vacancy and a student of the institution. */
  async function setup(label: string) {
    const t = await ctx.makeTenant(label)
    const tenantId = t.tenantId
    await TenantContext.system(() => seedRegistryReference(db as never, tenantId))
    const student = await ctx.makeStudent(tenantId)
    return TenantContext.forTenant(tenantId, async () => {
      const it = await db.industry.findFirstOrThrow({ where: { slug: 'it' } })
      const region = await db.region.findFirstOrThrow({ where: { code: '1726' } })
      const direction = await db.direction.create({ data: { tenantId, name: 'Dasturlaş', searchKey: registrySearchKey('Dasturlaş'), industryId: it.id } })
      const institution = await db.institution.create({ data: { tenantId, type: 'TECHNIKUM', name: 'IT texnikumi', searchKey: registrySearchKey('IT texnikumi'), regionId: region.id, source: 'IMPORT', status: 'APPROVED', approvedAt: new Date() } })
      const company = await db.company.create({ data: { tenantId, stir: '407777777', name: 'Soft Co', searchKey: registrySearchKey('Soft Co'), status: 'APPROVED', approvedAt: new Date() } })
      const vacancy = await db.vacancy.create({ data: { tenantId, companyId: company.id, kind: 'PRACTICE', title: 'Amaliyot', regionId: region.id, format: 'ONSITE', seats: 2 } })
      return { tenantId, student, region, direction, institution, company, vacancy }
    })
  }

  it('keeps one contact request per company and student across the named channels, the anonymous card apart', async () => {
    const s = await setup('stu-named')
    await TenantContext.forTenant(s.tenantId, async () => {
      const card = await db.contractHelpRequest.create({ data: { tenantId: s.tenantId, userId: s.student.id, motivation: 'Yordam kerak', yearsToWork: 3, openKey: s.student.id } })
      const ask = (source: 'GRADUATE' | 'STUDENTS' | 'CONTRACT_HELP', contractHelpId: string | null = null) =>
        db.contactRequest.create({ data: { tenantId: s.tenantId, companyId: s.company.id, userId: s.student.id, source, contractHelpId } })

      await ask('STUDENTS')
      // Asked by name in «Студенты»: the graduation announcement shows that request, never a second one — and back.
      await expect(ask('GRADUATE')).rejects.toMatchObject({ code: 'P2002' })
      await expect(ask('STUDENTS')).rejects.toMatchObject({ code: 'P2002' })
      // The anonymous contract-help card stays its own channel (№126): asking there must not answer «already asked».
      await ask('CONTRACT_HELP', card.id)
      expect(await db.contactRequest.count({ where: { companyId: s.company.id, userId: s.student.id } })).toBe(2)
    })
  })

  it('keeps one active «show my card to companies of my industry» consent, apart from the other kinds', async () => {
    const s = await setup('stu-consent')
    await TenantContext.forTenant(s.tenantId, async () => {
      const give = (kind: 'INDUSTRY_CARD' | 'GRADUATE_CARD') => db.studentConsent.create({ data: { tenantId: s.tenantId, userId: s.student.id, kind, textVersion: 'v1' } })
      await give('GRADUATE_CARD')
      const first = await give('INDUSTRY_CARD')
      await expect(give('INDUSTRY_CARD')).rejects.toMatchObject({ code: 'P2002' })
      await db.studentConsent.update({ where: { id: first.id }, data: { revokedAt: new Date() } })
      await give('INDUSTRY_CARD')
    })
  })

  it('makes a JOB always paid', async () => {
    const s = await setup('stu-job')
    await TenantContext.forTenant(s.tenantId, async () => {
      const job = (paid: boolean) => db.vacancy.create({ data: { tenantId: s.tenantId, companyId: s.company.id, kind: 'JOB', title: 'Dasturchi', regionId: s.region.id, format: 'HYBRID', seats: 1, paid, stipendMinor: paid ? 8_000_000_00n : null } })
      await expect(job(false)).rejects.toThrow(/Vacancy_job_paid_check/)
      const ok = await job(true)
      await expect(db.vacancy.update({ where: { id: ok.id }, data: { paid: false } })).rejects.toThrow(/Vacancy_job_paid_check/)
      // Practice and internship may still be unpaid.
      expect(s.vacancy.paid).toBe(false)
    })
  })

  it('sends a vacancy to a student once, keeps recipients on the broadcast\'s vacancy and checks the courses', async () => {
    const s = await setup('stu-cast')
    await TenantContext.forTenant(s.tenantId, async () => {
      const other = await db.vacancy.create({ data: { tenantId: s.tenantId, companyId: s.company.id, kind: 'INTERNSHIP', title: 'Stajirovka', regionId: s.region.id, format: 'REMOTE', seats: 1 } })
      const broadcast = (courses: number[], recipientsCount = 1) =>
        db.vacancyBroadcast.create({ data: { tenantId: s.tenantId, vacancyId: s.vacancy.id, institutionId: s.institution.id, courses, createdById: s.student.id, recipientsCount, directions: { create: [{ directionId: s.direction.id }] } } })

      for (const bad of [[], [0], [12], [2, 12]]) await expect(broadcast(bad)).rejects.toThrow(/VacancyBroadcast_courses_check/)
      await expect(broadcast([1], -1)).rejects.toThrow(/VacancyBroadcast_recipientsCount_check/)

      const first = await broadcast([2, 3])
      const second = await broadcast([4])
      const deliver = (broadcastId: string, vacancyId: string) =>
        db.vacancyBroadcastRecipient.create({ data: { tenantId: s.tenantId, broadcastId, vacancyId, userId: s.student.id } })

      await deliver(first.id, s.vacancy.id)
      // A retried batch, or another send of the same vacancy, does not reach the student again.
      await expect(deliver(first.id, s.vacancy.id)).rejects.toMatchObject({ code: 'P2002' })
      await expect(deliver(second.id, s.vacancy.id)).rejects.toMatchObject({ code: 'P2002' })
      // A recipient row cannot claim another vacancy than its broadcast's.
      await expect(deliver(second.id, other.id)).rejects.toMatchObject({ code: 'P2003' })

      expect(await db.vacancyBroadcastRecipient.count({ where: { vacancyId: s.vacancy.id } })).toBe(1)
      expect(await db.vacancyBroadcastDirection.count({ where: { broadcastId: first.id } })).toBe(1)
    })
  })
})
