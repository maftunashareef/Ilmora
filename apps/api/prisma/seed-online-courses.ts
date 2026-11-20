/**
 * Imports the curated online course catalog (packages/shared/src/online-courses.ts) into one tenant.
 *
 *   npm run db:seed:online            (root)  or  npm run prisma:seed:online -w apps/api
 *
 * Safe for production and for repeated runs: it only adds the platform center/profile "ILMORA Online", the online
 * categories and the online courses, and it never deletes or changes anything else. On a re-run a course gets its provider
 * facts refreshed from the data file, but its status, visibility and featured flag are left as the Super Admin set them,
 * so unpublishing a course in the admin panel survives. It does not touch demo data and does not need SEED_DEMO.
 * Needs the migrations 20261031000000_course_learning_format and 20261031000100_certificate_available.
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { ONLINE_CATEGORIES, ONLINE_COURSES, type OnlineCategorySlug } from '@ilmora/shared'
import type { Prisma } from '../src/generated/prisma/client'
import { PrismaClient } from '../src/generated/prisma/client'
import { ONLINE_PROVIDER } from '../src/modules/manage/online-provider'

try {
  process.loadEnvFile?.('.env')
} catch {
  /* env from the process */
}

const DATABASE_URL = process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL is required')
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) })
const TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG ?? 'ilmora'
const json = (v: unknown) => v as Prisma.InputJsonValue
const l = (uz: string, ru: string, en: string) => ({ uz, ru, en })

/** The categories of the base catalog the online catalog reuses; created only if a tenant has deleted or never had them. */
const REUSED: Record<'english' | 'math' | 'it' | 'sciences', { id: string; name: ReturnType<typeof l>; glyph: string; sortOrder: number }> = {
  english: { id: 'cat-english', name: l('Ingliz tili', 'Английский язык', 'English'), glyph: 'A', sortOrder: 0 },
  math: { id: 'cat-math', name: l('Matematika', 'Математика', 'Mathematics'), glyph: '∑', sortOrder: 1 },
  it: { id: 'cat-it', name: l('IT', 'IT', 'IT'), glyph: '</>', sortOrder: 2 },
  sciences: { id: 'cat-sciences', name: l('Tabiiy fanlar', 'Естественные науки', 'Sciences'), glyph: '⚗', sortOrder: 3 },
}

/** Deterministic cover seed so a re-run never reshuffles the generated art. */
const seedOf = (key: string) => {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0) % 1000
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } })
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" not found: run the base seed first (npm run db:seed)`)
  const tenantId = tenant.id

  // The platform center and the login-less profile online courses belong to (the real provider and instructor are text on the course).
  const slug = ONLINE_PROVIDER.slug
  const center = (await prisma.center.findFirst({ where: { tenantId, slug } }))
    ?? (await prisma.center.create({ data: { tenantId, slug, name: ONLINE_PROVIDER.name, district: json(ONLINE_PROVIDER.district), description: json(ONLINE_PROVIDER.description), tone: ONLINE_PROVIDER.tone } }))
  const teacher = (await prisma.teacherProfile.findFirst({ where: { tenantId, slug } }))
    ?? (await prisma.teacherProfile.create({ data: { tenantId, slug, name: ONLINE_PROVIDER.name, title: json(ONLINE_PROVIDER.teacherTitle), bio: json(ONLINE_PROVIDER.description), tagline: json(ONLINE_PROVIDER.teacherTagline), centerId: center.id, channelActive: false } }))

  // Categories by slug: the new online ones are added; english, math, it and sciences are reused.
  const categoryIds = new Map<OnlineCategorySlug, string>()
  for (const c of ONLINE_CATEGORIES) {
    const found = await prisma.category.findFirst({ where: { tenantId, slug: c.slug } })
    categoryIds.set(c.slug, found?.id ?? (await prisma.category.create({ data: { id: c.id, tenantId, slug: c.slug, name: json(c.name), glyph: c.glyph, sortOrder: c.sortOrder } })).id)
  }
  for (const [key, c] of Object.entries(REUSED) as [keyof typeof REUSED, (typeof REUSED)[keyof typeof REUSED]][]) {
    const found = await prisma.category.findFirst({ where: { tenantId, slug: key } })
    categoryIds.set(key, found?.id ?? (await prisma.category.create({ data: { id: c.id, tenantId, slug: key, name: json(c.name), glyph: c.glyph, sortOrder: c.sortOrder } })).id)
  }

  let created = 0
  let refreshed = 0
  for (const c of ONLINE_COURSES) {
    const categoryId = categoryIds.get(c.category)
    if (!categoryId) throw new Error(`No category for ${c.category}`)
    const facts = {
      title: json({ uz: c.title, ru: c.title, en: c.title }), categoryId, centerId: center.id, teacherId: teacher.id,
      summary: json(c.summary), description: json(c.description), curriculum: json(c.curriculum.map((x) => ({ uz: x, ru: x, en: x }))),
      level: c.level.toUpperCase() as 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED', durationMonths: 1,
      learningFormat: 'ONLINE' as const, externalUrl: c.url, providerName: c.provider, instructorName: c.instructor, certificate: c.certificate,
      durationText: json(c.durationText ?? { uz: '', ru: '', en: '' }), priceMinor: 0n,
    }
    const existing = await prisma.course.findFirst({ where: { tenantId, slug: c.slug } })
    if (existing) {
      await prisma.course.update({ where: { id: existing.id }, data: facts })
      refreshed++
    } else {
      await prisma.course.create({ data: { id: c.id, tenantId, slug: c.slug, ...facts, coverSeed: seedOf(c.id), status: 'PUBLISHED', visibility: 'PUBLIC', publishedAt: new Date(), featured: false } as Prisma.CourseUncheckedCreateInput })
      created++
    }
  }
  console.log(`Online catalog: ${created} course(s) added, ${refreshed} refreshed (tenant "${TENANT_SLUG}").`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
