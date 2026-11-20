import 'reflect-metadata'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { type RequestActor, TenantContext } from '../src/infra/tenancy/tenant-context'
import type { AttendanceService } from '../src/modules/attendance/attendance.service'
import { CatalogService } from '../src/modules/catalog/catalog.service'
import { CenterService } from '../src/modules/center/center.service'
import { CenterProfileInput } from '../src/modules/manage/manage.schemas'
import { ManageService } from '../src/modules/manage/manage.service'
import type { SessionsService } from '../src/modules/sessions/sessions.service'
import type { SiteService } from '../src/modules/site/site.service'
import { DB_AVAILABLE, TestContext } from './helpers'
import { notificationsStub } from './stubs'

/**
 * The rule (security check 19.11, finding №5): which fields of an APPROVED center change only through Super Admin
 * review. What the Super Admin vouched for when approving — who the center is (name, kind) and how to reach it
 * (address, phone) — must not change on the site without review; cosmetic and internal settings change at once.
 *
 *  - reviewed: the edit is held (pending); the catalog keeps the old value until the Super Admin approves.
 *  - free: the edit applies immediately.
 *
 * Address and phone: the finding asks for review «or at least a flag» for the Super Admin. Here they are `reviewed`
 * meaning «not silently live»: a fix that holds them for review, or one that flags them and keeps the public value
 * until looked at, both satisfy this test. Applying them at once without anything does not.
 */
type Rule = 'reviewed' | 'free'
const RULES: Record<keyof CenterProfileInput, { rule: Rule; why: string }> = {
  name: { rule: 'reviewed', why: 'public identity; renaming into a well-known center' },
  kind: { rule: 'reviewed', why: 'a learning center calling itself a university (the «Университеты» tab)' },
  address: { rule: 'reviewed', why: "taking someone else's address (review or at least a flag)" },
  phone: { rule: 'reviewed', why: "taking someone else's phone (review or at least a flag)" },
  district: { rule: 'free', why: 'coarse area text; the address carries the claim' },
  description: { rule: 'free', why: 'cosmetic text' },
  tone: { rule: 'free', why: 'cosmetic colour' },
  lat: { rule: 'free', why: 'internal: check-in location, not public' },
  lng: { rule: 'free', why: 'internal: check-in location, not public' },
  geoRadiusM: { rule: 'free', why: 'internal: check-in radius' },
  checkInBeforeMin: { rule: 'free', why: 'internal: check-in window' },
  absenceAfterMin: { rule: 'free', why: 'internal: absence window' },
}
const REVIEWED = Object.keys(RULES).filter((k) => RULES[k as keyof CenterProfileInput].rule === 'reviewed') as (keyof CenterProfileInput)[]
const FREE = Object.keys(RULES).filter((k) => RULES[k as keyof CenterProfileInput].rule === 'free') as (keyof CenterProfileInput)[]

// Reviewed fields that today change without review (finding №5; center.service.ts updateProfile writes them directly).
// When a fix lands, its test fails with «remove from KNOWN_GAP_N5» — then remove the field here.
const KNOWN_GAP_N5 = new Set<keyof CenterProfileInput>(['kind', 'address', 'phone'])

describe('Center self-edit: every field is classified', () => {
  it('each key of the center profile schema is in the table, and nothing else', () => {
    // A new field in CenterProfileInput fails here until someone decides whether it needs review.
    expect(Object.keys(RULES).sort()).toEqual(Object.keys(CenterProfileInput.shape).sort())
  })

  it('the known gaps are reviewed fields', () => {
    for (const f of KNOWN_GAP_N5) expect(RULES[f].rule, f).toBe('reviewed')
  })
})

describe.skipIf(!DB_AVAILABLE)('Center self-edit after approval: reviewed fields wait, free fields apply', () => {
  const ctx = new TestContext()
  const db = ctx.prisma.client
  const centers = new CenterService(ctx.prisma, ctx.audit, {} as unknown as AttendanceService, notificationsStub)
  const manage = new ManageService(ctx.prisma, ctx.audit, {} as SessionsService, {} as SiteService, notificationsStub, ctx.env)
  const catalog = new CatalogService(ctx.prisma)
  const owner: RequestActor = { id: 'u-owner', roles: ['PLATFORM_ADMIN'], centerId: null }
  const inTenant = <T>(tenantId: string, fn: () => Promise<T>) => TenantContext.forTenant(tenantId, fn)
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  const text = (s: string) => ({ uz: s, ru: s, en: s })
  // The edit sent for each field and the value expected once it applies. `seen`: what the catalog shows (public fields)
  // or the stored row (internal check-in settings, which the catalog does not carry).
  type Seen = { pub?: Record<string, unknown>; row: { lat: number | null; lng: number | null; geoRadiusM: number | null; checkInBeforeMin: number; absenceAfterMin: number; pendingName: string | null } }
  const EDITS: Record<keyof CenterProfileInput, { input: CenterProfileInput; after: unknown; seen: (s: Seen) => unknown }> = {
    name: { input: { name: 'Mashhur universitet' }, after: 'Mashhur universitet', seen: (s) => s.pub?.name },
    kind: { input: { kind: 'UNIVERSITY' }, after: 'UNIVERSITY', seen: (s) => s.pub?.kind },
    address: { input: { address: 'Amir Temur 1' }, after: 'Amir Temur 1', seen: (s) => s.pub?.address },
    phone: { input: { phone: '+998 90 222 22 22' }, after: '+998902222222', seen: (s) => s.pub?.phone },
    district: { input: { district: text('Chilonzor') }, after: text('Chilonzor'), seen: (s) => s.pub?.district },
    description: { input: { description: text('Yangi tavsif') }, after: text('Yangi tavsif'), seen: (s) => s.pub?.description },
    tone: { input: { tone: '#123456' }, after: '#123456', seen: (s) => s.pub?.tone },
    lat: { input: { lat: 41.3 }, after: 41.3, seen: (s) => s.row.lat },
    lng: { input: { lng: 69.2 }, after: 69.2, seen: (s) => s.row.lng },
    geoRadiusM: { input: { geoRadiusM: 300 }, after: 300, seen: (s) => s.row.geoRadiusM },
    checkInBeforeMin: { input: { checkInBeforeMin: 45 }, after: 45, seen: (s) => s.row.checkInBeforeMin },
    absenceAfterMin: { input: { absenceAfterMin: 90 }, after: 90, seen: (s) => s.row.absenceAfterMin },
  }

  // One tenant; an approved center with its own administrator per field, so edits do not mix. The check-in location is
  // set in full, otherwise editing one of its three values clears the others.
  let tenantId = ''
  beforeAll(async () => {
    tenantId = (await ctx.makeTenant('reviewed')).tenantId
  })
  async function approvedCenter() {
    const s = randomUUID().slice(0, 8)
    return TenantContext.system(async () => {
      const center = await db.center.create({ data: { tenantId, slug: `rv-${s}`, name: `Markaz ${s}`, kind: 'TRAINING_CENTER', district: text('Yunusobod'), description: text('Eski tavsif'), address: 'Eski manzil', phoneE164: '+998901111111', lat: 41, lng: 69, geoRadiusM: 200, status: 'ACTIVE', approvedAt: new Date() } })
      const user = await db.user.create({ data: { tenantId, login: `rv-admin-${s}`, displayName: 'Admin', roles: ['CENTER_ADMIN'], centerId: center.id } })
      const admin: RequestActor = { id: user.id, roles: ['CENTER_ADMIN'], centerId: center.id }
      return { center, admin }
    }, { tenantId })
  }
  async function seen(centerId: string): Promise<Seen> {
    return inTenant(tenantId, async () => {
      const pub = (await catalog.publicCatalog(tenantId)).centers.find((c) => c.id === centerId) as Record<string, unknown> | undefined
      return { pub, row: await db.center.findFirstOrThrow({ where: { id: centerId } }) }
    })
  }

  it.each(REVIEWED)('reviewed: %s stays as approved until the Super Admin approves', async (f) => {
    const { center, admin } = await approvedCenter()
    const edit = EDITS[f]
    const before = edit.seen(await seen(center.id))
    // Setup guard: the field is visible and the edit really is a change.
    expect(before, `${f} visible before the edit`).not.toBeUndefined()
    expect(before).not.toEqual(edit.after)

    await inTenant(tenantId, () => centers.updateProfile(tenantId, admin, edit.input))
    const now = edit.seen(await seen(center.id))
    const holds = JSON.stringify(now) === JSON.stringify(before)
    if (KNOWN_GAP_N5.has(f)) {
      // Today the value goes live at once (finding №5): pin exactly that, so a broken setup still fails.
      expect(now, `${f} applied directly today`).toEqual(edit.after)
      expect(holds, `${f} now reviewed: remove from KNOWN_GAP_N5`).toBe(false)
      return
    }
    expect(holds, `${f} changed on the site without review`).toBe(true)
  })

  it('name: the Super Admin approves and the catalog shows the new name', async () => {
    const { center, admin } = await approvedCenter()
    await inTenant(tenantId, () => centers.updateProfile(tenantId, admin, EDITS.name.input))
    expect((await seen(center.id)).row.pendingName).toBe(EDITS.name.after)
    await inTenant(tenantId, () => manage.reviewCenterName(tenantId, owner, center.id, true))
    expect(EDITS.name.seen(await seen(center.id))).toBe(EDITS.name.after)
  })

  it.each(FREE)('free: %s applies immediately', async (f) => {
    const { center, admin } = await approvedCenter()
    const edit = EDITS[f]
    expect(edit.seen(await seen(center.id))).not.toEqual(edit.after)
    await inTenant(tenantId, () => centers.updateProfile(tenantId, admin, edit.input))
    expect(edit.seen(await seen(center.id))).toEqual(edit.after)
  })
})
