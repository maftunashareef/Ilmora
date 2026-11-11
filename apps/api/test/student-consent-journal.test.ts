import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { registrySearchKey } from '@ilmora/shared'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { DB_AVAILABLE, TestContext } from './helpers'

/**
 * The consent journal (ТЗ 8, migration 20261120000000): it outlives the account, and a student has at most one active
 * consent of each kind — the database holds both, whatever the code does.
 */
describe.skipIf(!DB_AVAILABLE)('consent journal', () => {
  const ctx = new TestContext()
  const db = ctx.prisma.client
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  it('keeps one active consent of a kind; giving it again after a revocation adds a row', async () => {
    const t = await ctx.makeTenant('consent-one')
    const student = await ctx.makeStudent(t.tenantId)
    await TenantContext.forTenant(t.tenantId, async () => {
      const give = (kind: 'GRADUATE_CARD' | 'CONTRACT_HELP_CARD') => db.studentConsent.create({ data: { tenantId: t.tenantId, userId: student.id, kind, textVersion: 'v1' } })
      const first = await give('GRADUATE_CARD')
      await give('CONTRACT_HELP_CARD')
      await expect(give('GRADUATE_CARD')).rejects.toMatchObject({ code: 'P2002' })

      await db.studentConsent.update({ where: { id: first.id }, data: { revokedAt: new Date() } })
      await give('GRADUATE_CARD')
      expect(await db.studentConsent.count({ where: { userId: student.id, kind: 'GRADUATE_CARD' } })).toBe(2)
    })
  })

  it('lets contacts be opened to a company more than once (one per request)', async () => {
    const t = await ctx.makeTenant('consent-co')
    const student = await ctx.makeStudent(t.tenantId)
    await TenantContext.forTenant(t.tenantId, async () => {
      const company = await db.company.create({ data: { tenantId: t.tenantId, stir: '408888888', name: 'Data Co', searchKey: registrySearchKey('Data Co'), status: 'APPROVED', approvedAt: new Date() } })
      for (let i = 0; i < 2; i++) {
        await db.studentConsent.create({ data: { tenantId: t.tenantId, userId: student.id, kind: 'COMPANY_CONTACTS', companyId: company.id, textVersion: 'contact-request' } })
      }
      expect(await db.studentConsent.count({ where: { userId: student.id, kind: 'COMPANY_CONTACTS', revokedAt: null } })).toBe(2)
    })
  })

  it('outlives the account: a hard delete of a student with consents is refused, a soft delete keeps the journal', async () => {
    const t = await ctx.makeTenant('consent-keep')
    const student = await ctx.makeStudent(t.tenantId)
    await TenantContext.forTenant(t.tenantId, async () => {
      await db.studentConsent.create({ data: { tenantId: t.tenantId, userId: student.id, kind: 'GRADUATE_CARD', textVersion: 'v1' } })
      await expect(db.user.delete({ where: { id: student.id }, hardDelete: true } as never)).rejects.toMatchObject({ code: 'P2003' })

      // Accounts are soft-deleted (deletedAt): the journal stays with them.
      await db.user.update({ where: { id: student.id }, data: { deletedAt: new Date(), isActive: false } })
      expect(await db.studentConsent.count({ where: { userId: student.id } })).toBe(1)
    })
  })
})
