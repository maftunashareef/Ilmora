import { registrySearchKey } from '@ilmora/shared'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { DB_AVAILABLE, TestContext } from './helpers'

/** The registry's guarantees that live in the database itself (TZ «реестр учреждений, компании, студенты», 9.1). */
describe.skipIf(!DB_AVAILABLE)('registry model: uniqueness and tenant isolation', () => {
  const ctx = new TestContext()
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  const setup = async (label: string) => {
    const t = await ctx.makeTenant(label)
    const inT = <T>(fn: () => Promise<T>) => TenantContext.forTenant(t.tenantId, fn)
    const industry = await inT(() => ctx.prisma.client.industry.create({ data: { slug: 'it', name: { uz: 'IT', ru: 'IT', en: 'IT' } } as never }))
    return { ...t, inT, industry }
  }

  it('keeps one direction per normalized name, whatever the spelling', async () => {
    const { inT, industry } = await setup('reg-dir')
    const add = (name: string) => inT(() => ctx.prisma.client.direction.create({ data: { name, searchKey: registrySearchKey(name), industryId: industry.id } as never }))
    await add('Dasturlash')
    await expect(add('Дастурлаш')).rejects.toMatchObject({ code: 'P2002' })
    await expect(add('Öqituvçi')).resolves.toBeTruthy()
    await expect(add('O‘qituvchi')).rejects.toMatchObject({ code: 'P2002' })
  })

  it('keeps one institution and one company per STIR, and lets STIR-less records repeat', async () => {
    const { inT } = await setup('reg-stir')
    const inst = (stir: string | null) => inT(() => ctx.prisma.client.institution.create({ data: { type: 'TECHNIKUM', name: 'T', searchKey: 't', stir, source: stir ? 'IMPORT' : 'STUDENT' } as never }))
    await inst('012345678')
    await expect(inst('012345678')).rejects.toMatchObject({ code: 'P2002' })
    await inst(null)
    await expect(inst(null)).resolves.toBeTruthy()
    const company = () => inT(() => ctx.prisma.client.company.create({ data: { stir: '098765432', name: 'C', searchKey: 'c' } as never }))
    await company()
    await expect(company()).rejects.toMatchObject({ code: 'P2002' })
  })

  it('allows one representative per institution', async () => {
    const { tenantId, inT } = await setup('reg-rep')
    const institution = await inT(() => ctx.prisma.client.institution.create({ data: { type: 'TECHNIKUM', name: 'T', searchKey: 't', stir: '011111111', source: 'SELF' } as never }))
    const first = await ctx.makeStudent(tenantId, 11_111)
    const second = await ctx.makeStudent(tenantId, 22_222)
    await inT(() => ctx.prisma.client.user.update({ where: { id: first.id }, data: { institutionId: institution.id, roles: ['INSTITUTION_ADMIN'] } }))
    await expect(inT(() => ctx.prisma.client.user.update({ where: { id: second.id }, data: { institutionId: institution.id } }))).rejects.toMatchObject({ code: 'P2002' })
  })

  it('keeps the questionnaire phone apart from the sign-in number, so it takes no one\'s number', async () => {
    const { tenantId, inT } = await setup('reg-phone')
    const a = await ctx.makeStudent(tenantId, 44_444)
    const b = await ctx.makeStudent(tenantId, 55_555)
    const phone = '+998901234567'
    for (const s of [a, b]) await inT(() => ctx.prisma.client.studentProfile.create({ data: { userId: s.id, mode: 'STUDYING', contactPhone: phone } as never }))
    // The number stays free for its real owner to sign up with.
    await expect(inT(() => ctx.prisma.client.user.create({ data: { phoneE164: phone, displayName: 'Owner', roles: ['STUDENT'] } as never }))).resolves.toBeTruthy()
  })

  it('allows one open contract-help request per student', async () => {
    const { tenantId, inT } = await setup('reg-help')
    const student = await ctx.makeStudent(tenantId, 33_333)
    const open = () => inT(() => ctx.prisma.client.contractHelpRequest.create({ data: { userId: student.id, motivation: 'm', yearsToWork: 2, openKey: student.id } as never }))
    const first = await open()
    await expect(open()).rejects.toMatchObject({ code: 'P2002' })
    await inT(() => ctx.prisma.client.contractHelpRequest.update({ where: { id: first.id }, data: { status: 'WITHDRAWN', openKey: null, withdrawnAt: new Date() } }))
    await expect(open()).resolves.toBeTruthy()
  })

  it('scopes registry rows to the tenant and refuses queries without one', async () => {
    const a = await setup('reg-iso-a')
    const b = await setup('reg-iso-b')
    const instB = await b.inT(() => ctx.prisma.client.institution.create({ data: { type: 'TECHNIKUM', name: 'B', searchKey: 'b', stir: '022222222', source: 'IMPORT' } as never }))
    expect(await a.inT(() => ctx.prisma.client.institution.findFirst({ where: { id: instB.id } }))).toBeNull()
    expect(await a.inT(() => ctx.prisma.client.direction.findMany({}))).toHaveLength(0)
    await expect(ctx.prisma.client.institution.findMany({})).rejects.toThrow(/tenant context/i)
  })
})
