import { randomUUID } from 'node:crypto'
import { PrismaPg } from '@prisma/adapter-pg'
import { registrySearchKey, TECHNIKUMS, type Technikum } from '@ilmora/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { importTechnikums } from '../prisma/registry-import'
import { seedRegistryDistricts, seedRegistryReference } from '../prisma/registry-reference'
import { PrismaClient } from '../src/generated/prisma/client'
import { DB_AVAILABLE } from './helpers'

/** The official technikum list into "Institution" (prisma/registry-import.ts): ids, idempotence, claimed records, STIR clashes, districts. */
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
    await seedRegistryDistricts(prisma, id)
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
    const one = await prisma.institution.findUniqueOrThrow({ where: { id: id(1) }, include: { region: true, district: true } })
    expect(one).toMatchObject({ tenantId, stir: '100000001', type: 'TECHNIKUM', source: 'IMPORT', status: 'UNCLAIMED', districtName: 'Asaka tumani', searchKey: registrySearchKey('Test 1 texnikumi'), officialName: 'Test 1 texnikumi' })
    expect(one.region).toMatchObject({ code: '1703', slug: 'andijan' })
    // The list's district is linked to its SOATO district and kept as written.
    expect(one.district).toMatchObject({ code: '1703224', regionId: one.regionId })
    // Found by the Russian and the former name too.
    expect(one.searchText).toContain(registrySearchKey('Тестовый техникум 1'))
    expect(one.searchText).toContain('asaka kasb hunar kolleji')

    const again = await importTechnikums(prisma, tenantId, { list, apply: true })
    expect(again).toMatchObject({ created: [], updated: [], enriched: [], unchanged: 2, districts: { linked: 1, unlinked: [], available: 206 } })
  })

  it('follows the list for unclaimed records and never clears a value the list lacks', async () => {
    const tenantId = await tenant('imp-upd')
    await importTechnikums(prisma, tenantId, { list: [t(3, { inn: '100000003', district: 'Xonobod' })], apply: true })
    const r = await importTechnikums(prisma, tenantId, { list: [t(3, { name: 'Test 3 texnikumi (yangi)' })], apply: true })
    expect(r.updated).toEqual([id(3)])
    const row = await prisma.institution.findUniqueOrThrow({ where: { id: id(3) }, include: { district: true } })
    expect(row).toMatchObject({ name: 'Test 3 texnikumi (yangi)', officialName: 'Test 3 texnikumi (yangi)', stir: '100000003', districtName: 'Xonobod' })
    expect(row.district?.code).toBe('1703408')
  })

  it('links a district only when sure, and never replaces the one a representative chose', async () => {
    const tenantId = await tenant('imp-dist')
    const r = await importTechnikums(prisma, tenantId, { list: [t(7, { district: 'Andijon' }), t(8, { district: 'Sh.Rashidov tumani', region: 'jizzakh' })], apply: true })
    // «Andijon» is both a city and a district of the region: text only, reported.
    expect(r.districts).toMatchObject({ linked: 1, unlinked: ['andijan: Andijon'] })
    expect(await prisma.institution.findUniqueOrThrow({ where: { id: id(7) } })).toMatchObject({ districtId: null, districtName: 'Andijon' })
    expect((await prisma.institution.findUniqueOrThrow({ where: { id: id(8) }, include: { district: true } })).district?.code).toBe('1708212')

    // A representative's district stays; an empty one is filled from the list.
    const own = await prisma.district.findFirstOrThrow({ where: { tenantId, code: '1703224' } })
    await prisma.institution.update({ where: { id: id(7) }, data: { status: 'DRAFT', districtId: own.id } })
    await prisma.institution.update({ where: { id: id(8) }, data: { status: 'DRAFT', districtId: null } })
    await importTechnikums(prisma, tenantId, { list: [t(7, { district: 'Andijon shahri' }), t(8, { district: 'Sh.Rashidov tumani', region: 'jizzakh' })], apply: true })
    expect((await prisma.institution.findUniqueOrThrow({ where: { id: id(7) } })).districtId).toBe(own.id)
    expect((await prisma.institution.findUniqueOrThrow({ where: { id: id(8) }, include: { district: true } })).district?.code).toBe('1708212')
  })

  it('leaves what a representative entered and fills only the empty informational fields', async () => {
    const tenantId = await tenant('imp-claim')
    await importTechnikums(prisma, tenantId, { list: [t(4, { nameRu: undefined })], apply: true })
    await prisma.institution.update({ where: { id: id(4) }, data: { status: 'DRAFT', name: 'Our own name', searchKey: registrySearchKey('Our own name') } })

    const r = await importTechnikums(prisma, tenantId, { list: [t(4, { name: 'List name', formerName: 'Old name' })], apply: true })
    expect(r.enriched).toEqual([id(4)])
    const row = await prisma.institution.findUniqueOrThrow({ where: { id: id(4) } })
    // The representative's name stays; the list's name is kept beside it for the reviewer.
    expect(row).toMatchObject({ name: 'Our own name', officialName: 'List name', nameRu: 'Тестовый техникум 4', formerName: 'Old name', status: 'DRAFT' })
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
    // 632 of the 634 districts written in the list are linked; Uchquduq is a town inside Uchquduq district, not one of its own.
    expect(r.districts).toMatchObject({ linked: 632, unlinked: ['navoi: Uchquduq shahri'] })
    expect(await prisma.institution.count({ where: { tenantId, districtId: { not: null } } })).toBe(632)
    expect(await prisma.institution.count({ where: { tenantId, stir: { not: null } } })).toBe(TECHNIKUMS.filter((x) => x.inn).length)
  })
})
