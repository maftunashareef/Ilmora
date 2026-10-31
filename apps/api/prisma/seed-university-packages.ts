/**
 * Imports the researched university preparation packages (packages/shared/src/university-packages.ts) into one tenant's
 * site configuration.
 *
 *   npm run db:seed:universities            (root)  or  npm run prisma:seed:universities -w apps/api
 *
 * Safe for repeated runs and for production: it only ADDS universities and packages that are not there yet (by id) and
 * never changes or deletes anything an admin edited. Each subject is mapped to an existing ILMORA offline course by the
 * course id or slug named in the data file; a subject with no such course is left unmapped and reported, never filled with
 * a made-up course. A package is published only when presetPublishability allows it (every subject mapped to an available
 * course AND its admission requirements verified against an official page); everything else stays an unpublished draft.
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { presetPublishability, UNIVERSITIES, UNIVERSITY_PACKAGES, type Preset, type PresetCourse, type University } from '@ilmora/shared'
import type { Prisma } from '../src/generated/prisma/client'
import { PrismaClient } from '../src/generated/prisma/client'

try {
  process.loadEnvFile?.('.env')
} catch {
  /* env from the process */
}

const DATABASE_URL = process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL is required')
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) })
const TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG ?? 'ilmora'

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } })
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" not found: run the base seed first (npm run db:seed)`)
  const config = await prisma.siteConfig.findUnique({ where: { tenantId: tenant.id } })
  if (!config) throw new Error('Site configuration not found: run the base seed first (npm run db:seed)')
  const data = config.data as { presets?: Preset[]; universities?: University[] } & Record<string, unknown>

  // Offline courses of the tenant, to resolve each subject by course id first and then by slug ("c-algebra" -> "algebra").
  const rows = await prisma.course.findMany({
    where: { tenantId: tenant.id, deletedAt: null, learningFormat: 'OFFLINE' },
    select: { id: true, slug: true, status: true, visibility: true, groups: { where: { deletedAt: null }, select: { id: true } } },
  })
  const courses: PresetCourse[] = rows.map((c) => ({ id: c.id, status: c.status.toLowerCase() as PresetCourse['status'], visibility: c.visibility.toLowerCase() as PresetCourse['visibility'], groups: c.groups }))
  const resolve = (key: string | null): string | null => {
    if (!key) return null
    const row = rows.find((r) => r.id === key) ?? rows.find((r) => r.slug === key.replace(/^c-/, ''))
    return row?.id ?? null
  }

  const universities = [...(data.universities ?? [])]
  let addedUniversities = 0
  for (const u of UNIVERSITIES) {
    if (universities.some((x) => x.id === u.id)) continue
    universities.push({ ...u })
    addedUniversities++
  }

  const presets = [...(data.presets ?? [])]
  const report: string[] = []
  let added = 0
  let published = 0
  for (const seed of UNIVERSITY_PACKAGES) {
    if (presets.some((p) => p.id === seed.id)) continue
    const preset: Preset = {
      id: seed.id, universityId: seed.universityId, program: seed.program, name: seed.name, description: seed.description,
      slots: seed.subjects.map((s, i) => ({ id: `${seed.id}-s${i + 1}`, label: s.label, courseId: resolve(s.course) })),
      admission: { ...seed.admission }, enabled: false,
    }
    const result = presetPublishability(preset, courses)
    preset.enabled = result.ok
    presets.push(preset)
    added++
    if (preset.enabled) published++
    const missing = preset.slots.filter((s) => !s.courseId).map((s) => s.label.en)
    const why = [missing.length ? `no ILMORA course for: ${missing.join(', ')}` : '', preset.admission?.status !== 'verified' ? 'needs verification' : ''].filter(Boolean).join('; ')
    report.push(`  ${preset.enabled ? 'PUBLISHED' : 'draft    '}  ${seed.name.en}${why ? `  (${why})` : ''}`)
  }

  if (addedUniversities === 0 && added === 0) {
    console.log('University packages: nothing to add (all universities and packages already exist).')
    return
  }
  await prisma.siteConfig.update({ where: { tenantId: tenant.id }, data: { data: { ...data, universities, presets } as unknown as Prisma.InputJsonValue, version: { increment: 1 } } })
  console.log(`University packages: ${addedUniversities} universit${addedUniversities === 1 ? 'y' : 'ies'} and ${added} package(s) added, ${published} published (tenant "${TENANT_SLUG}").`)
  for (const line of report) console.log(line)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
