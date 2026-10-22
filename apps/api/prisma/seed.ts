/**
 * Database seed. Idempotent (upserts keyed by the stable sample ids), so it can run on every deploy.
 *
 *   npx prisma db seed            (via prisma.config.ts)  or  npm run prisma:seed
 *
 * Production: creates the tenant, site template, packages and the catalog only.
 * Demo/staging (SEED_DEMO=true, default outside production): also creates demo students, teacher logins,
 * subscriptions, lesson sessions and sample attendance so every workspace has data to show.
 * Super Admin is never seeded: designate the owner account with `npm run owner:setup -- --login <login>`.
 * SEED_DEMO_PASSWORD (optional, demo mode only): gives every demo account this password for login + password sign-in.
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { sampleData, scheduleDates, somToTiyin } from '@ilmora/shared'
import argon2 from 'argon2'
import type { Prisma } from '../src/generated/prisma/client'
import { PrismaClient } from '../src/generated/prisma/client'
import { addDays, isoToDateColumn, localDate, zonedTimeToUtc } from '../src/common/time'

try {
  process.loadEnvFile?.('.env')
} catch {
  /* env from the process */
}

const DATABASE_URL = process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL is required')
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) })

const TENANT_ID = 'tenant-ilmora'
const TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG ?? 'ilmora'
const WEB_ORIGIN = process.env.PUBLIC_WEB_URL ?? 'http://localhost:3000'
const TZ = process.env.SCHEDULE_TIMEZONE ?? 'Asia/Tashkent'
const SEED_DEMO = (process.env.SEED_DEMO ?? (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true'
const up = <T extends string>(v: T) => v.toUpperCase()
const json = (v: unknown) => v as Prisma.InputJsonValue
const slugOf = (id: string) => id.replace(/^(ce|cat|t|c|sub|v|pl|r|s|g|pkg)-/, '')

/** Deterministic pseudo-random in [0, 1) so sample attendance is stable between runs. */
const hash01 = (key: string) => {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619) }
  return ((h >>> 0) % 1000) / 1000
}

async function main() {
  const { centers, categories, teachers, subjects, courses, videos, playlists, resources, site } = sampleData

  await prisma.tenant.upsert({ where: { id: TENANT_ID }, update: { slug: TENANT_SLUG, webOrigin: WEB_ORIGIN }, create: { id: TENANT_ID, slug: TENANT_SLUG, name: 'ILMORA', webOrigin: WEB_ORIGIN } })

  const { packages, ...siteData } = site
  // Demo mode re-applies the sample site template (texts, sections); production never overwrites the admin's site config.
  await prisma.siteConfig.upsert({ where: { tenantId: TENANT_ID }, update: SEED_DEMO ? { data: json(siteData) } : {}, create: { tenantId: TENANT_ID, data: json(siteData) } })
  for (const [i, p] of packages.entries()) {
    await prisma.package.upsert({
      where: { id: p.id },
      update: { name: json(p.name), description: json(p.description), perks: json(p.perks), maxCourses: p.maxCourses, enabled: p.enabled, highlight: p.highlight, sortOrder: i },
      create: { id: p.id, tenantId: TENANT_ID, code: slugOf(p.id), name: json(p.name), description: json(p.description), perks: json(p.perks), maxCourses: p.maxCourses, enabled: p.enabled, highlight: p.highlight, sortOrder: i },
    })
  }

  for (const c of centers) {
    await prisma.center.upsert({ where: { id: c.id }, update: { name: c.name, district: json(c.district), description: json(c.description), tone: c.tone }, create: { id: c.id, tenantId: TENANT_ID, slug: slugOf(c.id), name: c.name, district: json(c.district), description: json(c.description), tone: c.tone } })
  }
  for (const [i, c] of categories.entries()) {
    await prisma.category.upsert({ where: { id: c.id }, update: { name: json(c.name), glyph: c.glyph, sortOrder: i }, create: { id: c.id, tenantId: TENANT_ID, slug: slugOf(c.id), name: json(c.name), glyph: c.glyph, sortOrder: i } })
  }
  for (const t of teachers) {
    const data = { name: t.name, title: json(t.title), bio: json(t.bio), expertise: t.expertise, centerId: t.centerId, avatarSeed: t.avatarSeed, bannerTone: t.bannerTone, tagline: json(t.tagline), channelActive: t.channelActive, featuredType: t.featured?.type ?? null, featuredId: t.featured?.id ?? null }
    await prisma.teacherProfile.upsert({ where: { id: t.id }, update: data, create: { id: t.id, tenantId: TENANT_ID, slug: slugOf(t.id), ...data } })
  }
  for (const s of subjects) {
    await prisma.subject.upsert({ where: { id: s.id }, update: { name: json(s.name), description: json(s.description), teacherId: s.teacherId }, create: { id: s.id, tenantId: TENANT_ID, teacherId: s.teacherId, name: json(s.name), description: json(s.description) } })
  }
  for (const c of courses) {
    const data = {
      title: json(c.title), categoryId: c.categoryId, centerId: c.centerId, teacherId: c.teacherId, subjectId: c.subjectId ?? null, summary: json(c.summary), description: json(c.description), curriculum: json(c.curriculum),
      level: up(c.level) as 'BEGINNER' | 'INTERMEDIATE' | 'ADVANCED', durationMonths: c.durationMonths, priceMinor: somToTiyin(c.price), coverSeed: c.coverSeed, imageUrl: c.imageUrl ?? null, meyosGrant: !!c.meyosGrant,
      status: up(c.status) as 'DRAFT' | 'PUBLISHED' | 'ARCHIVED', visibility: up(c.visibility) as 'PUBLIC' | 'PRIVATE', audienceStudentIds: c.audience.studentIds, audienceGroupIds: c.audience.groupIds, featured: c.featured, publishedAt: c.status === 'published' ? new Date(c.updatedAt) : null,
    }
    await prisma.course.upsert({ where: { id: c.id }, update: data, create: { id: c.id, tenantId: TENANT_ID, slug: slugOf(c.id), ...data } })
    for (const g of c.groups) {
      const gd = { courseId: c.id, name: g.name, days: g.days, startTime: g.start, endTime: g.end, room: g.room, capacity: g.capacity, timezone: TZ }
      await prisma.group.upsert({ where: { id: g.id }, update: gd, create: { id: g.id, tenantId: TENANT_ID, ...gd } })
    }
  }
  for (const v of videos) {
    const data = {
      teacherId: v.teacherId, courseId: v.courseId ?? null, title: json(v.title), description: json(v.description), sourceKind: (v.source.kind === 'upload' ? 'UPLOAD' : 'LINK') as 'UPLOAD' | 'LINK',
      sourceUrl: v.source.kind === 'link' ? v.source.url : null, durationSec: v.durationSec, thumbnailUrl: v.thumbnailUrl ?? null, coverSeed: v.coverSeed,
      status: up(v.status) as 'DRAFT' | 'PUBLISHED' | 'ARCHIVED', visibility: up(v.visibility) as 'PUBLIC' | 'PRIVATE', audienceStudentIds: v.audience.studentIds, audienceGroupIds: v.audience.groupIds, featured: v.featured,
    }
    await prisma.video.upsert({ where: { id: v.id }, update: data, create: { id: v.id, tenantId: TENANT_ID, ...data } })
  }
  for (const p of playlists) {
    const data = { teacherId: p.teacherId, title: json(p.title), description: json(p.description), coverSeed: p.coverSeed, status: up(p.status) as 'DRAFT' | 'PUBLISHED' | 'ARCHIVED', visibility: up(p.visibility) as 'PUBLIC' | 'PRIVATE', audienceStudentIds: p.audience.studentIds, audienceGroupIds: p.audience.groupIds, featured: p.featured }
    await prisma.playlist.upsert({ where: { id: p.id }, update: data, create: { id: p.id, tenantId: TENANT_ID, ...data } })
    await prisma.playlistItem.deleteMany({ where: { playlistId: p.id } })
    await prisma.playlistItem.createMany({ data: p.videoIds.map((videoId, position) => ({ playlistId: p.id, videoId, position })) })
  }
  for (const r of resources) {
    const data = {
      teacherId: r.teacherId, courseId: r.courseId ?? null, title: json(r.title), description: json(r.description), kind: up(r.kind) as 'PDF' | 'DOC' | 'SHEET' | 'LINK' | 'OTHER',
      fileName: r.file?.name ?? null, fileSize: r.file?.size ?? null, fileMime: r.file?.mime ?? null, url: r.url ?? null, pages: r.pages ?? null,
      status: up(r.status) as 'DRAFT' | 'PUBLISHED' | 'ARCHIVED', visibility: up(r.visibility) as 'PUBLIC' | 'PRIVATE', audienceStudentIds: r.audience.studentIds, audienceGroupIds: r.audience.groupIds, featured: r.featured,
    }
    await prisma.resource.upsert({ where: { id: r.id }, update: data, create: { id: r.id, tenantId: TENANT_ID, ...data } })
  }

  if (SEED_DEMO) await seedDemo()
  console.log(`Seed complete (${SEED_DEMO ? 'demo' : 'production'} mode)`)
}

/** Demo accounts use reserved-looking numbers (+998 90 000 00 xx) and only ever receive console SMS. */
async function seedDemo() {
  const { teachers, courses, students } = sampleData
  const now = new Date()
  const today = localDate(now, TZ)
  // Demo accounts get login + password only when SEED_DEMO_PASSWORD is set; there is no default password.
  const demoHash = process.env.SEED_DEMO_PASSWORD ? await argon2.hash(process.env.SEED_DEMO_PASSWORD, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 }) : null

  // Teacher logins: +998 91 000 00 0N
  for (const [i, t] of teachers.entries()) {
    const phoneE164 = `+9989100000${String(i + 1).padStart(2, '0')}`
    const user = await prisma.user.upsert({
      where: { tenantId_phoneE164: { tenantId: TENANT_ID, phoneE164 } },
      update: { displayName: t.name, login: t.id.replace(/^t-/, ''), ...(demoHash ? { passwordHash: demoHash } : {}) },
      create: { tenantId: TENANT_ID, phoneE164, login: t.id.replace(/^t-/, ''), passwordHash: demoHash, displayName: t.name, roles: ['TEACHER', 'STUDENT'], preferredLang: 'uz', phoneVerifiedAt: now },
    })
    await prisma.teacherProfile.update({ where: { id: t.id }, data: { userId: user.id } })
  }

  const groupById = new Map(courses.flatMap((c) => c.groups.map((g) => [g.id, { ...g, course: c }] as const)))

  // Students: +998 90 000 00 NN, subscriptions, enrollments
  for (const [i, s] of students.entries()) {
    const phoneE164 = `+9989000000${String(i + 1).padStart(2, '0')}`
    const user = await prisma.user.upsert({
      where: { id: s.id },
      update: { displayName: s.profile.displayName, district: s.profile.district, preferredLang: s.profile.preferredLang, reminders: s.profile.reminders, login: s.id.replace(/^s-/, ''), ...(demoHash ? { passwordHash: demoHash } : {}) },
      create: { id: s.id, tenantId: TENANT_ID, phoneE164, login: s.id.replace(/^s-/, ''), passwordHash: demoHash, displayName: s.profile.displayName, district: s.profile.district, preferredLang: s.profile.preferredLang, reminders: s.profile.reminders, roles: ['STUDENT'], phoneVerifiedAt: now },
    })
    for (const kind of s.savedCourseIds) await prisma.savedItem.upsert({ where: { userId_kind_itemId: { userId: user.id, kind: 'course', itemId: kind } }, update: {}, create: { tenantId: TENANT_ID, userId: user.id, kind: 'course', itemId: kind } })
    for (const tid of s.savedTeacherIds) await prisma.savedItem.upsert({ where: { userId_kind_itemId: { userId: user.id, kind: 'teacher', itemId: tid } }, update: {}, create: { tenantId: TENANT_ID, userId: user.id, kind: 'teacher', itemId: tid } })

    if (s.subscription.status !== 'active' || !s.subscription.packageId) continue
    const amount = s.subscription.groupIds.reduce((sum, gid) => sum + somToTiyin(groupById.get(gid)?.course.price ?? 0), 0n)
    const subId = `sub-${s.id}`
    const startedAt = new Date(`${s.subscription.startedAt}T09:00:00.000Z`)
    const periodEnd = new Date(`${s.subscription.renewsAt}T09:00:00.000Z`)
    await prisma.subscription.upsert({
      where: { id: subId },
      update: { status: 'ACTIVE', amountMinor: amount, currentPeriodStart: startedAt, currentPeriodEnd: periodEnd },
      create: { id: subId, tenantId: TENANT_ID, studentId: user.id, packageId: s.subscription.packageId, status: 'ACTIVE', draftGroupIds: s.subscription.groupIds, meyosGrant: !!s.subscription.funding?.meyosGrant, grantCourseIds: s.subscription.funding?.courseIds ?? [], amountMinor: amount, startedAt, currentPeriodStart: startedAt, currentPeriodEnd: periodEnd },
    })
    for (const gid of s.subscription.groupIds) {
      const g = groupById.get(gid)
      if (!g) continue
      await prisma.enrollment.upsert({ where: { subscriptionId_groupId: { subscriptionId: subId, groupId: gid } }, update: { status: 'ACTIVE' }, create: { tenantId: TENANT_ID, subscriptionId: subId, studentId: user.id, groupId: gid, courseId: g.course.id, status: 'ACTIVE', enrolledAt: startedAt } })
    }
    // A settled payment for the current period so finance screens have history (MANUAL provider, demo).
    const paymentId = `pay-${s.id}-1`
    await prisma.payment.upsert({
      where: { id: paymentId },
      update: {},
      create: { id: paymentId, tenantId: TENANT_ID, studentId: user.id, subscriptionId: subId, periodStart: startedAt, periodEnd, amountMinor: amount, state: 'PAID', provider: 'MANUAL', paidAt: startedAt, expiresAt: periodEnd },
    })
    await prisma.paymentTransaction.upsert({
      where: { provider_providerTransactionId: { provider: 'MANUAL', providerTransactionId: `demo:${paymentId}` } },
      update: {},
      create: { tenantId: TENANT_ID, paymentId, provider: 'MANUAL', providerTransactionId: `demo:${paymentId}`, state: 'PERFORMED', amountMinor: amount, performedAt: startedAt },
    })
    const journalKey = { tenantId: TENANT_ID, kind: 'PAYMENT_SETTLED' as const, referenceType: 'Payment', referenceId: paymentId }
    const journal = await prisma.ledgerJournal.findUnique({ where: { tenantId_kind_referenceType_referenceId: journalKey } })
    if (!journal) {
      await prisma.ledgerJournal.create({
        data: { ...journalKey, description: `Demo payment ${paymentId}`, entries: { create: [
          { tenantId: TENANT_ID, account: 'clearing:manual', accountType: 'PROVIDER_CLEARING', direction: 'DEBIT', amountMinor: amount },
          { tenantId: TENANT_ID, account: 'revenue:subscriptions', accountType: 'SUBSCRIPTION_REVENUE', direction: 'CREDIT', amountMinor: amount },
        ] } },
      })
    }
  }

  // Lesson sessions: two weeks back, four weeks ahead; sample attendance (~80%) for completed sessions.
  const from = addDays(today, -14)
  const [fy, fm, fd] = from.split('-').map(Number)
  let created = 0
  let attendance = 0
  for (const g of groupById.values()) {
    for (const date of scheduleDates(g.days, new Date(fy, fm - 1, fd), 42)) {
      const startsAt = zonedTimeToUtc(date, g.start, TZ)
      const endsAt = zonedTimeToUtc(date, g.end, TZ)
      const session = await prisma.lessonSession.upsert({
        where: { groupId_date: { groupId: g.id, date: isoToDateColumn(date) } },
        update: {},
        create: { tenantId: TENANT_ID, groupId: g.id, courseId: g.course.id, date: isoToDateColumn(date), startsAt, endsAt, status: endsAt < now ? 'COMPLETED' : 'SCHEDULED', generatedBy: 'seed' },
      })
      created++
      if (session.status !== 'COMPLETED') continue
      const enrolled = await prisma.enrollment.findMany({ where: { groupId: g.id, status: 'ACTIVE' }, select: { studentId: true } })
      for (const e of enrolled) {
        if (hash01(`${session.id}:${e.studentId}`) > 0.8) continue
        const at = new Date(startsAt.getTime() + Math.floor(hash01(`${e.studentId}:${session.id}`) * 12) * 60_000)
        await prisma.attendanceRecord.upsert({
          where: { sessionId_studentId: { sessionId: session.id, studentId: e.studentId } },
          update: {},
          create: { tenantId: TENANT_ID, sessionId: session.id, studentId: e.studentId, status: 'PRESENT', method: 'QR', checkedInAt: at, recordedById: e.studentId },
        })
        attendance++
      }
    }
  }
  console.log(`Demo data: ${students.length} students, ${teachers.length} teacher logins, ${created} sessions, ${attendance} attendance records`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
