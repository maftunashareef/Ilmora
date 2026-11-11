import { describe, expect, it } from 'vitest'
import { sampleData, UNIVERSITIES, UNIVERSITY_PACKAGES, type AdmissionSource, type Preset, type University } from '@ilmora/shared'
import { SiteConfigSchema, SiteService } from '../src/modules/site/site.service'

const label = { uz: 'x', ru: 'x', en: 'x' }
const VERIFIED: AdmissionSource = { url: 'https://uni.example.uz/admission', academicYear: '2025/2026', checkedOn: '2026-10-30', status: 'verified', note: 'Subjects on the official page.' }
const UNI_A: University = { id: 'u-a', name: 'Alpha University', shortName: 'AU', city: 'Tashkent', website: 'https://alpha.example.uz' }
const UNI_B: University = { id: 'u-b', name: 'Beta University' }
const pkg = (id: string, over: Partial<Preset> = {}, courseIds: (string | null)[] = ['a', 'b']): Preset => ({
  id, universityId: 'u-a', program: label, name: label, description: label, admission: VERIFIED, enabled: false,
  slots: courseIds.map((courseId, i) => ({ id: `${id}-s${i}`, label, courseId })), ...over,
})

const row = (id: string, status = 'PUBLISHED', visibility = 'PUBLIC', groups = [{ id: `${id}-g1` }]) => ({ id, status, visibility, groups })
const rows = [row('a'), row('b'), row('draft', 'DRAFT'), row('empty', 'PUBLISHED', 'PUBLIC', [])]
const saved: { presets?: Preset[]; universities?: University[] }[] = []
const make = (storedData: Record<string, unknown>) => {
  const prisma = {
    client: {
      course: { findMany: async ({ where }: { where: { id: { in: string[] } } }) => rows.filter((r) => where.id.in.includes(r.id)) },
      siteConfig: { findUnique: async () => ({ data: storedData, version: 3 }) },
      package: { findMany: async () => [] },
    },
    tx: async (fn: (tx: unknown) => Promise<unknown>) => fn({ siteConfig: { updateMany: async ({ data }: { data: { data: { presets?: Preset[]; universities?: University[] } } }) => (saved.push(data.data), { count: 1 }) } }),
  }
  return new SiteService(prisma as never, { record: async () => undefined } as never)
}
const { packages: _packages, ...fullSite } = sampleData.site
void _packages
const body = (extra: Record<string, unknown>) => ({ ...fullSite, ...extra })

describe('university package input', () => {
  it('accepts a package with a program, an official source and a university list', () => {
    expect(SiteConfigSchema.safeParse(body({ universities: [UNI_A], presets: [pkg('p1')] })).success).toBe(true)
    expect(SiteConfigSchema.safeParse(body({ universities: [UNI_A], presets: [pkg('p1', { admission: { ...VERIFIED, url: '', checkedOn: '', status: 'needs_review' } })] })).success).toBe(true)
  })

  it('refuses a source that is not a plain https link, a malformed date, a bad status and an unknown key', () => {
    const bad = (admission: Record<string, unknown>) => SiteConfigSchema.safeParse(body({ universities: [UNI_A], presets: [pkg('p1', { admission: admission as never })] })).success
    expect(bad({ ...VERIFIED, url: 'http://uni.example.uz/a' })).toBe(false)
    expect(bad({ ...VERIFIED, url: 'javascript:alert(1)' })).toBe(false)
    expect(bad({ ...VERIFIED, checkedOn: '30.10.2026' })).toBe(false)
    expect(bad({ ...VERIFIED, status: 'maybe' })).toBe(false)
    expect(bad({ ...VERIFIED, note: 'n'.repeat(601) })).toBe(false)
    expect(SiteConfigSchema.safeParse(body({ universities: [{ id: 'x', name: '' }] })).success).toBe(false)
    expect(SiteConfigSchema.safeParse(body({ universities: [{ id: 'x', name: 'X', website: 'http://x.example.uz' }] })).success).toBe(false)
  })

  it('accepts every researched university as stored (the records the production migration adds)', () => {
    const result = SiteConfigSchema.safeParse(body({ universities: UNIVERSITIES }))
    expect(result.success, JSON.stringify(result.error?.issues.slice(0, 3))).toBe(true)
  })

  it('accepts the researched packages as stored (the records the production migration adds)', () => {
    const presets: Preset[] = UNIVERSITY_PACKAGES.map((p) => ({
      id: p.id, universityId: p.universityId, program: p.program, directionIds: p.directionIds ?? [], name: p.name, description: p.description,
      slots: p.subjects.map((s, i) => ({ id: `${p.id}-s${i + 1}`, label: s.label, courseId: s.course, ...(s.optional ? { optional: true } : {}) })),
      admission: { ...p.admission }, enabled: false,
    }))
    const result = SiteConfigSchema.safeParse(body({ universities: UNIVERSITIES, presets }))
    expect(result.success, JSON.stringify(result.error?.issues.slice(0, 3))).toBe(true)
  })

  it('has room for a full catalog of universities and programs', () => {
    const many = Array.from({ length: 100 }, (_, i) => pkg(`p${i}`))
    expect(SiteConfigSchema.safeParse(body({ universities: [UNI_A], presets: many })).success).toBe(true)
  })
})

describe('publishing university packages (stubbed storage)', () => {
  it('a verified package whose subjects all map to available courses can be published', async () => {
    saved.length = 0
    await expect(make({ presets: [], universities: [UNI_A] }).update('t', body({ presets: [pkg('p1', { enabled: true })] }), 3)).resolves.toEqual({ version: 4 })
    expect(saved.at(-1)?.presets?.[0].enabled).toBe(true)
  })

  it('a package whose requirements are not verified yet can be published (it is shown as requiring confirmation), but never without an official page', async () => {
    const review = { ...VERIFIED, status: 'needs_review' as const, academicYear: '', checkedOn: '' }
    await expect(make({ presets: [], universities: [UNI_A] }).update('t', body({ presets: [pkg('p1', { enabled: true, admission: review })] }), 3)).resolves.toEqual({ version: 4 })
    await expect(make({ presets: [], universities: [UNI_A] }).update('t', body({ presets: [pkg('p1', { enabled: true, admission: { ...VERIFIED, url: '' } })] }), 3)).rejects.toMatchObject({ code: 'preset_not_verified' })
    await expect(make({ presets: [], universities: [UNI_A] }).update('t', body({ presets: [pkg('p1', { enabled: true, admission: undefined })] }), 3)).rejects.toMatchObject({ code: 'preset_not_verified' })
  })

  it('a subject without an ILMORA course is allowed, a course that cannot be booked or a package with no covered subject is not', async () => {
    await expect(make({ presets: [], universities: [UNI_A] }).update('t', body({ presets: [pkg('p1', { enabled: true }, ['a', null])] }), 3)).resolves.toEqual({ version: 4 })
    await expect(make({ presets: [], universities: [UNI_A] }).update('t', body({ presets: [pkg('p1', { enabled: true }, [null, null])] }), 3)).rejects.toMatchObject({ code: 'preset_not_ready' })
    await expect(make({ presets: [], universities: [UNI_A] }).update('t', body({ presets: [pkg('p1', { enabled: true }, ['a', 'draft'])] }), 3)).rejects.toMatchObject({ code: 'preset_not_ready' })
    await expect(make({ presets: [], universities: [UNI_A] }).update('t', body({ presets: [pkg('p1', { enabled: true }, ['a', 'empty'])] }), 3)).rejects.toMatchObject({ code: 'preset_not_ready' })
  })

  it('removing the official page of a published package is refused until it is unpublished', async () => {
    const published = pkg('p1', { enabled: true })
    const stored = { presets: [published], universities: [UNI_A] }
    await expect(make(stored).update('t', body({ presets: [{ ...published, admission: { ...VERIFIED, url: '' } }] }), 3)).rejects.toMatchObject({ code: 'preset_not_verified' })
    await expect(make(stored).update('t', body({ presets: [{ ...published, enabled: false, admission: { ...VERIFIED, url: '' } }] }), 3)).resolves.toEqual({ version: 4 })
  })

  it('editing the title or description of a published package does not re-run the checks', async () => {
    const published = pkg('p1', { enabled: true })
    await expect(make({ presets: [published], universities: [UNI_A] }).update('t', body({ presets: [{ ...published, name: { uz: 'Yangi', ru: 'Новый', en: 'New' } }] }), 3)).resolves.toEqual({ version: 4 })
  })

  it('a published package cannot be deleted, a draft can', async () => {
    const published = pkg('p1', { enabled: true })
    const draft = pkg('p2')
    await expect(make({ presets: [published, draft], universities: [UNI_A] }).update('t', body({ presets: [draft] }), 3)).rejects.toMatchObject({ code: 'published_preset_removed' })
    saved.length = 0
    await expect(make({ presets: [published, draft], universities: [UNI_A] }).update('t', body({ presets: [published] }), 3)).resolves.toEqual({ version: 4 })
    expect(saved.at(-1)?.presets?.map((p) => p.id)).toEqual(['p1'])
  })

  it('a package that is not about a university is not held to the admission rule', async () => {
    await expect(make({ presets: [] }).update('t', body({ presets: [pkg('g1', { enabled: true, universityId: undefined, admission: undefined })] }), 3)).resolves.toEqual({ version: 4 })
  })
})

describe('universities (stubbed storage)', () => {
  it('keeps the stored universities when a save leaves them out, and replaces them when a list is sent', async () => {
    saved.length = 0
    await make({ presets: [], universities: [UNI_A, UNI_B] }).update('t', fullSite, 3)
    expect(saved.at(-1)?.universities?.map((u) => u.id)).toEqual(['u-a', 'u-b'])
    await make({ presets: [], universities: [UNI_A, UNI_B] }).update('t', body({ universities: [UNI_B] }), 3)
    expect(saved.at(-1)?.universities?.map((u) => u.id)).toEqual(['u-b'])
  })

  it('refuses a package that refers to a university that does not exist, and duplicate university ids', async () => {
    await expect(make({ presets: [], universities: [UNI_A] }).update('t', body({ presets: [pkg('p1', { universityId: 'u-gone' })] }), 3)).rejects.toMatchObject({ code: 'unknown_university' })
    await expect(make({ presets: [], universities: [] }).update('t', body({ universities: [UNI_A, { ...UNI_B, id: 'u-a' }] }), 3)).rejects.toMatchObject({ code: 'duplicate_university' })
    // removing a university in the same save as the packages that used it is fine
    await expect(make({ presets: [pkg('p1')], universities: [UNI_A] }).update('t', body({ universities: [], presets: [] }), 3)).resolves.toEqual({ version: 4 })
  })

  it('the public read lists only universities with a published package; the admin read lists every one', async () => {
    const site = make({ presets: [pkg('p1', { enabled: true }), pkg('p2', { universityId: 'u-b' })], universities: [UNI_A, UNI_B] })
    expect((await site.get('t')).universities?.map((u) => u.id)).toEqual(['u-a'])
    expect((await site.get('t')).presets?.map((p) => p.id)).toEqual(['p1'])
    expect((await site.get('t', true)).universities?.map((u) => u.id)).toEqual(['u-a', 'u-b'])
    expect((await site.get('t', true)).presets?.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect((await make({}).get('t')).universities).toEqual([])
  })

  it('the public read also lists a university marked published, without its draft packages', async () => {
    const site = make({ presets: [pkg('p2', { universityId: 'u-b' })], universities: [UNI_A, { ...UNI_B, published: true }] })
    expect((await site.get('t')).universities?.map((u) => u.id)).toEqual(['u-b'])
    expect((await site.get('t')).presets).toEqual([])
    expect(SiteConfigSchema.safeParse(body({ universities: [{ ...UNI_B, published: true }] })).success).toBe(true)
  })
})

describe('faculties, directions, logos and optional extras', () => {
  const dir = (id: string) => ({ id, name: label, subjects: [label] })
  const UNI_F: University = { ...UNI_A, country: 'Uzbekistan', logoUrl: 'https://cdn.example.uz/logo.png', faculties: [{ id: 'f1', name: label, directions: [dir('d1'), dir('d2')] }] }

  it('accepts faculties with directions and entrance subjects, an https logo, directions on a package and an optional slot', () => {
    const p = pkg('p1', { directionIds: ['d1', 'd2'], durationMonths: 6, slots: [{ id: 's1', label, courseId: 'a' }, { id: 's2', label, courseId: 'b', optional: true }] })
    expect(SiteConfigSchema.safeParse(body({ universities: [UNI_F], presets: [p] })).success).toBe(true)
  })

  it('refuses a logo that is not a plain https link and a duration outside 1–36 months', () => {
    expect(SiteConfigSchema.safeParse(body({ universities: [{ ...UNI_F, logoUrl: 'http://cdn.example.uz/logo.png' }] })).success).toBe(false)
    expect(SiteConfigSchema.safeParse(body({ universities: [{ ...UNI_F, logoUrl: 'javascript:alert(1)' }] })).success).toBe(false)
    // a logo file shipped with the site is accepted, any other relative path is not
    expect(SiteConfigSchema.safeParse(body({ universities: [{ ...UNI_F, logoUrl: '/universities/uni-inha.svg' }] })).success).toBe(true)
    expect(SiteConfigSchema.safeParse(body({ universities: [{ ...UNI_F, logoUrl: '/universities/uni-wiut.png', logoOnDark: true }] })).success).toBe(true)
    expect(SiteConfigSchema.safeParse(body({ universities: [{ ...UNI_F, logoUrl: '/media/../secret.svg' }] })).success).toBe(false)
    expect(SiteConfigSchema.safeParse(body({ universities: [UNI_F], presets: [pkg('p1', { durationMonths: 0 })] })).success).toBe(false)
  })

  it('refuses a package that names a direction its university does not have, and duplicate direction ids', async () => {
    await expect(make({ presets: [], universities: [UNI_F] }).update('t', body({ universities: [UNI_F], presets: [pkg('p1', { directionIds: ['d9'] })] }), 3)).rejects.toMatchObject({ code: 'unknown_direction' })
    const twice = { ...UNI_F, faculties: [{ id: 'f1', name: label, directions: [dir('d1')] }, { id: 'f2', name: label, directions: [dir('d1')] }] }
    await expect(make({ presets: [], universities: [] }).update('t', body({ universities: [twice] }), 3)).rejects.toMatchObject({ code: 'duplicate_direction' })
    await expect(make({ presets: [], universities: [UNI_F] }).update('t', body({ universities: [UNI_F], presets: [pkg('p1', { directionIds: ['d2'] })] }), 3)).resolves.toEqual({ version: 4 })
  })
})
