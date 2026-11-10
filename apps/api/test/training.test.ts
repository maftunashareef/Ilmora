import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { registrySearchKey } from '@ilmora/shared'
import { seedRegistryReference } from '../prisma/registry-reference'
import { ROLES_KEY } from '../src/common/decorators'
import { APPROVED_KEY } from '../src/common/registry-access'
import { ZodValidationPipe } from '../src/common/zod.pipe'
import { TenantContext, type RequestActor } from '../src/infra/tenancy/tenant-context'
import type { NotifyInput, NotificationsService } from '../src/modules/notifications/notifications.service'
import { CompanyTrainingController, InstitutionTrainingController } from '../src/modules/training/training.controller'
import { TrainingOfferInput, TrainingRequestInput } from '../src/modules/training/training.schemas'
import { TrainingService } from '../src/modules/training/training.service'
import { DB_AVAILABLE, TestContext } from './helpers'

const YEAR = new Date().getUTCFullYear()

describe('Training requests: access and input', () => {
  it('company and institution routes need the role and an approved organization', () => {
    expect(Reflect.getMetadata(ROLES_KEY, CompanyTrainingController)).toEqual(['COMPANY_ADMIN'])
    expect(Reflect.getMetadata(APPROVED_KEY, CompanyTrainingController)).toBe('company')
    expect(Reflect.getMetadata(ROLES_KEY, InstitutionTrainingController)).toEqual(['INSTITUTION_ADMIN'])
    expect(Reflect.getMetadata(APPROVED_KEY, InstitutionTrainingController)).toBe('institution')
  })

  it('takes counts > 0 and years from now to 10 ahead, no markup, no foreign fields', () => {
    const req = new ZodValidationPipe(TrainingRequestInput)
    expect(req.transform({ directionId: 'd', count: 20, byYear: YEAR + 2 })).toMatchObject({ count: 20 })
    for (const bad of [{ count: 0 }, { count: 1.5 }, { byYear: YEAR - 1 }, { byYear: YEAR + 11 }, { requirements: '<b>x</b>' }, { companyId: 'other' }]) {
      expect(() => req.transform({ directionId: 'd', count: 20, byYear: YEAR + 2, ...bad })).toThrow()
    }
    expect(() => new ZodValidationPipe(TrainingOfferInput).transform({ count: 10, byYear: YEAR, status: 'ACCEPTED' })).toThrow()
  })
})

describe.skipIf(!DB_AVAILABLE)('Training requests «под обучение» and offers (ТЗ 5.2)', () => {
  const ctx = new TestContext()
  const sent: NotifyInput[] = []
  const notifications = {
    notify: async (n: NotifyInput) => (sent.push(n), n.userIds.length),
    safely: async (_l: string, fn: () => Promise<unknown>) => { await fn() },
  } as unknown as NotificationsService
  const service = new TrainingService(ctx.prisma, ctx.audit, notifications)
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  /**
   * Two IT institutions (Tashkent, Andijan), a furniture one (Tashkent), an IT one not approved yet, two approved
   * companies — each with its representative.
   */
  const setup = async (label: string) => {
    const t = await ctx.makeTenant(label)
    const db = ctx.prisma.client
    const inT = <T>(fn: () => Promise<T>) => TenantContext.forTenant(t.tenantId, fn)
    await TenantContext.system(() => seedRegistryReference(db as never, t.tenantId))
    return inT(async () => {
      const tenantId = t.tenantId
      const ind = async (slug: string) => db.industry.findFirstOrThrow({ where: { slug } })
      const it = await ind('it')
      const furniture = await ind('furniture')
      const tashkent = await db.region.findFirstOrThrow({ where: { code: '1726' } })
      const andijan = await db.region.findFirstOrThrow({ where: { code: '1703' } })
      const dir = (name: string, industryId: string) => db.direction.create({ data: { tenantId, name, searchKey: registrySearchKey(name), industryId } })
      const dasturlash = await dir('Dasturlaş', it.id)
      const mebel = await dir('Mebel işlab çiqariş', furniture.id)
      let n = 0
      const user = (roles: ('INSTITUTION_ADMIN' | 'COMPANY_ADMIN')[], link: object) =>
        db.user.create({ data: { tenantId, login: `u-${label}-${++n}`, displayName: `Rep ${n}`, jobTitle: 'Direktor', email: `rep${n}@test.uz`, roles, ...link } })
      const institution = async (name: string, regionId: string, directionId: string, approved = true) => {
        const row = await db.institution.create({
          data: { tenantId, type: 'TECHNIKUM', name, searchKey: registrySearchKey(name), regionId, source: 'SELF', status: approved ? 'APPROVED' : 'PENDING', approvedAt: approved ? new Date() : null, phone: '+998901112233', email: `${n}@tex.uz`, address: 'Manzil' },
        })
        await db.institutionDirection.create({ data: { tenantId, institutionId: row.id, directionId, studentsCount: 100 } })
        const u = await user(['INSTITUTION_ADMIN'], { institutionId: row.id })
        return { row, actor: { id: u.id, roles: ['INSTITUTION_ADMIN'] } as RequestActor }
      }
      const company = async (name: string, stir: string) => {
        const row = await db.company.create({ data: { tenantId, stir, name, searchKey: registrySearchKey(name), status: 'APPROVED', approvedAt: new Date(), website: 'https://co.uz', address: 'Ofis', regionId: tashkent.id } })
        await db.companyIndustry.create({ data: { companyId: row.id, industryId: it.id } })
        const u = await user(['COMPANY_ADMIN'], { companyId: row.id })
        return { row, actor: { id: u.id, roles: ['COMPANY_ADMIN'] } as RequestActor }
      }
      return {
        tenantId, inT, it, furniture, tashkent, andijan, dasturlash, mebel,
        itTashkent: await institution('IT texnikumi Toşkent', tashkent.id, dasturlash.id),
        itAndijan: await institution('IT texnikumi Andijon', andijan.id, dasturlash.id),
        furnitureTashkent: await institution('Mebel texnikumi', tashkent.id, mebel.id),
        itPending: await institution('Yangi IT texnikumi', tashkent.id, dasturlash.id, false),
        softCo: await company('Soft Co', '401111111'),
        otherCo: await company('Other Co', '402222222'),
      }
    })
  }

  it('notifies only approved institutions of the request’s industry, in its region when one is set', async () => {
    const s = await setup('tr-notify')
    await s.inT(async () => {
      sent.length = 0
      const inTashkent = await service.create(s.tenantId, s.softCo.actor, { directionId: s.dasturlash.id, count: 20, byYear: YEAR + 2, regionId: s.tashkent.id, requirements: 'Python, SQL' })
      expect(inTashkent).toMatchObject({ count: 20, byYear: YEAR + 2, status: 'OPEN', region: { id: s.tashkent.id }, direction: { id: s.dasturlash.id }, offers: [], summary: { pending: 0, accepted: 0, promised: 0 } })
      expect(sent).toEqual([expect.objectContaining({ type: 'training.request', userIds: [s.itTashkent.actor.id], params: expect.objectContaining({ companyName: 'Soft Co', count: 20 }) })])
      sent.length = 0
      await service.create(s.tenantId, s.softCo.actor, { directionId: s.dasturlash.id, count: 5, byYear: YEAR + 1 })
      expect(sent[0].userIds.sort()).toEqual([s.itTashkent.actor.id, s.itAndijan.actor.id].sort())
    })
  })

  it('an institution sees only requests of its industries and region — by id too', async () => {
    const s = await setup('tr-see')
    await s.inT(async () => {
      const tashkentOnly = await service.create(s.tenantId, s.softCo.actor, { directionId: s.dasturlash.id, count: 20, byYear: YEAR + 2, regionId: s.tashkent.id })
      const anyRegion = await service.create(s.tenantId, s.softCo.actor, { directionId: s.dasturlash.id, count: 5, byYear: YEAR + 1 })
      expect((await service.incoming(s.itTashkent.actor, {})).map((r) => r.id).sort()).toEqual([tashkentOnly.id, anyRegion.id].sort())
      expect((await service.incoming(s.itAndijan.actor, {})).map((r) => r.id)).toEqual([anyRegion.id])
      expect(await service.incoming(s.furnitureTashkent.actor, {})).toEqual([])
      await expect(service.incomingOne(s.furnitureTashkent.actor, tashkentOnly.id)).rejects.toMatchObject({ code: 'not_found' })
      await expect(service.incomingOne(s.itAndijan.actor, tashkentOnly.id)).rejects.toMatchObject({ code: 'not_found' })
      await expect(service.offer(s.tenantId, s.furnitureTashkent.actor, tashkentOnly.id, { count: 1, byYear: YEAR })).rejects.toMatchObject({ code: 'not_found' })
      // No contacts of the company before an accepted offer.
      const seen = await service.incomingOne(s.itTashkent.actor, tashkentOnly.id)
      expect(seen.company).toEqual(expect.objectContaining({ name: 'Soft Co', industries: [expect.objectContaining({ slug: 'it' })] }))
      expect(JSON.stringify(seen)).not.toContain('co.uz')
      expect(seen.myOffer).toBeNull()
    })
  })

  it('offer → the company sees it without contacts → accepts → contacts open both ways', async () => {
    const s = await setup('tr-accept')
    await s.inT(async () => {
      const req = await service.create(s.tenantId, s.softCo.actor, { directionId: s.dasturlash.id, count: 20, byYear: YEAR + 2 })
      sent.length = 0
      const answered = await service.offer(s.tenantId, s.itTashkent.actor, req.id, { count: 15, byYear: YEAR + 2, comment: 'Python guruhi' })
      expect(answered.myOffer).toMatchObject({ count: 15, status: 'PENDING', contacts: null })
      expect(sent).toEqual([expect.objectContaining({ type: 'training.offer', userIds: [s.softCo.actor.id], params: expect.objectContaining({ institutionName: 'IT texnikumi Toşkent', count: 15 }) })])
      await expect(service.offer(s.tenantId, s.itTashkent.actor, req.id, { count: 1, byYear: YEAR })).rejects.toMatchObject({ code: 'offer_exists' })

      const before = await service.getOwn(s.softCo.actor, req.id)
      expect(before.offers[0]).toMatchObject({ count: 15, status: 'PENDING', contacts: null, institution: { name: 'IT texnikumi Toşkent' } })
      expect(JSON.stringify(before)).not.toContain('+998901112233')
      // Another company cannot decide on it.
      await expect(service.decide(s.tenantId, s.otherCo.actor, before.offers[0].id, true)).rejects.toMatchObject({ code: 'not_found' })

      sent.length = 0
      const after = await service.decide(s.tenantId, s.softCo.actor, before.offers[0].id, true)
      expect(after.offers[0]).toMatchObject({ status: 'ACCEPTED', contacts: { phone: '+998901112233', representative: expect.objectContaining({ name: expect.any(String), jobTitle: 'Direktor' }) } })
      expect(after.summary).toEqual({ pending: 0, accepted: 1, promised: 15 })
      expect(sent).toEqual([expect.objectContaining({ type: 'training.offerAccepted', userIds: [s.itTashkent.actor.id] })])
      expect((await service.incomingOne(s.itTashkent.actor, req.id)).myOffer?.contacts).toMatchObject({ website: 'https://co.uz', address: 'Ofis', email: expect.stringContaining('@test.uz') })
      await expect(service.decide(s.tenantId, s.softCo.actor, before.offers[0].id, false)).rejects.toMatchObject({ code: 'offer_decided' })
      expect(await ctx.prisma.client.auditEvent.count({ where: { action: 'training.offer.accept' } })).toBe(1)
      expect((await service.myOffersList(s.itTashkent.actor)).map((r) => r.id)).toEqual([req.id])
    })
  })

  it('a withdrawn offer can be sent again, a declined one cannot', async () => {
    const s = await setup('tr-withdraw')
    await s.inT(async () => {
      const req = await service.create(s.tenantId, s.softCo.actor, { directionId: s.dasturlash.id, count: 20, byYear: YEAR + 2 })
      const first = await service.offer(s.tenantId, s.itTashkent.actor, req.id, { count: 10, byYear: YEAR + 2 })
      expect((await service.withdraw(s.itTashkent.actor, first.myOffer!.id)).myOffer?.status).toBe('WITHDRAWN')
      expect((await service.offer(s.tenantId, s.itTashkent.actor, req.id, { count: 12, byYear: YEAR + 3 })).myOffer).toMatchObject({ status: 'PENDING', count: 12 })
      await service.decide(s.tenantId, s.softCo.actor, first.myOffer!.id, false)
      await expect(service.withdraw(s.itTashkent.actor, first.myOffer!.id)).rejects.toMatchObject({ code: 'offer_decided' })
      await expect(service.offer(s.tenantId, s.itTashkent.actor, req.id, { count: 12, byYear: YEAR + 3 })).rejects.toMatchObject({ code: 'offer_exists' })
      await expect(service.withdraw(s.itAndijan.actor, first.myOffer!.id)).rejects.toMatchObject({ code: 'not_found' })
    })
  })

  it('a closed request disappears for institutions and cannot be changed; companies see only their own', async () => {
    const s = await setup('tr-close')
    await s.inT(async () => {
      const req = await service.create(s.tenantId, s.softCo.actor, { directionId: s.dasturlash.id, count: 20, byYear: YEAR + 2 })
      await expect(service.getOwn(s.otherCo.actor, req.id)).rejects.toMatchObject({ code: 'not_found' })
      await expect(service.close(s.otherCo.actor, req.id)).rejects.toMatchObject({ code: 'not_found' })
      expect((await service.update(s.softCo.actor, req.id, { count: 25 })).count).toBe(25)
      expect((await service.close(s.softCo.actor, req.id)).status).toBe('CLOSED')
      expect(await service.incoming(s.itTashkent.actor, {})).toEqual([])
      await expect(service.offer(s.tenantId, s.itTashkent.actor, req.id, { count: 1, byYear: YEAR })).rejects.toMatchObject({ code: 'not_found' })
      await expect(service.update(s.softCo.actor, req.id, { count: 30 })).rejects.toMatchObject({ code: 'request_closed' })
      expect((await service.listOwn(s.otherCo.actor))).toEqual([])
    })
  })

  it('a request by an alias belongs to the main direction; unknown direction or region is refused', async () => {
    const s = await setup('tr-alias')
    await s.inT(async () => {
      const alias = await ctx.prisma.client.direction.create({ data: { tenantId: s.tenantId, name: 'Programmalaş', searchKey: 'programmalash', industryId: s.it.id, mergedIntoId: s.dasturlash.id } })
      expect((await service.create(s.tenantId, s.softCo.actor, { directionId: alias.id, count: 3, byYear: YEAR })).direction.id).toBe(s.dasturlash.id)
      await expect(service.create(s.tenantId, s.softCo.actor, { directionId: 'nope', count: 3, byYear: YEAR })).rejects.toMatchObject({ code: 'invalid_direction' })
      await expect(service.create(s.tenantId, s.softCo.actor, { directionId: s.dasturlash.id, count: 3, byYear: YEAR, regionId: 'nowhere' })).rejects.toMatchObject({ code: 'invalid_region' })
    })
  })
})
