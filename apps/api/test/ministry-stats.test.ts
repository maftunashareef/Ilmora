import { inflateRawSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StatsTableDto } from '@ilmora/shared'
import { registrySearchKey } from '@ilmora/shared'
import { seedRegistryReference } from '../prisma/registry-reference'
import { ROLES_KEY } from '../src/common/decorators'
import { buildXlsx, crc32 } from '../src/common/xlsx'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { InstitutionsService } from '../src/modules/institutions/institutions.service'
import { MinistryRegistryService } from '../src/modules/ministry/ministry-registry.service'
import { MinistryStatsService } from '../src/modules/ministry/ministry-stats.service'
import { MinistryController } from '../src/modules/ministry/ministry.controller'
import { DB_AVAILABLE, TestContext } from './helpers'
import { notificationsStub } from './stubs'

/** Reads the files of a zip (enough for the xlsx we write: deflate, sizes in the local headers). */
function unzip(buf: Buffer): Map<string, string> {
  const out = new Map<string, string>()
  let p = 0
  while (buf.readUInt32LE(p) === 0x04034b50) {
    const size = buf.readUInt32LE(p + 18)
    const nameLen = buf.readUInt16LE(p + 26)
    const extra = buf.readUInt16LE(p + 28)
    const name = buf.subarray(p + 30, p + 30 + nameLen).toString('utf8')
    const data = buf.subarray(p + 30 + nameLen + extra, p + 30 + nameLen + extra + size)
    out.set(name, inflateRawSync(data).toString('utf8'))
    p += 30 + nameLen + extra + size
  }
  return out
}

describe('Excel export', () => {
  it('writes a valid workbook: header, numbers, text — and user text never becomes a formula', () => {
    const files = unzip(buildXlsx('Talab va taklif', ['Soha', 'Talabalar'], [['IT va aloqa', 130], ['=HYPERLINK("http://x")', 1], ['+1', null], ['<b>&"</b>', 0.5]]))
    expect([...files.keys()]).toEqual(['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml'])
    const sheet = files.get('xl/worksheets/sheet1.xml')!
    expect(sheet).not.toContain('<f>')
    expect(sheet).toContain('<c r="B2"><v>130</v></c>')
    expect(sheet).toContain('<t xml:space="preserve">=HYPERLINK(&quot;http://x&quot;)</t>')
    expect(sheet).toContain('&lt;b&gt;&amp;&quot;&lt;/b&gt;')
    expect(files.get('xl/workbook.xml')).toContain('name="Talab va taklif"')
  })

  it('computes the zip CRC-32 like the standard', () => {
    expect(crc32(Buffer.from('123456789')).toString(16)).toBe('cbf43926')
  })

  it('the ministry workspace is for the MINISTRY role', () => {
    expect(Reflect.getMetadata(ROLES_KEY, MinistryController)).toEqual(['MINISTRY'])
  })
})

describe.skipIf(!DB_AVAILABLE)('Ministry figures match a hand-counted data set (ТЗ 7, 9.5)', () => {
  const ctx = new TestContext()
  const stats = new MinistryStatsService(ctx.prisma)
  const registry = new MinistryRegistryService(ctx.prisma, new InstitutionsService(ctx.prisma, ctx.audit, notificationsStub))
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())
  const Y = new Date().getUTCFullYear() + 1

  /**
   * A — from the list, approved, Tashkent, technikum, state: IT 100, furniture 50 students; graduates IT 40, furniture 10.
   * B — from the list, nobody registered (Andijan). C — registered itself, approved, Andijan, private college: IT 30.
   * D — from the list, claimed, under review (Tashkent): IT 999 and 500 graduates — never in the official figures.
   * E — added by a student (Tashkent). Company X (approved, Tashkent, IT) asks for 20 IT by Y: A offered 15 (accepted),
   * C 5 (pending), a declined offer of 7 does not count. Company Z is under review.
   */
  const setup = async (label: string) => {
    const t = await ctx.makeTenant(label)
    const db = ctx.prisma.client
    const tenantId = t.tenantId
    await TenantContext.system(() => seedRegistryReference(db as never, tenantId))
    return TenantContext.forTenant(tenantId, async () => {
      const it = await db.industry.findFirstOrThrow({ where: { slug: 'it' } })
      const furniture = await db.industry.findFirstOrThrow({ where: { slug: 'furniture' } })
      const tashkent = await db.region.findFirstOrThrow({ where: { code: '1726' } })
      const andijan = await db.region.findFirstOrThrow({ where: { code: '1703' } })
      const dir = (name: string, industryId: string) => db.direction.create({ data: { tenantId, name, searchKey: registrySearchKey(name), industryId } })
      const dIt = await dir('Dasturlaş', it.id)
      const dMebel = await dir('Mebel', furniture.id)
      const inst = async (name: string, data: Record<string, unknown>, dirs: [string, number][] = []) => {
        const row = await db.institution.create({ data: { tenantId, type: 'TECHNIKUM', name, searchKey: registrySearchKey(name), ...data } as never })
        for (const [directionId, studentsCount] of dirs) await db.institutionDirection.create({ data: { tenantId, institutionId: row.id, directionId, studentsCount } })
        return row
      }
      const now = new Date()
      const A = await inst('A texnikumi', { source: 'IMPORT', status: 'APPROVED', approvedAt: now, regionId: tashkent.id, ownership: 'STATE', stir: '011111111' }, [[dIt.id, 100], [dMebel.id, 50]])
      await inst('B texnikumi', { source: 'IMPORT', status: 'UNCLAIMED', regionId: andijan.id, stir: '022222222' })
      const C = await inst('C kolleji', { source: 'SELF', status: 'APPROVED', approvedAt: now, regionId: andijan.id, type: 'COLLEGE', ownership: 'PRIVATE', stir: '033333333' }, [[dIt.id, 30]])
      const D = await inst('D texnikumi', { source: 'IMPORT', status: 'PENDING', regionId: tashkent.id, stir: '044444444' }, [[dIt.id, 999]])
      await inst('E texnikumi', { source: 'STUDENT', status: 'UNCLAIMED', regionId: tashkent.id })
      const announce = async (institutionId: string, status: 'PUBLISHED' | 'DRAFT', lines: [string, number][]) => {
        const a = await db.graduationAnnouncement.create({ data: { tenantId, institutionId, year: Y, status } })
        for (const [directionId, count] of lines) await db.announcementLine.create({ data: { announcementId: a.id, directionId, count } })
      }
      await announce(A.id, 'PUBLISHED', [[dIt.id, 40], [dMebel.id, 10]])
      await announce(A.id, 'DRAFT', [[dIt.id, 77]])
      await announce(D.id, 'PUBLISHED', [[dIt.id, 500]])
      const X = await db.company.create({ data: { tenantId, stir: '301111111', name: 'X', searchKey: 'x', status: 'APPROVED', approvedAt: now, regionId: tashkent.id } })
      await db.companyIndustry.create({ data: { companyId: X.id, industryId: it.id } })
      const Z = await db.company.create({ data: { tenantId, stir: '302222222', name: 'Z', searchKey: 'z', status: 'PENDING', regionId: andijan.id } })
      await db.companyIndustry.create({ data: { companyId: Z.id, industryId: it.id } })
      const req = await db.trainingRequest.create({ data: { tenantId, companyId: X.id, directionId: dIt.id, count: 20, byYear: Y } })
      await db.trainingRequest.create({ data: { tenantId, companyId: Z.id, directionId: dIt.id, count: 300, byYear: Y } })
      await db.trainingOffer.create({ data: { tenantId, requestId: req.id, institutionId: A.id, count: 15, byYear: Y, status: 'ACCEPTED' } })
      await db.trainingOffer.create({ data: { tenantId, requestId: req.id, institutionId: C.id, count: 5, byYear: Y, status: 'PENDING' } })
      await db.trainingOffer.create({ data: { tenantId, requestId: req.id, institutionId: D.id, count: 7, byYear: Y, status: 'DECLINED' } })
      // Students in ILMORA: two studying at a technikum, one applying to a university (IT, year Y).
      const profile = async (data: Record<string, unknown>) => {
        const u = await ctx.makeStudent(tenantId)
        await db.studentProfile.create({ data: { tenantId, userId: u.id, ...data } as never })
      }
      await profile({ mode: 'STUDYING', institutionType: 'TECHNIKUM', institutionId: A.id, regionId: tashkent.id })
      await profile({ mode: 'STUDYING', institutionType: 'TECHNIKUM', institutionId: A.id, regionId: tashkent.id })
      await profile({ mode: 'APPLYING', institutionType: 'UNIVERSITY', directionId: dIt.id, enrollYear: Y, regionId: andijan.id })
      return { tenantId, it, furniture, tashkent, andijan, A, C, D }
    })
  }
  const table = (all: StatsTableDto[], key: string) => all.find((t) => t.key === key)!
  const row = (t: StatsTableDto, col: string, ru: string) => t.rows.find((r) => (r[col] as { ru: string }).ru === ru)!

  it('demand and supply by industry: approved institutions only, live offers only', async () => {
    const s = await setup('st-main')
    await TenantContext.forTenant(s.tenantId, async () => {
      const { tables } = await stats.all({})
      const t = table(tables, 'demand_supply')
      expect(row(t, 'industry', 'IT и связь')).toMatchObject({ students: 130, graduates: 40, companies: 1, requested: 20, offered: 20, promised: 15, gap: 5 })
      expect(row(t, 'industry', 'Мебель и деревообработка')).toMatchObject({ students: 50, graduates: 10, companies: 0, requested: 0 })
      expect(t.rows).toHaveLength(17)
    })
  })

  it('coverage and regions: the official list against who registered and was approved', async () => {
    const s = await setup('st-cover')
    await TenantContext.forTenant(s.tenantId, async () => {
      const { tables } = await stats.all({})
      expect(table(tables, 'coverage').rows[0]).toEqual({ inList: 3, registered: 2, coverage: 66.7, approved: 2, approvedNotInList: 1, pending: 1, rejected: 0 })
      const regions = table(tables, 'institutions_by_region')
      expect(row(regions, 'region', 'город Ташкент')).toMatchObject({ inList: 2, registered: 2, coverage: 100, institutions: 1, students: 150 })
      expect(row(regions, 'region', 'Андижанская область')).toMatchObject({ inList: 1, registered: 0, coverage: 0, institutions: 1, students: 30 })
      const types = table(tables, 'institutions_by_type')
      expect(row(types, 'type', 'Техникум')).toMatchObject({ institutions: 1, state: 1, private: 0, students: 150 })
      expect(row(types, 'type', 'Колледж')).toMatchObject({ institutions: 1, state: 0, private: 1, students: 30 })
      expect(table(tables, 'student_added').rows).toEqual([expect.objectContaining({ institutions: 1, region: expect.objectContaining({ ru: 'город Ташкент' }) })])
    })
  })

  it('filters: region (also by slug), type, year', async () => {
    const s = await setup('st-filter')
    await TenantContext.forTenant(s.tenantId, async () => {
      await ctx.prisma.client.region.update({ where: { id: s.andijan.id }, data: { slug: 'andijan' } })
      const andijan = table((await stats.all({ regionId: 'andijan' })).tables, 'demand_supply')
      // Andijan: C's 30 students; X's request is for Tashkent (its company's region) — not here.
      expect(row(andijan, 'industry', 'IT и связь')).toMatchObject({ students: 30, graduates: 0, requested: 0, companies: 0 })
      const colleges = table((await stats.all({ type: 'COLLEGE' })).tables, 'demand_supply')
      expect(row(colleges, 'industry', 'IT и связь')).toMatchObject({ students: 30, offered: 5, promised: 0 })
      const nextYear = table((await stats.all({ year: Y + 1 })).tables, 'demand_supply')
      expect(row(nextYear, 'industry', 'IT и связь')).toMatchObject({ students: 130, graduates: 0, requested: 0 })
      await expect(stats.all({ regionId: 'nowhere' })).rejects.toMatchObject({ code: 'invalid_region' })
    })
  })

  it('students and applicants in ILMORA, without any personal data', async () => {
    const s = await setup('st-students')
    await TenantContext.forTenant(s.tenantId, async () => {
      const { tables } = await stats.all({})
      const st = table(tables, 'ilmora_students')
      expect(row(st, 'type', 'Техникум')).toMatchObject({ studying: 2, applying: 0, total: 2 })
      expect(row(st, 'type', 'Вуз')).toMatchObject({ studying: 0, applying: 1, total: 1 })
      expect(table(tables, 'applicants').rows).toEqual([expect.objectContaining({ year: Y, applicants: 1, industry: expect.objectContaining({ ru: 'IT и связь' }) })])
      const json = JSON.stringify(tables)
      expect(json).not.toMatch(/Student \d+|\+9989/)
    })
  })

  it('registry view: filters by status, region, industry; companies without the certificate', async () => {
    const s = await setup('st-registry')
    await TenantContext.forTenant(s.tenantId, async () => {
      expect((await registry.institutionsPage({})).total).toBe(5)
      expect((await registry.institutionsPage({ status: 'unclaimed' })).items.map((i) => i.name)).toEqual(['B texnikumi'])
      expect((await registry.institutionsPage({ status: 'approved' })).items.map((i) => i.name)).toEqual(['A texnikumi', 'C kolleji'])
      expect((await registry.institutionsPage({ status: 'student' })).items.map((i) => i.official)).toEqual([false])
      expect((await registry.institutionsPage({ industryId: s.furniture.id })).items.map((i) => i.name)).toEqual(['A texnikumi'])
      expect((await registry.institutionsPage({ q: '044444444' })).items.map((i) => i.name)).toEqual(['D texnikumi'])
      const a = (await registry.institutionsPage({ q: 'A texnikumi' })).items[0]
      expect(a).toMatchObject({ students: 150, directions: 2, official: true })
      expect((await registry.institution(s.A.id)).totals).toEqual({ students: 150, directions: 2 })
      const companies = await registry.companiesPage({ status: 'approved' })
      expect(companies.items).toEqual([expect.objectContaining({ name: 'X', stir: '301111111' })])
      expect(Object.keys(companies.items[0]).sort()).toEqual(['id', 'industries', 'name', 'region', 'status', 'stir'])
    })
  })

  it('exports a table in the chosen language and audits the download', async () => {
    const s = await setup('st-export')
    await TenantContext.forTenant(s.tenantId, async () => {
      const controller = new MinistryController(stats, registry, ctx.audit)
      const headers: Record<string, string> = {}
      let body: Buffer = Buffer.alloc(0)
      const res = { setHeader: (k: string, v: string) => { headers[k] = v }, send: (b: Buffer) => { body = b } }
      await controller.export({ table: 'demand_supply', lang: 'uz' }, res as never)
      expect(headers['Content-Type']).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      expect(headers['Content-Disposition']).toMatch(/^attachment; filename="ilmora-demand_supply-\d{4}-\d{2}-\d{2}\.xlsx"$/)
      const sheet = unzip(body).get('xl/worksheets/sheet1.xml')!
      expect(sheet).toContain('Soha')
      expect(sheet).toContain('IT va aloqa')
      expect(sheet).not.toContain('IT и связь')
      expect(await ctx.prisma.client.auditEvent.count({ where: { action: 'ministry.export', entityId: 'demand_supply' } })).toBe(1)
    })
  })
})
