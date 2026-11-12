import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { registrySearchKey, registrySearchText, TECHNIKUMS } from '@ilmora/shared'
import { seedRegistryReference } from '../prisma/registry-reference'
import { ROLES_KEY } from '../src/common/decorators'
import { ZodValidationPipe } from '../src/common/zod.pipe'
import type { RedisService } from '../src/infra/redis/redis.service'
import { TenantContext, type RequestActor } from '../src/infra/tenancy/tenant-context'
import { AccountService } from '../src/modules/auth/account.service'
import { AdminInstitutionsQuery, InstitutionsAdminController, RejectInput } from '../src/modules/institutions/institutions-admin.controller'
import { ClaimInput, DirectionsInput, InstitutionPatch } from '../src/modules/institutions/institutions.schemas'
import { InstitutionReviewService, officialName } from '../src/modules/institutions/institution-review.service'
import { InstitutionsService } from '../src/modules/institutions/institutions.service'
import type { NotifyInput, NotificationsService } from '../src/modules/notifications/notifications.service'
import { DB_AVAILABLE, TestContext } from './helpers'
import { mfaStub } from './stubs'
import type { ExecutionContext } from '@nestjs/common'
import { Reflector } from '@nestjs/core'
import { APPROVED_KEY, ApprovedGuard } from '../src/common/registry-access'

describe.skipIf(!DB_AVAILABLE)('Institution profile: claim, passport, directions, submit (ТЗ 4.2)', () => {
  const ctx = new TestContext()
  const sent: NotifyInput[] = []
  const notifications = {
    notify: async (n: NotifyInput) => (sent.push(n), n.userIds.length),
    safely: async (_label: string, fn: () => Promise<unknown>) => { await fn() },
    ownerIds: async (tenantId: string) => (await TenantContext.system(() => ctx.prisma.client.user.findMany({ where: { tenantId, isOwner: true, isActive: true }, select: { id: true } }))).map((u) => u.id),
  } as unknown as NotificationsService
  const service = new InstitutionsService(ctx.prisma, ctx.audit, notifications)
  const accounts = new AccountService(ctx.prisma, ctx.tokens, ctx.audit, {} as RedisService, notifications, ctx.env, mfaStub)
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  let n = 0
  /** A tenant with the reference data, one district, two directions, one imported institution, a Super Admin and a ministry account. */
  const setup = async (label: string) => {
    const t = await ctx.makeTenant(label)
    const db = ctx.prisma.client
    const inT = <T>(fn: () => Promise<T>) => TenantContext.forTenant(t.tenantId, fn)
    await TenantContext.system(() => seedRegistryReference(db as never, t.tenantId))
    return inT(async () => {
      const it = await db.industry.findFirstOrThrow({ where: { slug: 'it' } })
      const tashkent = await db.region.findFirstOrThrow({ where: { code: '1726' } })
      const andijan = await db.region.findFirstOrThrow({ where: { code: '1703' } })
      const chilonzor = await db.district.create({ data: { tenantId: t.tenantId, regionId: tashkent.id, code: `1726269-${label}`, name: { uz: 'Çilonzor', ru: 'Чиланзар', en: 'Chilanzar' } } })
      const dir = (name: string) => db.direction.create({ data: { tenantId: t.tenantId, name, searchKey: registrySearchKey(name), industryId: it.id } })
      const dasturlash = await dir('Dasturlaş')
      const tarmoq = await dir('Kompyuter tarmoqlari')
      const imported = await db.institution.create({
        data: { tenantId: t.tenantId, type: 'TECHNIKUM', ownership: 'STATE', name: 'Toşkent axborot texnikumi', searchKey: registrySearchKey('Toşkent axborot texnikumi'), stir: '011111111', regionId: tashkent.id, districtId: chilonzor.id, directorName: 'Director', source: 'IMPORT' },
      })
      const ministry = await db.user.create({ data: { tenantId: t.tenantId, login: `min-${label}`, displayName: 'Ministry', roles: ['MINISTRY'] } })
      const owner = await db.user.create({ data: { tenantId: t.tenantId, login: `owner-${label}`, displayName: 'Owner', roles: ['STUDENT'], isOwner: true } })
      /** A registered institution representative, as the API creates it. */
      const representative = async () => {
        const r = await accounts.register(t.tenantId, { role: 'INSTITUTION', login: `rep-${label}-${++n}`, password: 'rep-password-1', displayName: 'Aziz Karimov', jobTitle: 'Direktor örinbosari' }, {})
        const actor: RequestActor = { id: r.user.id, roles: r.user.roles as RequestActor['roles'] }
        return actor
      }
      return { ...t, inT, tashkent, andijan, chilonzor, dasturlash, tarmoq, imported, ministry, owner, representative }
    })
  }

  it('a claim abandoned as a draft for 14 days goes to the next representative; a submitted or recent one does not (security review №17, №18)', async () => {
    const { tenantId, inT, imported, representative } = await setup('inst-abandon')
    await inT(async () => {
      const db = ctx.prisma.client
      const squatter = await representative()
      await service.claim(tenantId, squatter, { stir: '011111111' })
      // The ministry's list fixes the STIR: the claimant cannot swap it for another.
      await expect(service.update(tenantId, squatter, { stir: '099999999' })).rejects.toMatchObject({ code: 'stir_locked' })
      const real = await representative()
      await expect(service.claim(tenantId, real, { stir: '011111111' })).rejects.toMatchObject({ code: 'already_claimed' })
      const old = new Date(Date.now() - 15 * 86_400_000)
      await db.auditEvent.updateMany({ where: { entityId: imported.id, action: 'institution.claim' }, data: { createdAt: old } })
      expect((await db.institution.findUniqueOrThrow({ where: { id: imported.id } })).claimedAt).not.toBeNull()
      await db.institution.update({ where: { id: imported.id }, data: { createdAt: old, claimedAt: old } })
      sent.length = 0
      const r = await service.claim(tenantId, real, { stir: '011111111' })
      expect(r.institution).toMatchObject({ id: imported.id, status: 'DRAFT', representative: { name: 'Aziz Karimov' } })
      expect((await db.user.findUniqueOrThrow({ where: { id: squatter.id } })).institutionId).toBeNull()
      expect((await db.user.findUniqueOrThrow({ where: { id: real.id } })).institutionId).toBe(imported.id)
      expect(sent).toEqual([expect.objectContaining({ type: 'registry.released', userIds: [squatter.id] })])
      expect(await db.auditEvent.count({ where: { entityId: imported.id, action: 'institution.release', reason: 'abandoned-draft' } })).toBe(1)
    })
  })

  it('re-check 11.11 №110: a draft edited lately is not abandoned, whenever it was claimed', async () => {
    const { tenantId, inT, imported, representative } = await setup('inst-110')
    await inT(async () => {
      const db = ctx.prisma.client
      const holder = await representative()
      await service.claim(tenantId, holder, { stir: '011111111' })
      const old = new Date(Date.now() - 15 * 86_400_000)
      await db.institution.update({ where: { id: imported.id }, data: { createdAt: old, claimedAt: old } })
      await db.auditEvent.updateMany({ where: { entityId: imported.id }, data: { createdAt: old } })
      // Edited yesterday — the directions count too.
      await service.setDirections(tenantId, holder, { directions: [] })
      await db.auditEvent.updateMany({ where: { entityId: imported.id, action: 'institution.directions' }, data: { createdAt: new Date(Date.now() - 86_400_000) } })
      const other = await representative()
      await expect(service.claim(tenantId, other, { stir: '011111111' })).rejects.toMatchObject({ code: 'already_claimed' })
      // Two weeks without a touch: released to the next one.
      await db.auditEvent.updateMany({ where: { entityId: imported.id }, data: { createdAt: old } })
      expect((await service.claim(tenantId, other, { stir: '011111111' })).institution).toMatchObject({ id: imported.id, status: 'DRAFT' })
    })
  })

  it('the Super Admin search takes a 9-digit STIR, known statuses and types only', () => {
    const pipe = new ZodValidationPipe(AdminInstitutionsQuery)
    expect(pipe.transform({ stir: '011111111', q: ' axborot ', status: 'APPROVED', page: '2' })).toMatchObject({ stir: '011111111', q: 'axborot', status: 'APPROVED', page: 2 })
    for (const bad of [{ stir: '0111' }, { stir: 'abcdefghi' }, { status: 'MERGED' }, { type: 'SHOP' }, { page: '0' }]) expect(() => pipe.transform(bad)).toThrow()
  })

  it('the review queue shows the official name of a record from the ministry list (security review №18)', () => {
    const t = TECHNIKUMS[0]
    expect(officialName(t.id, 'IMPORT')).toBe(t.name)
    expect(officialName(t.id, 'SELF')).toBeNull()
    expect(officialName('not-in-the-list', 'IMPORT')).toBeNull()
    // The column from the import (Timur's #46) comes first.
    expect(officialName(t.id, 'IMPORT', 'Saqlangan nom')).toBe('Saqlangan nom')
  })

  it('registers an institution representative with the role, the name and the position — never MINISTRY', async () => {
    const { tenantId, inT, representative } = await setup('inst-reg')
    await inT(async () => {
      const rep = await representative()
      expect(rep.roles).toEqual(['INSTITUTION_ADMIN'])
      expect(await ctx.prisma.client.user.findUniqueOrThrow({ where: { id: rep.id } })).toMatchObject({ displayName: 'Aziz Karimov', jobTitle: 'Direktor örinbosari', institutionId: null })
      await expect(accounts.register(tenantId, { role: 'INSTITUTION', login: 'rep-nojob', password: 'rep-password-1', displayName: 'Aziz' }, {})).rejects.toMatchObject({ code: 'invalid_job_title' })
      await expect(accounts.register(tenantId, { role: 'MINISTRY' as never, login: 'rep-min', password: 'rep-password-1' }, {})).rejects.toMatchObject({ code: 'invalid_role' })
    })
  })

  it('claims an imported STIR with its data; a second claimant gets 409', async () => {
    const { tenantId, inT, imported, representative } = await setup('inst-claim')
    await inT(async () => {
      const rep = await representative()
      const r = await service.claim(tenantId, rep, { stir: '011111111' })
      expect(r.created).toBe(false)
      expect(r.institution).toMatchObject({ id: imported.id, name: 'Toşkent axborot texnikumi', status: 'DRAFT', directorName: 'Director', workspaceOpen: false, editable: true, representative: { name: 'Aziz Karimov' } })
      expect((await ctx.prisma.client.user.findUniqueOrThrow({ where: { id: rep.id } })).institutionId).toBe(imported.id)

      const other = await representative()
      await expect(service.claim(tenantId, other, { stir: '011111111' })).rejects.toMatchObject({ code: 'already_claimed' })
      await expect(service.claim(tenantId, rep, { stir: '022222222', type: 'COLLEGE', name: 'Ikkinçi' })).rejects.toMatchObject({ code: 'already_has_institution' })
    })
  })

  it('of two people claiming one STIR at once, exactly one wins', async () => {
    const { tenantId, inT, representative } = await setup('inst-race')
    await inT(async () => {
      const reps = await Promise.all(Array.from({ length: 5 }, () => representative()))
      const results = await Promise.allSettled(reps.map((rep) => service.claim(tenantId, rep, { stir: '011111111' })))
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter((r) => r.status === 'rejected').every((r) => (r as PromiseRejectedResult).reason.code === 'already_claimed')).toBe(true)
      expect(await ctx.prisma.client.user.count({ where: { institutionId: { not: null } } })).toBe(1)

      // A new STIR claimed twice at once: one record.
      const more = await Promise.all(Array.from({ length: 3 }, () => representative()))
      const created = await Promise.allSettled(more.map((rep) => service.claim(tenantId, rep, { stir: '033333333', type: 'TECHNIKUM', name: 'Yangi texnikum' })))
      expect(created.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      expect(await ctx.prisma.client.institution.count({ where: { stir: '033333333' } })).toBe(1)
    })
  })

  it('cybersecurity 9.4: one account claiming two STIRs at once keeps one — the other STIR stays free, not orphaned', async () => {
    const { tenantId, inT, representative } = await setup('inst-two-stirs')
    await inT(async () => {
      const db = ctx.prisma.client
      await db.institution.create({ data: { tenantId, type: 'COLLEGE', name: 'Ikkinçi kollej', searchKey: registrySearchKey('Ikkinçi kollej'), stir: '066666666', source: 'IMPORT' } })
      const rep = await representative()
      const results = await Promise.allSettled([service.claim(tenantId, rep, { stir: '011111111' }), service.claim(tenantId, rep, { stir: '066666666' })])
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
      // No institution left a DRAFT without a representative: the losing claim rolled back whole.
      expect(await db.institution.count({ where: { tenantId, status: 'DRAFT', representative: null } })).toBe(0)
      const left = (await db.institution.findFirstOrThrow({ where: { tenantId, stir: { in: ['011111111', '066666666'] }, status: 'UNCLAIMED' }, select: { stir: true } })).stir
      // …so its real representative can still claim it.
      expect((await service.claim(tenantId, await representative(), { stir: left! })).created).toBe(false)
    })
  })

  it('cybersecurity 9.4: a blocked institution cannot edit its passport or submit it again', async () => {
    const { tenantId, inT, representative } = await setup('inst-blocked')
    await inT(async () => {
      const rep = await representative()
      const r = await service.claim(tenantId, rep, { stir: '011111111' })
      await ctx.prisma.client.institution.update({ where: { id: r.institution.id }, data: { blockedAt: new Date() } })
      await expect(service.update(tenantId, rep, { website: 'https://x.uz' } as never)).rejects.toMatchObject({ code: 'forbidden' })
      await expect(service.setDirections(tenantId, rep, { directions: [] } as never)).rejects.toMatchObject({ code: 'forbidden' })
      await expect(service.submit(tenantId, rep)).rejects.toMatchObject({ code: 'forbidden' })
    })
  })

  it('starts a new record for a STIR not in the registry, with the type and name', async () => {
    const { tenantId, inT, representative } = await setup('inst-new')
    await inT(async () => {
      const rep = await representative()
      await expect(service.claim(tenantId, rep, { stir: '044444444' })).rejects.toMatchObject({ code: 'institution_details_required' })
      const r = await service.claim(tenantId, rep, { stir: '044444444', type: 'LYCEUM', name: 'Akademik litsey' })
      expect(r).toMatchObject({ created: true, institution: { type: 'LYCEUM', name: 'Akademik litsey', stir: '044444444', status: 'DRAFT' } })
      expect(await ctx.prisma.client.institution.findUniqueOrThrow({ where: { id: r.institution.id } })).toMatchObject({ source: 'SELF', searchKey: 'akademik litsey', createdById: rep.id })
    })
  })

  it('is closed to the Super Admin and to accounts without an institution', async () => {
    const { tenantId, inT, representative } = await setup('inst-scope')
    await inT(async () => {
      await expect(service.claim(tenantId, { id: 'owner', roles: ['PLATFORM_ADMIN'] }, { stir: '011111111' })).rejects.toMatchObject({ code: 'forbidden' })
      const rep = await representative()
      await expect(service.passport(rep)).rejects.toMatchObject({ code: 'not_found' })
      await expect(service.update(tenantId, rep, { name: 'X' })).rejects.toMatchObject({ code: 'not_found' })
    })
  })

  it('saves the passport in parts, checks region, district and phone, keeps STIR unique', async () => {
    const { tenantId, inT, tashkent, andijan, chilonzor, representative } = await setup('inst-patch')
    await inT(async () => {
      const rep = await representative()
      await service.claim(tenantId, rep, { stir: '011111111' })
      const p = await service.update(tenantId, rep, { address: 'Bunyodkor köçasi, 1', phone: '90 123 45 67', website: 'https://texnikum.uz', email: '', representative: { jobTitle: 'Direktor' } })
      expect(p).toMatchObject({ address: 'Bunyodkor köçasi, 1', phone: '+998901234567', website: 'https://texnikum.uz', email: null, representative: { jobTitle: 'Direktor' }, district: { id: chilonzor.id } })
      // A new region without a district clears the old district; a district of another region is refused.
      expect((await service.update(tenantId, rep, { regionId: andijan.id })).district).toBeNull()
      await expect(service.update(tenantId, rep, { regionId: andijan.id, districtId: chilonzor.id })).rejects.toMatchObject({ code: 'invalid_district' })
      await service.update(tenantId, rep, { regionId: tashkent.id, districtId: chilonzor.id })
      await expect(service.update(tenantId, rep, { phone: '12' })).rejects.toMatchObject({ code: 'invalid_phone' })

      const other = await representative()
      await service.claim(tenantId, other, { stir: '055555555', type: 'COLLEGE', name: 'Kollej' })
      await expect(service.update(tenantId, other, { stir: '011111111' })).rejects.toMatchObject({ code: 'stir_taken' })
      expect(await ctx.prisma.client.auditEvent.count({ where: { action: 'institution.update' } })).toBeGreaterThan(0)
    })
  })

  it('replaces directions: aliases become the main direction, a direction once, totals computed', async () => {
    const { tenantId, inT, dasturlash, tarmoq, representative } = await setup('inst-dirs')
    await inT(async () => {
      const rep = await representative()
      await service.claim(tenantId, rep, { stir: '011111111' })
      const alias = await ctx.prisma.client.direction.create({ data: { tenantId, name: 'Programmalaş', searchKey: 'programmalash', industryId: dasturlash.industryId, mergedIntoId: dasturlash.id } })
      const p = await service.setDirections(tenantId, rep, { directions: [{ directionId: alias.id, department: 'IT bölimi', studentsCount: 200 }, { directionId: tarmoq.id, studentsCount: 50 }] })
      expect(p.directions.map((d) => [d.direction.id, d.studentsCount, d.department])).toEqual([[dasturlash.id, 200, 'IT bölimi'], [tarmoq.id, 50, null]])
      expect(p.totals).toEqual({ students: 250, directions: 2 })
      await expect(service.setDirections(tenantId, rep, { directions: [{ directionId: alias.id, studentsCount: 1 }, { directionId: dasturlash.id, studentsCount: 2 }] })).rejects.toMatchObject({ code: 'direction_listed_twice' })
      await expect(service.setDirections(tenantId, rep, { directions: [{ directionId: 'nope', studentsCount: 1 }] })).rejects.toMatchObject({ code: 'invalid_direction' })
      expect((await service.setDirections(tenantId, rep, { directions: [{ directionId: tarmoq.id, studentsCount: 10 }] })).totals).toEqual({ students: 10, directions: 1 })
    })
  })

  it('submits only a complete profile, notifies the Super Admin (not the ministry), then locks it until the decision', async () => {
    const { tenantId, inT, dasturlash, owner, representative } = await setup('inst-submit')
    await inT(async () => {
      const rep = await representative()
      const claimed = await service.claim(tenantId, rep, { stir: '011111111' })
      await expect(service.submit(tenantId, rep)).rejects.toMatchObject({ code: 'incomplete_profile', details: { missing: ['address', 'phone', 'directions'] } })
      await service.update(tenantId, rep, { address: 'Manzil', phone: '+998901234567' })
      await service.setDirections(tenantId, rep, { directions: [{ directionId: dasturlash.id, studentsCount: 100 }] })
      sent.length = 0
      const p = await service.submit(tenantId, rep)
      expect(p).toMatchObject({ status: 'PENDING', editable: false, workspaceOpen: false })
      expect(sent).toEqual([expect.objectContaining({ userIds: [owner.id], type: 'institution.submitted', params: { institutionName: 'Toşkent axborot texnikumi', institutionId: claimed.institution.id } })])
      await expect(service.submit(tenantId, rep)).rejects.toMatchObject({ code: 'already_submitted' })
      await expect(service.update(tenantId, rep, { address: 'Boşqa' })).rejects.toMatchObject({ code: 'under_review' })
      await expect(service.setDirections(tenantId, rep, { directions: [] })).rejects.toMatchObject({ code: 'under_review' })
    })
  })

  it('needs a district only when the region has districts in the reference data', async () => {
    const { tenantId, inT, andijan, dasturlash, representative } = await setup('inst-district')
    await inT(async () => {
      const rep = await representative()
      await service.claim(tenantId, rep, { stir: '011111111' })
      await service.update(tenantId, rep, { address: 'Manzil', phone: '+998901234567', districtId: null })
      await service.setDirections(tenantId, rep, { directions: [{ directionId: dasturlash.id, studentsCount: 1 }] })
      await expect(service.submit(tenantId, rep)).rejects.toMatchObject({ code: 'incomplete_profile', details: { missing: ['districtId'] } })
      expect((await service.update(tenantId, rep, { regionId: andijan.id })).district).toBeNull()
      expect((await service.submit(tenantId, rep)).status).toBe('PENDING')
    })
  })

  it('after approval: key fields wait for review in pendingChanges — the record keeps the approved ones; others change at once (security review №13)', async () => {
    const { tenantId, inT, imported, dasturlash, representative } = await setup('inst-approved')
    await inT(async () => {
      const rep = await representative()
      await service.claim(tenantId, rep, { stir: '011111111' })
      await ctx.prisma.client.institution.update({ where: { id: imported.id }, data: { status: 'APPROVED', approvedAt: new Date(), address: 'A', phone: '+998901234567' } })
      sent.length = 0
      const contacts = await service.update(tenantId, rep, { address: 'Yangi manzil' })
      expect(contacts).toMatchObject({ status: 'APPROVED', address: 'Yangi manzil', workspaceOpen: true, editable: true })
      expect(sent).toEqual([])
      await expect(service.submit(tenantId, rep)).rejects.toMatchObject({ code: 'already_approved' })

      const renamed = await service.update(tenantId, rep, { name: 'Toşkent IT texnikumi', ownership: 'PRIVATE' })
      // The live record — what the ministry, search and the companies see — keeps the approved values.
      expect(renamed).toMatchObject({ status: 'APPROVED', workspaceOpen: true, editable: true, name: 'Toşkent axborot texnikumi', ownership: 'STATE', pendingChanges: { name: 'Toşkent IT texnikumi', ownership: 'PRIVATE' } })
      expect(sent.map((s) => s.type)).toEqual(['institution.changed'])
      expect(await ctx.prisma.client.institution.findUniqueOrThrow({ where: { id: imported.id } })).toMatchObject({ searchKey: registrySearchKey('Toşkent axborot texnikumi') })
      // Back to the approved value: that part is no longer waiting.
      expect((await service.update(tenantId, rep, { ownership: 'STATE' })).pendingChanges).toEqual({ name: 'Toşkent IT texnikumi' })
      // Directions and counts change at once, also while the key fields are re-reviewed.
      expect((await service.setDirections(tenantId, rep, { directions: [{ directionId: dasturlash.id, studentsCount: 5 }] })).totals.students).toBe(5)
      const audit = await ctx.prisma.client.auditEvent.findFirstOrThrow({ where: { action: 'institution.update.review', entityId: imported.id }, orderBy: { createdAt: 'asc' } })
      expect(audit).toMatchObject({ after: { pendingChanges: { name: 'Toşkent IT texnikumi', ownership: 'PRIVATE' } } })
      // A STIR held by another record is refused at once.
      await ctx.prisma.client.institution.create({ data: { tenantId, type: 'TECHNIKUM', name: 'Boşqa', searchKey: 'boshqa', stir: '055555555', source: 'SELF' } })
      await ctx.prisma.client.institution.update({ where: { id: imported.id }, data: { source: 'SELF' } })
      await expect(service.update(tenantId, rep, { stir: '055555555' })).rejects.toMatchObject({ code: 'stir_taken' })
    })
  })

  it('takes the region by the web app slug, keeps searchText for the official names, counts districtName for submit', async () => {
    const { tenantId, inT, imported, andijan, dasturlash, representative } = await setup('inst-pr22')
    await inT(async () => {
      await ctx.prisma.client.region.update({ where: { id: andijan.id }, data: { slug: 'andijan' } })
      await ctx.prisma.client.institution.update({ where: { id: imported.id }, data: { nameRu: 'Ташкентский техникум', formerName: 'Eski nom', districtName: 'Asaka tumani' } })
      const rep = await representative()
      await service.claim(tenantId, rep, { stir: '011111111' })
      const moved = await service.update(tenantId, rep, { regionId: 'andijan', address: 'Manzil', phone: '+998901234567' })
      expect(moved).toMatchObject({ region: { id: andijan.id, slug: 'andijan' }, district: null, districtName: 'Asaka tumani', nameRu: 'Ташкентский техникум', formerName: 'Eski nom' })
      await expect(service.update(tenantId, rep, { regionId: 'nowhere' })).rejects.toMatchObject({ code: 'invalid_region' })

      // A record from the ministry's list keeps its official name until it is approved (re-check 11.11 №105); the same
      // name sent again is no change.
      await expect(service.update(tenantId, rep, { name: 'Yangi nom texnikumi' })).rejects.toMatchObject({ code: 'name_locked' })
      await service.update(tenantId, rep, { name: imported.name })
      expect((await ctx.prisma.client.institution.findUniqueOrThrow({ where: { id: imported.id } })).name).toBe('Toşkent axborot texnikumi')
      // No district codes in Andijan, the official list's district text is there: the profile goes.
      await service.setDirections(tenantId, rep, { directions: [{ directionId: dasturlash.id, studentsCount: 3 }] })
      expect((await service.submit(tenantId, rep)).status).toBe('PENDING')

      const fresh = await representative()
      const created = await service.claim(tenantId, fresh, { stir: '066666666', type: 'COLLEGE', name: 'Kollej Bir' })
      expect((await ctx.prisma.client.institution.findUniqueOrThrow({ where: { id: created.institution.id } })).searchText).toBe('kollej bir')
    })
  })

  describe('review by the Super Admin (decision of 10.11)', () => {
    const review = new InstitutionReviewService(ctx.prisma, ctx.audit, notifications, service)

    /** A complete profile sent for review. */
    const submitted = async (label: string) => {
      const env = await setup(label)
      return env.inT(async () => {
        const rep = await env.representative()
        const { institution } = await service.claim(env.tenantId, rep, { stir: '011111111' })
        await service.update(env.tenantId, rep, { address: 'Manzil', phone: '+998901234567' })
        await service.setDirections(env.tenantId, rep, { directions: [{ directionId: env.dasturlash.id, studentsCount: 10 }] })
        await service.submit(env.tenantId, rep)
        return { ...env, rep, id: institution.id, admin: { id: env.owner.id, roles: ['PLATFORM_ADMIN'] } as RequestActor }
      })
    }

    it('shows the queue with where the STIR came from, then approves: workspace open, institution notified', async () => {
      const { tenantId, inT, id, rep, admin } = await submitted('rev-ok')
      await inT(async () => {
        const queue = await review.queue()
        expect(queue).toEqual([expect.objectContaining({ id, inRegistry: true, reReview: false, representative: expect.objectContaining({ name: 'Aziz Karimov', jobTitle: 'Direktor örinbosari' }) })])
        sent.length = 0
        const p = await review.approve(tenantId, admin, id)
        expect(p).toMatchObject({ status: 'APPROVED', workspaceOpen: true, editable: true })
        expect(sent).toEqual([expect.objectContaining({ userIds: [rep.id], type: 'institution.approved' })])
        expect(await review.queue()).toEqual([])
        await expect(review.approve(tenantId, admin, id)).rejects.toMatchObject({ code: 'not_pending' })
        const detail = await review.detail(id)
        expect(detail.history.map((h) => h.action)).toEqual(['institution.claim', 'institution.submit', 'institution.approve'])
      })
    })

    it('rejects with a reason the institution sees; it fixes the profile and sends it again', async () => {
      const { tenantId, inT, id, rep, admin } = await submitted('rev-no')
      await inT(async () => {
        sent.length = 0
        const p = await review.reject(tenantId, admin, id, 'STIR does not match the certificate')
        expect(p).toMatchObject({ status: 'REJECTED', rejectReason: 'STIR does not match the certificate', workspaceOpen: false, editable: true })
        expect(sent).toEqual([expect.objectContaining({ userIds: [rep.id], type: 'institution.rejected', params: expect.objectContaining({ reason: 'STIR does not match the certificate' }) })])
        await service.update(tenantId, rep, { address: 'Toğri manzil' })
        expect((await service.submit(tenantId, rep)).status).toBe('PENDING')
        expect((await review.detail(id)).history.find((h) => h.action === 'institution.reject')?.reason).toBe('STIR does not match the certificate')
      })
    })

    it('students who named it before the approval are asked about at the approval (security review №16)', async () => {
      const { tenantId, inT, id, admin } = await submitted('rev-students')
      await inT(async () => {
        const db = ctx.prisma.client
        const profile = async (mode: 'STUDYING' | 'APPLYING') => {
          const u = await ctx.makeStudent(tenantId)
          await db.studentProfile.create({ data: { tenantId, userId: u.id, mode, institutionId: id, studyConfirmation: 'NONE' } })
          return u.id
        }
        const studying = await profile('STUDYING')
        const applying = await profile('APPLYING')
        await review.approve(tenantId, admin, id)
        const state = async (userId: string) => (await db.studentProfile.findUniqueOrThrow({ where: { userId } })).studyConfirmation
        expect(await state(studying)).toBe('PENDING')
        expect(await state(applying)).toBe('NONE')
      })
    })

    it('the Super Admin releases a record from its representative, with a reason; the next one claims it', async () => {
      const { tenantId, inT, id, rep, admin, representative } = await submitted('rev-release')
      await inT(async () => {
        await review.approve(tenantId, admin, id)
        sent.length = 0
        expect(await review.release(tenantId, id, 'Not the institution representative')).toMatchObject({ status: 'UNCLAIMED', workspaceOpen: false })
        const p = await ctx.prisma.client.institution.findUniqueOrThrow({ where: { id } })
        expect(p).toMatchObject({ status: 'UNCLAIMED', approvedAt: null })
        expect((await ctx.prisma.client.user.findUniqueOrThrow({ where: { id: rep.id } })).institutionId).toBeNull()
        expect(sent).toEqual([expect.objectContaining({ type: 'registry.released', userIds: [rep.id] })])
        await expect(review.release(tenantId, id, 'Again, no one')).rejects.toMatchObject({ code: 'not_claimed' })
        const next = await representative()
        expect((await service.claim(tenantId, next, { stir: '011111111' })).institution).toMatchObject({ id, status: 'DRAFT', workspaceOpen: false })
      })
    })

    it('a change after approval: rejected — the approved values stay; approved — they move into the record; one decision of two', async () => {
      const { tenantId, inT, id, rep, admin } = await submitted('rev-again')
      await inT(async () => {
        await review.approve(tenantId, admin, id)
        await service.update(tenantId, rep, { name: 'Boşqa nom' })
        expect((await review.queue())[0]).toMatchObject({ id, reReview: true, name: 'Toşkent axborot texnikumi', pendingChanges: { name: 'Boşqa nom' } })
        const p = await review.reject(tenantId, admin, id, 'Name differs from the documents')
        expect(p).toMatchObject({ status: 'APPROVED', workspaceOpen: true, name: 'Toşkent axborot texnikumi', pendingChanges: null, rejectReason: 'Name differs from the documents' })
        expect(await review.queue()).toEqual([])

        await service.update(tenantId, rep, { name: 'Toşkent IT texnikumi' })
        const results = await Promise.allSettled([review.approve(tenantId, admin, id), review.approve(tenantId, admin, id)])
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
        expect(await ctx.prisma.client.institution.findUniqueOrThrow({ where: { id } })).toMatchObject({ name: 'Toşkent IT texnikumi', searchKey: registrySearchKey('Toşkent IT texnikumi'), status: 'APPROVED', pendingChanges: null, rejectReason: null })
        expect((await review.detail(id)).history.map((h) => h.action)).toEqual(expect.arrayContaining(['institution.change.reject', 'institution.change.approve']))
      })
    })

    it('the Super Admin finds any record — by STIR, name (official too), status, type, region — not only the queue (issue #50)', async () => {
      const { tenantId, inT, id, admin, tashkent } = await submitted('rev-search')
      await inT(async () => {
        await review.approve(tenantId, admin, id)
        await ctx.prisma.client.institution.update({ where: { id }, data: { name: 'Boşqa nom', searchKey: registrySearchKey('Boşqa nom'), searchText: registrySearchText('Boşqa nom'), officialName: 'Toşkent axborot texnikumi' } })
        const unclaimed = await ctx.prisma.client.institution.create({ data: { tenantId, type: 'COLLEGE', name: 'Bo‘sh kollej', searchKey: registrySearchKey('Bo‘sh kollej'), stir: '066666666', source: 'IMPORT', regionId: tashkent.id } })
        const merged = await ctx.prisma.client.institution.create({ data: { tenantId, type: 'TECHNIKUM', name: 'Dubl', searchKey: 'dubl', source: 'STUDENT', status: 'UNCLAIMED', mergedIntoId: id } })

        // Without a status: the records somebody represents — whatever their status.
        const all = await review.search({ page: 1 })
        expect(all).toMatchObject({ total: 1, page: 1, pageSize: 50, items: [{ id, stir: '011111111', status: 'APPROVED', approvedAt: expect.any(String), blocked: false, inRegistry: true, representative: { name: 'Aziz Karimov' } }] })
        expect((await review.search({ stir: '011111111', page: 1 })).items.map((i) => i.id)).toEqual([id])
        expect((await review.search({ q: 'axborot texnikumi', page: 1 })).items.map((i) => i.id)).toEqual([id])
        expect((await review.search({ q: 'boşqa', page: 1 })).items.map((i) => i.id)).toEqual([id])
        expect((await review.search({ status: 'UNCLAIMED', page: 1 })).items.map((i) => i.id)).toEqual([unclaimed.id])
        expect((await review.search({ status: 'UNCLAIMED', type: 'TECHNIKUM', page: 1 })).items).toEqual([])
        expect((await review.search({ status: 'UNCLAIMED', regionId: tashkent.id, page: 1 })).total).toBe(1)
        expect((await review.search({ regionId: 'mars', page: 1 })).total).toBe(0)
        expect(JSON.stringify(await review.search({ q: 'dubl', status: 'UNCLAIMED', page: 1 }))).not.toContain(merged.id)
      })
    })

    it('the Super Admin blocks and unblocks with a reason: the workspace closes, the status stays, the institution is told', async () => {
      const { tenantId, inT, id, rep, admin } = await submitted('rev-block')
      await inT(async () => {
        await review.approve(tenantId, admin, id)
        sent.length = 0
        const blocked = await review.setBlocked(tenantId, admin, id, true, 'Documents are forged')
        expect(blocked).toMatchObject({ status: 'APPROVED', workspaceOpen: false, blocked: { reason: 'Documents are forged' } })
        expect(sent).toEqual([expect.objectContaining({ type: 'registry.blocked', userIds: [rep.id] })])
        await expect(review.setBlocked(tenantId, admin, id, true, 'Again')).rejects.toMatchObject({ code: 'already_blocked' })
        const guard = new ApprovedGuard(new Reflector(), ctx.prisma)
        const handler = () => undefined
        Reflect.defineMetadata(APPROVED_KEY, 'institution', handler)
        const ctxFor = { getHandler: () => handler, getClass: () => class {}, switchToHttp: () => ({ getRequest: () => ({ actor: rep }) }) } as unknown as ExecutionContext
        await expect(guard.canActivate(ctxFor)).rejects.toMatchObject({ code: 'not_approved' })
        expect(await review.setBlocked(tenantId, admin, id, false)).toMatchObject({ workspaceOpen: true, blocked: null })
        await expect(guard.canActivate(ctxFor)).resolves.toBe(true)
        expect(await ctx.prisma.client.auditEvent.count({ where: { entityId: id, action: { in: ['institution.block', 'institution.unblock'] } } })).toBe(2)
      })
    })

    it('re-check 11.11 №107: students who named it while it was blocked are asked about when it is unblocked', async () => {
      const { tenantId, inT, id, admin } = await submitted('rev-107')
      await inT(async () => {
        const db = ctx.prisma.client
        await review.approve(tenantId, admin, id)
        await review.setBlocked(tenantId, admin, id, true, 'Documents are forged')
        const u = await ctx.makeStudent(tenantId)
        // Named while blocked: nobody to confirm (StudentsService.confirmationFor).
        await db.studentProfile.create({ data: { tenantId, userId: u.id, mode: 'STUDYING', institutionId: id, studyConfirmation: 'NONE' } })
        await review.setBlocked(tenantId, admin, id, false)
        expect((await db.studentProfile.findUniqueOrThrow({ where: { userId: u.id } })).studyConfirmation).toBe('PENDING')
      })
    })

    it('re-check 11.11 №112: a record released from the one it was blocked for is open to the next representative', async () => {
      const { tenantId, inT, id, admin, representative } = await submitted('rev-112')
      await inT(async () => {
        await review.approve(tenantId, admin, id)
        await review.setBlocked(tenantId, admin, id, true, 'Not the real representative')
        await review.release(tenantId, id, 'Not the institution representative')
        expect(await ctx.prisma.client.institution.findUniqueOrThrow({ where: { id } })).toMatchObject({ blockedAt: null, blockReason: null, status: 'UNCLAIMED' })
        const next = await representative()
        expect((await service.claim(tenantId, next, { stir: '011111111' })).institution).toMatchObject({ id, status: 'DRAFT', blocked: null })
      })
    })

    it('two reviewers deciding at once: exactly one decision counts', async () => {
      const { tenantId, inT, id, admin } = await submitted('rev-race')
      await inT(async () => {
        const results = await Promise.allSettled([review.approve(tenantId, admin, id), review.reject(tenantId, admin, id, 'Wrong data here'), review.approve(tenantId, admin, id)])
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
        expect(await ctx.prisma.client.auditEvent.count({ where: { entityId: id, action: { in: ['institution.approve', 'institution.reject'] } } })).toBe(1)
      })
    })

    it('answers not found for an unknown id', async () => {
      const { tenantId, inT, admin } = await submitted('rev-404')
      await inT(async () => {
        await expect(review.detail('nope')).rejects.toMatchObject({ code: 'not_found' })
        await expect(review.approve(tenantId, admin, 'nope')).rejects.toMatchObject({ code: 'not_found' })
      })
    })
  })
})

describe('Institution profile input', () => {
  it('needs a 9-digit STIR and refuses unknown fields and markup', () => {
    const claim = new ZodValidationPipe(ClaimInput)
    expect(claim.transform({ stir: ' 123456789 ' })).toEqual({ stir: '123456789' })
    expect(() => claim.transform({ stir: '12345678' })).toThrow()
    const patch = new ZodValidationPipe(InstitutionPatch)
    expect(() => patch.transform({ status: 'APPROVED' })).toThrow()
    expect(() => patch.transform({ approvedAt: '2026-01-01' })).toThrow()
    expect(() => patch.transform({ address: '<script>x</script>' })).toThrow()
    expect(() => patch.transform({ website: 'javascript:alert(1)' })).toThrow()
    expect(patch.transform({ address: '  ', directorName: ' Ali  Valiyev ' })).toEqual({ address: null, directorName: 'Ali Valiyev' })
    const dirs = new ZodValidationPipe(DirectionsInput)
    expect(() => dirs.transform({ directions: [{ directionId: 'd', studentsCount: 0 }] })).toThrow()
    expect(() => dirs.transform({ directions: [{ directionId: 'd', studentsCount: 1.5 }] })).toThrow()
  })
})

describe('Institution review: access and input', () => {
  it('the review routes are for the Super Admin only — the ministry is not let in', () => {
    const roles = Reflect.getMetadata(ROLES_KEY, InstitutionsAdminController) as string[]
    expect(roles).toEqual(['PLATFORM_ADMIN'])
  })

  it('needs a reason of 5+ characters without markup', () => {
    const pipe = new ZodValidationPipe(RejectInput)
    expect(pipe.transform({ reason: '  Wrong STIR  ' })).toEqual({ reason: 'Wrong STIR' })
    expect(() => pipe.transform({ reason: 'no' })).toThrow()
    expect(() => pipe.transform({ reason: '<b>bad</b> data' })).toThrow()
  })
})
