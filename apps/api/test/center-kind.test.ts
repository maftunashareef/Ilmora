import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { registrySearchKey } from '@ilmora/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { DB_AVAILABLE, TestContext } from './helpers'

/**
 * The kind of a center (migration 20261125000000): a learning center by default, the registry record's type when one is
 * linked, and the demo centers spread over every kind. The fill-in is run from the migration file itself.
 */
const MIGRATION = join(__dirname, '../prisma/migrations/20261125000000_center_kind/migration.sql')
const fillIn = (() => {
  const text = readFileSync(MIGRATION, 'utf8').replace(/--.*$/gm, '')
  return text.split(';').map((s) => s.trim()).filter((s) => s.startsWith('UPDATE'))
})()

describe.skipIf(!DB_AVAILABLE)('center kind', () => {
  const ctx = new TestContext()
  const db = ctx.prisma.client
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  it('is a learning center by default, the linked registry record\'s type, and every kind for the demo centers', async () => {
    expect(fillIn).toHaveLength(2)
    const t = await ctx.makeTenant('center-kind')
    const tenantId = t.tenantId
    await TenantContext.forTenant(tenantId, async () => {
      expect((await db.center.findFirstOrThrow({ where: { id: t.center.id } })).kind).toBe('TRAINING_CENTER')

      const linked = await db.center.create({ data: { tenantId, slug: `linked-${tenantId}`, name: 'Andijon kolleji', district: {}, description: {} } })
      await db.institution.create({ data: { tenantId, type: 'COLLEGE', name: 'Andijon kolleji', searchKey: registrySearchKey('Andijon kolleji'), source: 'IMPORT', centerId: linked.id } })
      const demo = await db.center.upsert({ where: { id: 'ce-mezon' }, update: { name: 'Mezon Design School (demo)', kind: 'TRAINING_CENTER' }, create: { id: 'ce-mezon', tenantId, slug: `ce-mezon-${tenantId}`, name: 'Mezon Design School (demo)', district: {}, description: {} } })
      // A real center that happens to share a demo id but not the «(demo)» mark keeps its kind.
      const real = await db.center.upsert({ where: { id: 'ce-ustoz' }, update: { name: 'Ustoz', kind: 'TRAINING_CENTER' }, create: { id: 'ce-ustoz', tenantId, slug: `ce-ustoz-${tenantId}`, name: 'Ustoz', district: {}, description: {} } })

      for (const sql of fillIn) await TenantContext.system(() => db.$executeRawUnsafe(sql))

      const kind = async (id: string) => (await TenantContext.system(() => db.center.findFirstOrThrow({ where: { id } }))).kind
      expect(await kind(t.center.id)).toBe('TRAINING_CENTER')
      expect(await kind(linked.id)).toBe('COLLEGE')
      expect(await kind(demo.id)).toBe('UNIVERSITY')
      expect(await kind(real.id)).toBe('TRAINING_CENTER')

      await TenantContext.system(() => db.center.deleteMany({ where: { id: { in: [demo.id, real.id] } }, hardDelete: true } as never))
    })
  })
})
