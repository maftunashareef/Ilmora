import { describe, expect, it } from 'vitest'
import type { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { ApprovedGuard, APPROVED_KEY, type OrgKind, type OrgStatus, ownCompanyId, ownInstitutionId, StubOrgStatusReader } from '../src/common/registry-access'
import { ZodValidationPipe } from '../src/common/zod.pipe'
import type { RequestActor } from '../src/infra/tenancy/tenant-context'
import type { AuditService } from '../src/modules/audit/audit.service'
import { MemoryRegistryStore } from '../src/modules/registry/registry.memory-store'
import { DirectionInput, StudentInstitutionInput } from '../src/modules/registry/registry.schemas'
import { RegistryService } from '../src/modules/registry/registry.service'
import { DuplicateKeyError } from '../src/modules/registry/registry.store'

const student: RequestActor = { id: 'u-student', roles: ['STUDENT'] }

function make() {
  const audits: { action: string; entityId: string }[] = []
  const audit = { record: async (a: { action: string; entityId: string }) => void audits.push(a) } as unknown as AuditService
  const store = new MemoryRegistryStore()
  return { service: new RegistryService(store, audit), store, audits }
}

describe('Registry: directions (ТЗ 3.2)', () => {
  it('suggests only after 2 characters and finds a Cyrillic query among Latin names', async () => {
    const { service } = make()
    expect(await service.suggestDirections({ q: 'd' })).toEqual([])
    const hits = await service.suggestDirections({ q: 'Дастур' })
    expect(hits.map((d) => d.name)).toContain('Dasturlaş')
    expect(hits[0].industry.id).toBe('ind-it')
  })

  it('filters suggestions by industry', async () => {
    const { service } = make()
    expect(await service.suggestDirections({ q: 'dastur', industryId: 'ind-business' })).toEqual([])
  })

  it('adds a new direction to the shared dictionary once, and returns the existing one for another spelling', async () => {
    const { service, audits } = make()
    const first = await service.addDirection(student, { name: 'Veb dizayn', industryId: 'ind-design' })
    expect(first.created).toBe(true)
    expect((await service.suggestDirections({ q: 'веб' })).map((d) => d.id)).toContain(first.direction.id)

    const again = await service.addDirection(student, { name: ' ВЕБ  ДИЗАЙН ', industryId: 'ind-it' })
    expect(again).toEqual({ direction: first.direction, created: false })
    expect(again.direction.industry.id).toBe('ind-design')
    expect(audits.map((a) => a.action)).toEqual(['registry.direction.create'])
  })

  it('"Dasturlash" finds the existing "Dasturlaş" instead of creating a duplicate', async () => {
    const { service } = make()
    const r = await service.addDirection(student, { name: 'dasturlash', industryId: 'ind-it' })
    expect(r.created).toBe(false)
    expect(r.direction.name).toBe('Dasturlaş')
  })

  it('turns a lost race on the unique key into the existing direction', async () => {
    const { service, store } = make()
    const real = store.createDirection.bind(store)
    store.directionByKey = (() => {
      let calls = 0
      const original = MemoryRegistryStore.prototype.directionByKey.bind(store)
      return async (key: string) => (calls++ === 0 ? null : original(key))
    })()
    store.createDirection = async (input) => {
      await real({ ...input, createdBy: 'someone-else' })
      throw new DuplicateKeyError('direction')
    }
    const r = await service.addDirection(student, { name: 'Robototexnika', industryId: 'ind-it' })
    expect(r.created).toBe(false)
    expect(r.direction.name).toBe('Robototexnika')
  })

  it('rejects an unknown industry and markup in the name', async () => {
    const { service } = make()
    await expect(service.addDirection(student, { name: 'Robototexnika', industryId: 'nope' })).rejects.toMatchObject({ code: 'invalid_industry' })
    const pipe = new ZodValidationPipe(DirectionInput)
    expect(() => pipe.transform({ name: '<img src=x onerror=alert(1)>', industryId: 'ind-it' })).toThrow()
    expect(() => pipe.transform({ name: 'IT', industryId: 'ind-it', official: true })).toThrow()
    expect(pipe.transform({ name: '  Web   dasturlash ', industryId: 'ind-it' })).toEqual({ name: 'Web dasturlash', industryId: 'ind-it' })
  })
})

describe('Registry: institutions (ТЗ 3.5, 9.4)', () => {
  it('search answers name, type and region only — no STIR, director or phone', async () => {
    const { service } = make()
    const [hit] = await service.searchInstitutions({ q: 'тошкент ахборот' })
    expect(hit).toBeDefined()
    expect(Object.keys(hit).sort()).toEqual(['addedByStudent', 'district', 'id', 'name', 'ownership', 'region', 'type'])
  })

  it('filters by type and region and needs 2 characters', async () => {
    const { service } = make()
    expect(await service.searchInstitutions({ q: 't' })).toEqual([])
    const technikums = await service.searchInstitutions({ q: 'texnikumi', type: 'TECHNIKUM', regionId: 'reg-1' })
    expect(technikums.length).toBeGreaterThan(0)
    expect(technikums.every((i) => i.type === 'TECHNIKUM' && i.region.id === 'reg-1')).toBe(true)
  })

  it('a student-added institution is visible to other students at once, marked, and not duplicated', async () => {
    const { service } = make()
    const a = await service.addStudentInstitution(student, { name: 'Nurafşon texnikumi', type: 'TECHNIKUM', regionId: 'reg-2' })
    expect(a.created).toBe(true)
    expect(a.institution.addedByStudent).toBe(true)
    const found = await service.searchInstitutions({ q: 'нурафшон' })
    expect(found.map((i) => i.id)).toEqual([a.institution.id])
    expect((await service.addStudentInstitution(student, { name: 'NURAFSHON  texnikumi', type: 'TECHNIKUM', regionId: 'reg-2' })).created).toBe(false)
    // The same name in another region is another institution.
    expect((await service.addStudentInstitution(student, { name: 'Nurafşon texnikumi', type: 'TECHNIKUM', regionId: 'reg-3' })).created).toBe(true)
  })

  it('checks the region, the district and the type a student may add', async () => {
    const { service } = make()
    await expect(service.addStudentInstitution(student, { name: 'X texnikumi', type: 'TECHNIKUM', regionId: 'nope' })).rejects.toMatchObject({ code: 'invalid_region' })
    await expect(service.addStudentInstitution(student, { name: 'X texnikumi', type: 'TECHNIKUM', regionId: 'reg-2', districtId: 'dist-1-1' })).rejects.toMatchObject({ code: 'invalid_district' })
    const pipe = new ZodValidationPipe(StudentInstitutionInput)
    expect(() => pipe.transform({ name: 'Mening markazim', type: 'CENTER', regionId: 'reg-1' })).toThrow()
    expect(() => pipe.transform({ name: 'Mening texnikumim', type: 'TECHNIKUM', regionId: 'reg-1', stir: '123456789' })).toThrow()
  })
})

describe('Registry access: @Approved and own scope', () => {
  const ctxFor = (kind: OrgKind | undefined, actor: RequestActor | undefined) => {
    const handler = () => undefined
    if (kind) Reflect.defineMetadata(APPROVED_KEY, kind, handler)
    return { getHandler: () => handler, getClass: () => class {}, switchToHttp: () => ({ getRequest: () => ({ actor }) }) } as unknown as ExecutionContext
  }
  const reader = (status: OrgStatus | null) => ({ status: async () => status })

  it('lets routes without @Approved through', async () => {
    await expect(new ApprovedGuard(new Reflector(), reader(null)).canActivate(ctxFor(undefined, student))).resolves.toBe(true)
  })

  it('needs an APPROVED organization of the right kind', async () => {
    const inst: RequestActor = { id: 'u-i', roles: [], institutionId: 'inst-1' }
    await expect(new ApprovedGuard(new Reflector(), reader('APPROVED')).canActivate(ctxFor('institution', inst))).resolves.toBe(true)
    for (const s of ['DRAFT', 'PENDING', 'REJECTED', 'BLOCKED', null] as const) {
      await expect(new ApprovedGuard(new Reflector(), reader(s)).canActivate(ctxFor('institution', inst))).rejects.toMatchObject({ code: 'not_approved' })
    }
    // An institution account is not a company, even when its institution is approved.
    await expect(new ApprovedGuard(new Reflector(), reader('APPROVED')).canActivate(ctxFor('company', inst))).rejects.toMatchObject({ code: 'not_approved' })
  })

  it('the stub reader approves nothing until the registry tables exist', async () => {
    const co: RequestActor = { id: 'u-c', roles: [], companyId: 'co-1' }
    await expect(new ApprovedGuard(new Reflector(), new StubOrgStatusReader()).canActivate(ctxFor('company', co))).rejects.toMatchObject({ code: 'not_approved' })
  })

  it('own scope comes from the session and reads as not found when missing', () => {
    expect(ownInstitutionId({ id: 'u', roles: [], institutionId: 'inst-1' })).toBe('inst-1')
    expect(() => ownInstitutionId(student)).toThrow(expect.objectContaining({ code: 'not_found' }))
    expect(() => ownCompanyId(student)).toThrow(expect.objectContaining({ code: 'not_found' }))
  })
})
