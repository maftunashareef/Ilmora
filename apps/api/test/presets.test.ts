import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { sampleData, type Preset } from '@ilmora/shared'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { SiteService } from '../src/modules/site/site.service'
import { DB_AVAILABLE, TestContext } from './helpers'

describe.skipIf(!DB_AVAILABLE)('presets: only existing, available courses can back an enabled preset', () => {
  const ctx = new TestContext()
  const site = new SiteService(ctx.prisma, ctx.audit)

  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  const label = { uz: '', ru: '', en: '' }
  const preset = (courseIds: (string | null)[], enabled: boolean, id = 'p1'): Preset => ({
    id,
    name: { uz: 'Test', ru: 'Test', en: 'Test' },
    description: label,
    slots: courseIds.map((courseId, i) => ({ id: `s${i}`, label, courseId })),
    enabled,
  })
  const check = (tenantId: string, presets: Preset[], previous: unknown = []) => TenantContext.forTenant(tenantId, () => site.assertPresetsUsable(presets, previous))

  it('rejects a preset that refers to a course that does not exist', async () => {
    const t = await ctx.makeTenant('preset')
    await expect(check(t.tenantId, [preset([t.course.id, 'no-such-course'], false)])).rejects.toMatchObject({ code: 'invalid_preset_course' })
  })

  it('accepts a disabled preset that is still being filled in', async () => {
    const t = await ctx.makeTenant('preset')
    await expect(check(t.tenantId, [preset([t.course.id, null], false)])).resolves.toBeUndefined()
  })

  it('enables a preset only when every course is published, public and has a group', async () => {
    const t = await ctx.makeTenant('preset')
    await expect(check(t.tenantId, [preset([t.course.id, t.course2.id], true)])).resolves.toBeUndefined()
    await expect(check(t.tenantId, [preset([t.course.id, null], true)])).rejects.toMatchObject({ code: 'preset_not_ready' })
    await expect(check(t.tenantId, [preset([t.course.id, t.course.id], true)])).rejects.toMatchObject({ code: 'preset_not_ready' })

    await TenantContext.system(() => ctx.prisma.client.course.update({ where: { id: t.course2.id }, data: { status: 'DRAFT' } }))
    await expect(check(t.tenantId, [preset([t.course.id, t.course2.id], true)])).rejects.toMatchObject({ code: 'preset_not_ready' })
  })

  it('does not re-check an unchanged preset, so a later course change never blocks other site edits', async () => {
    const t = await ctx.makeTenant('preset')
    const enabled = preset([t.course.id, t.course2.id], true)
    await TenantContext.system(() => ctx.prisma.client.course.update({ where: { id: t.course2.id }, data: { status: 'DRAFT' } }))
    await expect(check(t.tenantId, [enabled], [enabled])).resolves.toBeUndefined()
    await expect(check(t.tenantId, [{ ...enabled, slots: enabled.slots.slice(0, 1) }], [enabled])).resolves.toBeUndefined()
  })
})

/** The same rules without a database: the course lookup is stubbed, so this always runs. */
describe('presets: validation rules (stubbed course lookup)', () => {
  const row = (id: string, status = 'PUBLISHED', visibility = 'PUBLIC', groups = [{ id: `${id}-g1` }]) => ({ id, status, visibility, groups })
  const rows = [row('a'), row('b'), row('draft', 'DRAFT'), row('private', 'PUBLISHED', 'PRIVATE'), row('empty', 'PUBLISHED', 'PUBLIC', [])]
  let lookups = 0
  const prisma = { client: { course: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => (lookups++, rows.filter((r) => where.id.in.includes(r.id))) } } }
  const site = new SiteService(prisma as never, {} as never)

  const label = { uz: '', ru: '', en: '' }
  const preset = (courseIds: (string | null)[], enabled: boolean): Preset => ({
    id: 'p1',
    name: label,
    description: label,
    slots: courseIds.map((courseId, i) => ({ id: `s${i}`, label, courseId })),
    enabled,
  })

  it('rejects unknown courses, even in a disabled preset', async () => {
    await expect(site.assertPresetsUsable([preset(['a', 'nope'], false)], [])).rejects.toMatchObject({ code: 'invalid_preset_course' })
  })

  it('lets a disabled preset be saved half-filled', async () => {
    await expect(site.assertPresetsUsable([preset(['a', null], false)], [])).resolves.toBeUndefined()
  })

  it('enables only fully available presets and reports every problem slot', async () => {
    await expect(site.assertPresetsUsable([preset(['a', 'b'], true)], [])).resolves.toBeUndefined()
    for (const bad of ['draft', 'private', 'empty', 'a']) {
      await expect(site.assertPresetsUsable([preset(['a', bad], true)], [])).rejects.toMatchObject({ code: 'preset_not_ready' })
    }
    await expect(site.assertPresetsUsable([preset(['a', null], true)], [])).rejects.toMatchObject({ code: 'preset_not_ready', details: { presetId: 'p1', issues: [{ slotId: 's1', reason: 'unset' }] } })
  })

  it('skips presets that did not change, but re-checks one whose courses or switch changed', async () => {
    const stored = preset(['a', 'draft'], true)
    lookups = 0
    await expect(site.assertPresetsUsable([stored], [stored])).resolves.toBeUndefined()
    expect(lookups).toBe(0)
    await expect(site.assertPresetsUsable([preset(['a', 'draft'], true)], [{ ...stored, enabled: false }])).rejects.toMatchObject({ code: 'preset_not_ready' })
    await expect(site.assertPresetsUsable([preset(['a', 'empty'], true)], [stored])).rejects.toMatchObject({ code: 'preset_not_ready' })
  })
})

/** Public vs admin read of the site configuration, and saves that leave `presets` out (stubbed storage, always runs). */
describe('presets: internal until enabled (stubbed storage)', () => {
  const label = { uz: '', ru: '', en: '' }
  const mk = (id: string, enabled: boolean): Preset => ({ id, name: { uz: id, ru: id, en: id }, description: label, slots: [{ id: 's1', label, courseId: null }], enabled })
  const on = mk('on', true)
  const off = mk('off', false)

  const savedList: { presets?: Preset[] }[] = []
  const make = (storedData: Record<string, unknown>) => {
    const prisma = {
      client: {
        siteConfig: { findUnique: async () => ({ data: storedData, version: 3 }) },
        package: { findMany: async () => [] },
      },
      tx: async (fn: (tx: unknown) => Promise<unknown>) => fn({ siteConfig: { updateMany: async ({ data }: { data: { data: { presets?: Preset[] } } }) => (savedList.push(data.data), { count: 1 }) } }),
    }
    return new SiteService(prisma as never, { record: async () => undefined } as never)
  }
  const { packages: _packages, ...fullSite } = sampleData.site
  void _packages

  it('hides disabled presets from the public read and shows everything to the admin read', async () => {
    const site = make({ presets: [on, off] })
    expect((await site.get('t')).presets?.map((p) => p.id)).toEqual(['on'])
    expect((await site.get('t', true)).presets?.map((p) => p.id)).toEqual(['on', 'off'])
  })

  it('treats a stored site without presets as having none', async () => {
    expect((await make({}).get('t')).presets).toEqual([])
  })

  it('keeps the stored presets when a save leaves them out, so an unloaded editor cannot delete disabled ones', async () => {
    savedList.length = 0
    await expect(make({ presets: [on, off] }).update('t', fullSite, 3)).resolves.toEqual({ version: 4 })
    expect(savedList.at(-1)?.presets?.map((p) => p.id)).toEqual(['on', 'off'])
  })

  it('replaces the stored presets when a save sends a list, including an empty one (drafts only: a published package must be unpublished first)', async () => {
    savedList.length = 0
    await make({ presets: [off] }).update('t', { ...fullSite, presets: [] }, 3)
    expect(savedList.at(-1)?.presets).toEqual([])
    await expect(make({ presets: [on, off] }).update('t', { ...fullSite, presets: [off] }, 3)).rejects.toMatchObject({ code: 'published_preset_removed' })
  })
})
