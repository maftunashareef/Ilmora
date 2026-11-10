import { randomUUID } from 'node:crypto'
import { PrismaPg } from '@prisma/adapter-pg'
import { registrySearchKey, TECHNIKUMS, type Technikum } from '@ilmora/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { importTechnikums } from '../prisma/registry-import'
import { seedRegistryReference } from '../prisma/registry-reference'
import { PrismaClient } from '../src/generated/prisma/client'
import { DB_AVAILABLE } from './helpers'

/** The official technikum list into "Institution" (prisma/registry-import.ts): ids, idempotence, claimed records, STIR clashes. */
describe.skipIf(!DB_AVAILABLE)('technikum import', () => {
  let prisma: PrismaClient
  beforeAll(() => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
  })
  afterAll(() => prisma?.$disconnect())

  const tenant = async (label: string) => {
    const id = `${label}-${randomUUID().slice(0, 8)}`
    await prisma.tenant.create({ data: { id, slug: id, name: id, webOrigin: 'http://localhost:3000' } })
    await seedRegistryReference(prisma, id)
    return id
  }
  // Ids are primary keys shared by all tenants, so every run of the suite gets its own.
  const run = randomUUID().slice(0, 8)
  const id = (n: number) => `pe-${run}-${n}`
  const t = (n: number, extra: Partial<Technikum> = {}): Technikum => ({
    id: id(n), name: `Test ${n} texnikumi`, nameRu: `Тестовый техникум ${n}`, region: 'andijan', ownership: 'STATE', ...extra,
  })

  it('reports without writing, then creates the records with the web app ids, then changes nothing', async () => {
    const tenantId = await tenant('imp-new')
    const list = [t(1, { inn: '100000001', district: 'Asaka tumani', formerName: 'Asaka kasb-hunar kolleji' }), t(2, { region: 'tashkent-city', ownership: 'PRIVATE' })]

    const dry = await importTechnikums(prisma, tenantId, { list })
    expect(dry).toMatchObject({ created: [id(1), id(2)], applied: false })
    expect(await prisma.institution.count({ where: { tenantId } })).toBe(0)

    await importTechnikums(prisma, tenantId, { list, apply: true })
    const one = await prisma.institution.findUniqueOrThrow({ where: { id: id(1) }, include: { region: true } })
    expect(one).toMatchObject({ tenantId, stir: '100000001', type: 'TECHNIKUM', source: 'IMPORT', status: 'UNCLAIMED', districtName: 'Asaka tumani', searchKey: registrySearchKey('Test 1 texnikumi') })
    expect(one.region).toMatchObject({ code: '1703', slug: 'andijan' })
    // Found by the Russian and the former name too.
    expect(one.searchText).toContain(registrySearchKey('Тестовый техникум 1'))
    expect(one.searchText).toContain('asaka kasb hunar kolleji')

    const again = await importTechnikums(prisma, tenantId, { list, apply: true })
    expect(again).toMatchObject({ created: [], updated: [], enriched: [], unchanged: 2 })
  })

  it('follows the list for unclaimed records and never clears a value the list lacks', async () => {
    const tenantId = await tenant('imp-upd')
    await importTechnikums(prisma, tenantId, { list: [t(3, { inn: '100000003', district: 'Xonobod' })], apply: true })
    const r = await importTechnikums(prisma, tenantId, { list: [t(3, { name: 'Test 3 texnikumi (yangi)' })], apply: true })
    expect(r.updated).toEqual([id(3)])
    expect(await prisma.institution.findUniqueOrThrow({ where: { id: id(3) } })).toMatchObject({ name: 'Test 3 texnikumi (yangi)', stir: '100000003', districtName: 'Xonobod' })
  })

  it('leaves what a representative entered and fills only the empty informational fields', async () => {
    const tenantId = await tenant('imp-claim')
    await importTechnikums(prisma, tenantId, { list: [t(4, { nameRu: undefined })], apply: true })
    await prisma.institution.update({ where: { id: id(4) }, data: { status: 'DRAFT', name: 'Our own name', searchKey: registrySearchKey('Our own name') } })

    const r = await importTechnikums(prisma, tenantId, { list: [t(4, { name: 'List name', formerName: 'Old name' })], apply: true })
    expect(r.enriched).toEqual([id(4)])
    const row = await prisma.institution.findUniqueOrThrow({ where: { id: id(4) } })
    expect(row).toMatchObject({ name: 'Our own name', nameRu: 'Тестовый техникум 4', formerName: 'Old name', status: 'DRAFT' })
    expect(row.searchText).toContain('our own name')
  })

  it('does not duplicate an institution that registered itself with the same STIR, and reports it', async () => {
    const tenantId = await tenant('imp-stir')
    const self = await prisma.institution.create({ data: { tenantId, type: 'TECHNIKUM', name: 'Self', searchKey: 'self', stir: '100000005', source: 'SELF', status: 'PENDING' } })
    const student = await prisma.institution.create({
      data: { tenantId, type: 'TECHNIKUM', name: 'Test 6 texnikumi', searchKey: registrySearchKey('Test 6 texnikumi'), source: 'STUDENT', regionId: (await prisma.region.findFirstOrThrow({ where: { tenantId, code: '1703' } })).id },
    })

    const r = await importTechnikums(prisma, tenantId, { list: [t(5, { inn: '100000005' }), t(6)], apply: true })
    expect(r.stirConflicts).toEqual([{ id: id(5), name: 'Test 5 texnikumi', stir: '100000005', holder: { id: self.id, name: 'Self', source: 'SELF', status: 'PENDING' } }])
    expect(r.sameName).toMatchObject([{ id: id(6), holder: { id: student.id, source: 'STUDENT' } }])
    expect(await prisma.institution.findUnique({ where: { id: id(5) } })).toBeNull()
    expect(r.created).toEqual([id(6)])
  })

  it('loads the whole official list: every region maps, no STIR clashes', async () => {
    const tenantId = await tenant('imp-full')
    const list = TECHNIKUMS.map((x) => ({ ...x, id: `${x.id}-${run}` }))
    const r = await importTechnikums(prisma, tenantId, { list, apply: true })
    expect(r).toMatchObject({ total: TECHNIKUMS.length, missingRegion: [], stirConflicts: [], sameName: [] })
    expect(r.created).toHaveLength(TECHNIKUMS.length)
    expect(await prisma.institution.count({ where: { tenantId, stir: { not: null } } })).toBe(TECHNIKUMS.filter((x) => x.inn).length)
  })
})
