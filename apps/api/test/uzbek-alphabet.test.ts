import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { foldForSearch } from '@ilmora/shared'
import { TenantContext } from '../src/infra/tenancy/tenant-context'
import { CatalogService } from '../src/modules/catalog/catalog.service'
import { DB_AVAILABLE, TestContext } from './helpers'

/** ILMORA's Uzbek letters (Ğ ğ Ö ö Ş ş Ç ç) are stored, returned and searched without loss or re-normalisation. */
describe.skipIf(!DB_AVAILABLE)('Uzbek alphabet: storage and API responses', () => {
  const ctx = new TestContext()
  const catalog = new CatalogService(ctx.prisma)
  beforeAll(() => ctx.connect())
  afterAll(() => ctx.close())

  const title = { uz: 'Öquvçilar uçun şahmat va Ğalaba — Çiroyli yozuv', ru: 'Шахматы для учеников', en: 'Chess for students' }
  const summary = { uz: 'Toşkent, Özbekiston: ŞAHAR, ÇIROYLI, ĞALABA, ÖQUVÇI', ru: 'Ташкент', en: 'Tashkent' }

  it('saves a course with the new letters and the public catalog returns them byte for byte', async () => {
    const t = await ctx.makeTenant('uzabc')
    await TenantContext.system(() => ctx.prisma.client.course.update({ where: { id: t.course.id }, data: { title, summary } }))
    const { courses } = await TenantContext.forTenant(t.tenantId, () => catalog.publicCatalog(t.tenantId))
    const course = courses.find((c) => c.id === t.course.id)!
    expect(course.title).toEqual(title)
    expect(course.summary).toEqual(summary)
    const uz = (course.title as { uz: string }).uz
    expect(uz).toBe(uz.normalize('NFC'))
    // The JSON a browser receives keeps the precomposed letters (no combining marks, no escapes lost).
    const json = JSON.parse(JSON.stringify({ courses }))
    expect(json.courses.find((c: { id: string }) => c.id === t.course.id).title.uz).toBe(title.uz)
    expect(title.uz).not.toMatch(/[̀-ͯ]/)
  })

  it('keeps site settings with the new letters intact', async () => {
    const t = await ctx.makeTenant('uzabc')
    const nav = [{ id: 'n1', label: { uz: 'Barça çegirmalar — Öquvçilar uçun', ru: 'Свой набор', en: 'My set' }, path: '/course-finder', enabled: true }]
    await TenantContext.system(() => ctx.prisma.client.siteConfig.update({ where: { tenantId: t.tenantId }, data: { data: { nav } } }))
    const row = await TenantContext.system(() => ctx.prisma.client.siteConfig.findUniqueOrThrow({ where: { tenantId: t.tenantId } }))
    expect((row.data as { nav: typeof nav }).nav[0].label.uz).toBe('Barça çegirmalar — Öquvçilar uçun')
  })

  it('finds the stored text whichever Uzbek spelling a visitor types', () => {
    for (const q of ['şahmat', 'shahmat', 'öquvçi', 'o‘quvchi', "o'quvchi", 'oquvchi', 'ğalaba', 'galaba']) expect(foldForSearch(title.uz)).toContain(foldForSearch(q))
  })
})
