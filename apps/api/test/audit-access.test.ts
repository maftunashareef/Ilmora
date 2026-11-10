import { describe, expect, it } from 'vitest'
import type { Env } from '../src/config/env'
import type { PrismaService } from '../src/infra/prisma/prisma.service'
import type { RequestActor } from '../src/infra/tenancy/tenant-context'
import type { AuditService } from '../src/modules/audit/audit.service'
import { ManageService } from '../src/modules/manage/manage.service'
import type { SessionsService } from '../src/modules/sessions/sessions.service'
import type { SiteService } from '../src/modules/site/site.service'
import { notificationsStub } from './stubs'

/** ТЗ 8, 9.4: the audit log is the Super Admin's; a finance admin reads only the money records. */
describe('Audit log access', () => {
  const setup = () => {
    const wheres: unknown[] = []
    const auditEvent = {
      findMany: async ({ where }: { where: unknown }) => (wheres.push(where), []),
      count: async () => 0,
    }
    const service = new ManageService(
      { client: { auditEvent } } as unknown as PrismaService,
      {} as unknown as AuditService, {} as unknown as SessionsService, {} as unknown as SiteService, notificationsStub, {} as unknown as Env,
    )
    return { service, wheres }
  }
  const superAdmin: RequestActor = { id: 'sa', roles: ['PLATFORM_ADMIN', 'FINANCE_ADMIN'] }
  const finance: RequestActor = { id: 'fin', roles: ['FINANCE_ADMIN'] }

  it('the Super Admin reads everything, by any entity type', async () => {
    const { service, wheres } = setup()
    await service.audits('t', superAdmin, {})
    await service.audits('t', superAdmin, { entityType: 'User' })
    expect(wheres).toEqual([{ tenantId: 't' }, { tenantId: 't', entityType: 'User' }])
  })

  it('a finance admin gets payments, subscriptions and refund requests only — never contact views, reviews or accounts', async () => {
    const { service, wheres } = setup()
    await service.audits('t', finance, {})
    await service.audits('t', finance, { entityType: 'Payment', entityId: 'p1' })
    expect(wheres).toEqual([{ tenantId: 't', entityType: { in: ['Payment', 'Subscription', 'RefundRequest'] } }, { tenantId: 't', entityType: 'Payment', entityId: 'p1' }])
    for (const entityType of ['User', 'StudentCertificate', 'Institution', 'Company', 'ContactRequest']) {
      expect(await service.audits('t', finance, { entityType })).toMatchObject({ total: 0, items: [] })
    }
    expect(wheres).toHaveLength(2)
  })
})
