import { registrySearchKey } from '@ilmora/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { DB_AVAILABLE, TestContext } from './helpers'

/**
 * A company's contact requests are unique per channel, not per student (migration 20261119000000, security review 11.11
 * №126): asking a graduate by name and then the same student's anonymous contract-help card (or the reverse) must not
 * answer «already asked» — that answer would tell the company that the anonymous card is that graduate.
 */
describe.skipIf(!DB_AVAILABLE)('contact requests: one per channel', () => {
  const ctx = new TestContext()
  const db = ctx.prisma.client
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  it('lets one company ask the same student once by name and once on the anonymous card, never twice in one channel', async () => {
    const t = await ctx.makeTenant('contact-ch')
    const student = await ctx.makeStudent(t.tenantId)
    await TenantContext.forTenant(t.tenantId, async () => {
      const tenantId = t.tenantId
      const company = await db.company.create({ data: { tenantId, stir: '409999999', name: 'Soft Co', searchKey: registrySearchKey('Soft Co'), status: 'APPROVED', approvedAt: new Date() } })
      const card = await db.contractHelpRequest.create({ data: { tenantId, userId: student.id, motivation: 'Yordam kerak', yearsToWork: 3, openKey: student.id } })
      const ask = (source: 'GRADUATE' | 'CONTRACT_HELP', contractHelpId: string | null = null) =>
        db.contactRequest.create({ data: { tenantId, companyId: company.id, userId: student.id, source, contractHelpId } })

      await ask('GRADUATE')
      await ask('CONTRACT_HELP', card.id)
      expect(await db.contactRequest.count({ where: { companyId: company.id, userId: student.id } })).toBe(2)

      // Within one channel the rule stays: the service turns this into 409 contact_request_exists.
      await expect(ask('GRADUATE')).rejects.toMatchObject({ code: 'P2002' })
      await expect(ask('CONTRACT_HELP', card.id)).rejects.toMatchObject({ code: 'P2002' })
    })
  })
})
