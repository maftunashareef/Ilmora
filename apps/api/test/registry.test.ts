import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { registrySearchKey } from '@ilmora/shared'
import { seedRegistryReference } from '../prisma/registry-reference'
import { ApprovedGuard, APPROVED_KEY, type OrgKind, ownCompanyId, ownInstitutionId } from '../src/common/registry-access'
import { ZodValidationPipe } from '../src/common/zod.pipe'
import type { PrismaService } from '../src/infra/prisma/prisma.service'
import { TenantContext, type RequestActor } from '../src/infra/tenancy/tenant-context'
import { DirectionInput, StudentInstitutionInput } from '../src/modules/registry/registry.schemas'
import { RegistryService } from '../src/modules/registry/registry.service'
import { DB_AVAILABLE, TestContext } from './helpers'

describe.skipIf(!DB_AVAILABLE)('Registry reference data (ТЗ 3, 9.2)', () => {
  const ctx = new TestContext()
  const service = new RegistryService(ctx.prisma, ctx.audit)
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  /** A tenant with the seeded industries and regions, one district, two directions and two institutions. */
  const setup = async (label: string) => {
    const t = await ctx.makeTenant(label)
    const inT = <T>(fn: () => Promise<T>) => TenantContext.forTenant(t.tenantId, fn)
    const db = ctx.prisma.client
    await TenantContext.system(() => seedRegistryReference(db as never, t.tenantId))
    const student = await ctx.makeStudent(t.tenantId)
    const actor: RequestActor = { id: student.id, roles: ['STUDENT'] }
    return inT(async () => {
      const it = await db.industry.findFirstOrThrow({ where: { slug: 'it' } })
      const business = await db.industry.findFirstOrThrow({ where: { slug: 'business' } })
      const tashkent = await db.region.findFirstOrThrow({ where: { code: '1726' } })
      const andijan = await db.region.findFirstOrThrow({ where: { code: '1703' } })
      const chilonzor = await db.district.create({ data: { tenantId: t.tenantId, regionId: tashkent.id, code: '1726269', name: { uz: 'Çilonzor tumani', ru: 'Чиланзарский район', en: 'Chilanzar' } } })
      const dir = (name: string, industryId: string, origin: 'USER' | 'OFFICIAL' = 'USER') => db.direction.create({ data: { tenantId: t.tenantId, name, searchKey: registrySearchKey(name), industryId, origin } })
      const dasturlash = await dir('Dasturlaş', it.id, 'OFFICIAL')
      const inst = (name: string, extra: Record<string, unknown> = {}) =>
        db.institution.create({ data: { tenantId: t.tenantId, type: 'TECHNIKUM', name, searchKey: registrySearchKey(name), regionId: tashkent.id, districtId: chilonzor.id, source: 'IMPORT', stir: '0' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0'), directorName: 'Director', phone: '+998901234567', ...extra } })
      const ait = await inst('Toşkent axborot texnologiyalari texnikumi')
      return { ...t, inT, actor, it, business, tashkent, andijan, chilonzor, dasturlash, ait, dir, inst }
    })
  }

  it('lists the seeded industries and regions, and districts of one region', async () => {
    const { inT, tashkent, andijan } = await setup('reg-ref')
    await inT(async () => {
      const industries = await service.industries()
      expect(industries).toHaveLength(17)
      expect(industries[0]).toMatchObject({ slug: 'it', name: { uz: 'IT va aloqa' } })
      expect(await service.regions()).toHaveLength(14)
      expect((await service.districts(tashkent.id)).map((d) => d.code)).toEqual(['1726269'])
      expect(await service.districts(andijan.id)).toEqual([])
    })
  })

  it('suggests after 2 characters, across Cyrillic and Latin, filtered by industry', async () => {
    const { inT, it: itInd, business } = await setup('reg-sug')
    await inT(async () => {
      expect(await service.suggestDirections({ q: 'd' })).toEqual([])
      const hits = await service.suggestDirections({ q: 'Дастур' })
      expect(hits).toEqual([expect.objectContaining({ name: 'Dasturlaş', official: true, industry: expect.objectContaining({ id: itInd.id }) })])
      expect(await service.suggestDirections({ q: 'dastur', industryId: business.id })).toEqual([])
    })
  })

  it('adds a direction once: another spelling, or a lost race, answers the existing one', async () => {
    const { tenantId, inT, actor, it: itInd, business } = await setup('reg-add')
    await inT(async () => {
      const first = await service.addDirection(tenantId, actor, { name: 'Veb dizayn', industryId: business.id })
      expect(first).toMatchObject({ created: true, direction: { name: 'Veb dizayn', official: false } })
      expect((await service.suggestDirections({ q: 'веб' })).map((d) => d.id)).toEqual([first.direction.id])

      const again = await service.addDirection(tenantId, actor, { name: 'ВЕБ ДИЗАЙН', industryId: itInd.id })
      expect(again).toEqual({ direction: first.direction, created: false })
      expect((await service.addDirection(tenantId, actor, { name: 'dasturlash', industryId: itInd.id })).created).toBe(false)

      // Ten «Добавить» of one new name at once: one row, every answer is that row.
      const results = await Promise.all(Array.from({ length: 10 }, () => service.addDirection(tenantId, actor, { name: 'Robototexnika', industryId: itInd.id })))
      expect(new Set(results.map((r) => r.direction.id)).size).toBe(1)
      expect(results.filter((r) => r.created)).toHaveLength(1)
      expect(await ctx.prisma.client.direction.count({ where: { searchKey: 'robototexnika' } })).toBe(1)

      const audits = await ctx.prisma.client.auditEvent.count({ where: { action: 'registry.direction.create' } })
      expect(audits).toBe(2)
    })
  })

  it('answers the main direction for a merged alias, in suggestions and on «Добавить»', async () => {
    const { tenantId, inT, actor, it: itInd, dasturlash, dir } = await setup('reg-merge')
    await inT(async () => {
      const alias = await dir('Programmalaş', itInd.id)
      await ctx.prisma.client.direction.update({ where: { id: alias.id }, data: { mergedIntoId: dasturlash.id } })
      expect((await service.suggestDirections({ q: 'programma' })).map((d) => d.id)).toEqual([dasturlash.id])
      expect(await service.addDirection(tenantId, actor, { name: 'Programmalash', industryId: itInd.id })).toMatchObject({ created: false, direction: { id: dasturlash.id } })
    })
  })

  it('rejects an unknown or inactive industry', async () => {
    const { tenantId, inT, actor, business } = await setup('reg-ind')
    await inT(async () => {
      await expect(service.addDirection(tenantId, actor, { name: 'Robototexnika', industryId: 'nope' })).rejects.toMatchObject({ code: 'invalid_industry' })
      await ctx.prisma.client.industry.update({ where: { id: business.id }, data: { isActive: false } })
      await expect(service.addDirection(tenantId, actor, { name: 'Robototexnika', industryId: business.id })).rejects.toMatchObject({ code: 'invalid_industry' })
    })
  })

  it('institution search answers public fields only, hides merged records and puts student-added ones last', async () => {
    const { inT, tashkent, ait, inst } = await setup('reg-inst')
    await inT(async () => {
      const merged = await inst('Toşkent axborot texnikumi eski', { stir: null, source: 'STUDENT' })
      await ctx.prisma.client.institution.update({ where: { id: merged.id }, data: { mergedIntoId: ait.id } })
      const studentAdded = await inst('Toşkent axborot kolleji', { stir: null, source: 'STUDENT' })
      const hits = await service.searchInstitutions({ q: 'тошкент ахборот', type: 'TECHNIKUM', regionId: tashkent.id })
      expect(hits.map((h) => h.id)).toEqual([ait.id, studentAdded.id])
      expect(Object.keys(hits[0]).sort()).toEqual(['addedByStudent', 'district', 'id', 'name', 'ownership', 'region', 'type'])
      expect(hits[1].addedByStudent).toBe(true)
      expect(await service.searchInstitutions({ q: 't' })).toEqual([])
      expect(await service.searchInstitutions({ q: 'тошкент', type: 'UNIVERSITY' })).toEqual([])
    })
  })

  it('a student-added institution is visible to other students at once, without a STIR, and not added twice', async () => {
    const { tenantId, inT, actor, tashkent, andijan } = await setup('reg-stud')
    await inT(async () => {
      const a = await service.addStudentInstitution(tenantId, actor, { name: 'Nurafşon texnikumi', type: 'TECHNIKUM', regionId: andijan.id })
      expect(a).toMatchObject({ created: true, institution: { addedByStudent: true, region: { id: andijan.id } } })
      const row = await ctx.prisma.client.institution.findUniqueOrThrow({ where: { id: a.institution.id } })
      expect(row).toMatchObject({ source: 'STUDENT', status: 'UNCLAIMED', stir: null, createdById: actor.id })
      expect((await service.searchInstitutions({ q: 'нурафшон' })).map((i) => i.id)).toEqual([a.institution.id])
      expect((await service.addStudentInstitution(tenantId, actor, { name: 'NURAFSHON  texnikumi', type: 'TECHNIKUM', regionId: andijan.id })).created).toBe(false)
      // The same name in another region is another institution.
      expect((await service.addStudentInstitution(tenantId, actor, { name: 'Nurafşon texnikumi', type: 'TECHNIKUM', regionId: tashkent.id })).created).toBe(true)
    })
  })

  it('checks the region and that the district belongs to it', async () => {
    const { tenantId, inT, actor, andijan, chilonzor } = await setup('reg-geo')
    await inT(async () => {
      await expect(service.addStudentInstitution(tenantId, actor, { name: 'X texnikumi', type: 'TECHNIKUM', regionId: 'nope' })).rejects.toMatchObject({ code: 'invalid_region' })
      await expect(service.addStudentInstitution(tenantId, actor, { name: 'X texnikumi', type: 'TECHNIKUM', regionId: andijan.id, districtId: chilonzor.id })).rejects.toMatchObject({ code: 'invalid_district' })
    })
  })

  it('never reads another tenant’s registry', async () => {
    const a = await setup('reg-iso-a')
    const b = await setup('reg-iso-b')
    await b.inT(async () => {
      expect((await service.suggestDirections({ q: 'dastur' })).map((d) => d.id)).not.toContain(a.dasturlash.id)
      expect((await service.searchInstitutions({ q: 'axborot' })).map((i) => i.id)).toEqual([b.ait.id])
      await expect(service.addDirection(b.tenantId, b.actor, { name: 'Robototexnika', industryId: a.it.id })).rejects.toMatchObject({ code: 'invalid_industry' })
    })
  })
})

describe('Registry input validation', () => {
  it('trims names, refuses markup and unknown fields', () => {
    const pipe = new ZodValidationPipe(DirectionInput)
    expect(pipe.transform({ name: '  Web   dasturlash ', industryId: 'ind' })).toEqual({ name: 'Web dasturlash', industryId: 'ind' })
    expect(() => pipe.transform({ name: '<img src=x onerror=alert(1)>', industryId: 'ind' })).toThrow()
    expect(() => pipe.transform({ name: 'IT', industryId: 'ind', origin: 'OFFICIAL' })).toThrow()
  })

  it('lets a student add only a technikum, lyceum, school or university', () => {
    const pipe = new ZodValidationPipe(StudentInstitutionInput)
    expect(pipe.transform({ name: 'Mening texnikumim', type: 'TECHNIKUM', regionId: 'r' })).toMatchObject({ type: 'TECHNIKUM' })
    expect(() => pipe.transform({ name: 'Mening markazim', type: 'TRAINING_CENTER', regionId: 'r' })).toThrow()
    expect(() => pipe.transform({ name: 'Mening texnikumim', type: 'TECHNIKUM', regionId: 'r', stir: '123456789' })).toThrow()
  })
})

describe('Registry access: @Approved and own scope', () => {
  const ctxFor = (kind: OrgKind | undefined, actor: RequestActor | undefined) => {
    const handler = () => undefined
    if (kind) Reflect.defineMetadata(APPROVED_KEY, kind, handler)
    return { getHandler: () => handler, getClass: () => class {}, switchToHttp: () => ({ getRequest: () => ({ actor }) }) } as unknown as ExecutionContext
  }
  /** Approved organizations by id; records the filter the guard asked for. */
  const prismaWith = (approved: string[]) => {
    const seen: unknown[] = []
    const findFirst = async ({ where }: { where: { id: string; approvedAt?: unknown } }) => (seen.push(where), approved.includes(where.id) ? { id: where.id } : null)
    return { prisma: { client: { institution: { findFirst }, company: { findFirst } } } as unknown as PrismaService, seen }
  }
  const inst: RequestActor = { id: 'u-i', roles: ['INSTITUTION_ADMIN'], institutionId: 'inst-1' }

  it('lets routes without @Approved through', async () => {
    await expect(new ApprovedGuard(new Reflector(), prismaWith([]).prisma).canActivate(ctxFor(undefined, inst))).resolves.toBe(true)
  })

  it('needs an approved organization of the right kind, read by approvedAt', async () => {
    const { prisma, seen } = prismaWith(['inst-1'])
    await expect(new ApprovedGuard(new Reflector(), prisma).canActivate(ctxFor('institution', inst))).resolves.toBe(true)
    expect(seen[0]).toEqual({ id: 'inst-1', approvedAt: { not: null }, mergedIntoId: null })
    await expect(new ApprovedGuard(new Reflector(), prismaWith([]).prisma).canActivate(ctxFor('institution', inst))).rejects.toMatchObject({ code: 'not_approved' })
    // An institution account is not a company, even when its institution is approved.
    await expect(new ApprovedGuard(new Reflector(), prisma).canActivate(ctxFor('company', inst))).rejects.toMatchObject({ code: 'not_approved' })
    await expect(new ApprovedGuard(new Reflector(), prisma).canActivate(ctxFor('institution', undefined))).rejects.toMatchObject({ code: 'not_approved' })
  })

  it('own scope comes from the session and reads as not found when missing', () => {
    expect(ownInstitutionId(inst)).toBe('inst-1')
    const student: RequestActor = { id: 'u', roles: ['STUDENT'] }
    expect(() => ownInstitutionId(student)).toThrow(expect.objectContaining({ code: 'not_found' }))
    expect(() => ownCompanyId(student)).toThrow(expect.objectContaining({ code: 'not_found' }))
  })
})
