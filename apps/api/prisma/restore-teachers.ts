/**
 * Safe, non-destructive script to add only missing teacher profiles, centers,
 * and associated courses/subjects into the database without overwriting or deleting
 * any existing records.
 *
 * Usage:
 *   npx tsx prisma/restore-teachers.ts --dry-run   (preview mode, no DB writes)
 *   npx tsx prisma/restore-teachers.ts             (execute insertion of missing records)
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { sampleData, somToTiyin } from '@ilmora/shared'
import type { Prisma } from '../src/generated/prisma/client'
import { PrismaClient } from '../src/generated/prisma/client'

try {
  process.loadEnvFile?.('.env')
} catch {
  /* env from the process */
}

const DATABASE_URL = process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL or DATABASE_MIGRATE_URL is required')

const DRY_RUN = process.argv.includes('--dry-run')
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) })

const TENANT_ID = 'tenant-ilmora'
const TZ = process.env.SCHEDULE_TIMEZONE ?? 'Asia/Tashkent'
const up = <T extends string>(v: T) => v.toUpperCase()
const json = (v: unknown) => v as Prisma.InputJsonValue
const slugOf = (id: string) => id.replace(/^(ce|cat|t|c|sub|v|pl|r|s|g|pkg)-/, '')

async function main() {
  console.log(`\n=== ILMORA Non-Destructive Teacher & Catalog Restore ===`)
  console.log(`Mode: ${DRY_RUN ? 'DRY-RUN (Simulated, no changes written)' : 'LIVE (Non-destructive insert of missing records)'}\n`)

  const tenant = await prisma.tenant.findUnique({ where: { id: TENANT_ID } })
  if (!tenant) {
    throw new Error(`Tenant '${TENANT_ID}' not found. Please ensure database migrations and base seed have run.`)
  }

  const { centers, teachers, subjects, courses } = sampleData

  let centersAdded = 0
  let centersPreserved = 0
  for (const c of centers) {
    const existing = await prisma.center.findUnique({ where: { id: c.id } })
    if (existing) {
      centersPreserved++
      console.log(`[CENTER PRESERVED] ${c.name} (${c.id})`)
    } else {
      centersAdded++
      console.log(`[CENTER MISSING -> TO ADD] ${c.name} (${c.id})`)
      if (!DRY_RUN) {
        await prisma.center.create({
          data: {
            id: c.id,
            tenantId: TENANT_ID,
            slug: slugOf(c.id),
            name: c.name,
            district: json(c.district),
            description: json(c.description),
            tone: c.tone,
          },
        })
      }
    }
  }

  let teachersAdded = 0
  let teachersPreserved = 0
  for (const t of teachers) {
    const existing = await prisma.teacherProfile.findFirst({
      where: {
        tenantId: TENANT_ID,
        OR: [{ id: t.id }, { slug: slugOf(t.id) }],
      },
    })

    if (existing) {
      teachersPreserved++
      console.log(`[TEACHER PRESERVED] ${t.name} (${t.id}) — already present in DB, untouched`)
    } else {
      teachersAdded++
      console.log(`[TEACHER MISSING -> TO ADD] ${t.name} (${t.id}) — center: ${t.centerId}, photo: ${t.avatarUrl ?? 'placeholder'}`)
      if (!DRY_RUN) {
        const data = {
          name: t.name,
          title: json(t.title),
          bio: json(t.bio),
          expertise: t.expertise,
          centerId: t.centerId,
          avatarSeed: t.avatarSeed,
          avatarUrl: t.avatarUrl ?? null,
          bannerTone: t.bannerTone,
          tagline: json(t.tagline),
          channelActive: t.channelActive,
          featuredType: t.featured?.type ?? null,
          featuredId: t.featured?.id ?? null,
        }
        await prisma.teacherProfile.create({
          data: {
            id: t.id,
            tenantId: TENANT_ID,
            slug: slugOf(t.id),
            ...data,
          },
        })
      }
    }
  }

  let subjectsAdded = 0
  let subjectsPreserved = 0
  for (const s of subjects) {
    const existing = await prisma.subject.findUnique({ where: { id: s.id } })
    if (existing) {
      subjectsPreserved++
    } else {
      subjectsAdded++
      if (!DRY_RUN) {
        await prisma.subject.create({
          data: {
            id: s.id,
            tenantId: TENANT_ID,
            teacherId: s.teacherId,
            name: json(s.name),
            description: json(s.description),
          },
        })
      }
    }
  }

  let coursesAdded = 0
  let coursesPreserved = 0
  for (const c of courses) {
    const existing = await prisma.course.findUnique({ where: { id: c.id } })
    if (existing) {
      coursesPreserved++
    } else {
      coursesAdded++
      if (!DRY_RUN) {
        const data = {
          title: json(c.title),
          categoryId: c.categoryId,
          centerId: c.centerId,
          teacherId: c.teacherId,
          subjectId: c.subjectId ?? null,
          summary: json(c.summary),
          description: json(c.description),
          curriculum: json(c.curriculum),
          level: up(c.level) as 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED',
          durationMonths: c.durationMonths,
          priceMinor: somToTiyin(c.price),
          coverSeed: c.coverSeed,
          imageUrl: c.imageUrl ?? null,
          meyosGrant: !!c.meyosGrant,
          status: up(c.status) as 'DRAFT' | 'PUBLISHED' | 'ARCHIVED',
          visibility: up(c.visibility) as 'PUBLIC' | 'PRIVATE',
          audienceStudentIds: c.audience.studentIds,
          audienceGroupIds: c.audience.groupIds,
          featured: c.featured,
          publishedAt: c.status === 'published' ? new Date(c.updatedAt) : null,
        }
        await prisma.course.create({
          data: {
            id: c.id,
            tenantId: TENANT_ID,
            slug: slugOf(c.id),
            ...data,
          },
        })
        for (const g of c.groups) {
          const gd = {
            courseId: c.id,
            name: g.name,
            days: g.days,
            startTime: g.start,
            endTime: g.end,
            room: g.room,
            capacity: g.capacity,
            timezone: TZ,
          }
          await prisma.group.create({
            data: {
              id: g.id,
              tenantId: TENANT_ID,
              ...gd,
            },
          })
        }
      }
    }
  }

  console.log(`\n=== Restore Summary ===`)
  console.log(`Centers:  ${centersPreserved} preserved, ${centersAdded} ${DRY_RUN ? 'simulated' : 'added'}`)
  console.log(`Teachers: ${teachersPreserved} preserved, ${teachersAdded} ${DRY_RUN ? 'simulated' : 'added'}`)
  console.log(`Subjects: ${subjectsPreserved} preserved, ${subjectsAdded} ${DRY_RUN ? 'simulated' : 'added'}`)
  console.log(`Courses:  ${coursesPreserved} preserved, ${coursesAdded} ${DRY_RUN ? 'simulated' : 'added'}`)
  console.log(`Status: ${DRY_RUN ? 'DRY-RUN completed successfully (0 records modified)' : 'Completed successfully'}\n`)
}

main()
  .catch((e) => {
    console.error('Error during restore-teachers:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
