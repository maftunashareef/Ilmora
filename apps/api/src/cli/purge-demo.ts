/**
 * Demo data purge. Removes the sample "(demo)" accounts, centers and everything that hangs off them before the real
 * launch. Runs on the server with database access, never through the API.
 *
 *   npm run demo:purge -- --tenant ilmora                                dry run (default): report only, nothing is written
 *   ALLOW_DATA_PURGE=1 npm run demo:purge -- --tenant ilmora --yes       execute
 *   node dist/cli/purge-demo.js --tenant ilmora [--yes]                   inside the migrator container
 *
 * What counts as demo: users and teacher profiles whose display name ends with "(demo)" and centers whose name ends
 * with "(demo)" (the seed's sample data), plus every row that depends on them: courses of demo centers or demo teachers,
 * their groups, lesson sessions and attendance, the demo students' subscriptions, enrollments, payments, transactions,
 * receipts and ledger journals, saved items, notifications, refresh sessions, one-time codes and SMS, outbox events and
 * the audit rows about those entities. Rows are never selected by id prefix: a real course may reuse a sample id such
 * as c-ielts. Soft-deleted demo rows are removed as well.
 *
 * Real rows that point at demo rows are never deleted: the link is cleared instead (staff or teacher profiles attached
 * to a demo center, videos or resources of real teachers attached to a demo course, attendance recorded by a demo
 * teacher, audit rows by a demo actor about a real entity) and each case is listed in the report.
 *
 * Options:
 *   --tenant <slug>   tenant to purge (default: DEFAULT_TENANT_SLUG or "ilmora"; must be given explicitly with --yes)
 *   --dry-run         default: print what would be deleted and exit 0 without writing
 *   --yes             delete, in one transaction; refused unless --tenant is given and ALLOW_DATA_PURGE=1 is set
 *
 * Exit codes: 0 = done (or nothing to purge), 1 = refused or failed (nothing was changed).
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { resolve } from 'node:path'
import type { Prisma } from '../generated/prisma/client'
import { PrismaClient } from '../generated/prisma/client'
import type { Role } from '../generated/prisma/enums'
import { tenantAndSoftDeleteExtension } from '../infra/prisma/prisma-extensions'
import { TenantContext } from '../infra/tenancy/tenant-context'

try {
  process.loadEnvFile?.(resolve(__dirname, '..', '..', '.env'))
} catch {
  /* environment comes from the process */
}

const DEMO_MARKER = '(demo)'
const BACKUP_COMMAND = 'sh /opt/ilmora/infra/uzcloud/compose.sh admin exec backup backup.sh --now'
const PRIVILEGED: Role[] = ['PLATFORM_ADMIN', 'FINANCE_ADMIN']
/** Ids per `IN (...)` list; keeps every statement far below PostgreSQL's parameter limit. */
const CHUNK = 1000
/** Notification params that name an entity (see the NotificationsService callers). */
const NOTIFICATION_REF_KEYS = ['centerId', 'courseId', 'groupId', 'sessionId', 'studentId', 'teacherId'] as const

function buildClient(url: string) {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) }).$extends(tenantAndSoftDeleteExtension)
}
type Db = ReturnType<typeof buildClient>
type Tx = Parameters<Parameters<Db['$transaction']>[0]>[0]
type Client = Db | Tx

/** Reads must see soft-deleted rows too; the extension hides them otherwise. (`const T` keeps `select: { id: true }` literal.) */
const all = <const T extends object>(args: T): T => ({ ...args, includeDeleted: true })
/** Deletes must be real deletes; the extension turns them into soft deletes (or refuses deleteMany) otherwise. */
const hard = <const T extends object>(args: T): T => ({ ...args, hardDelete: true })
const ids = (rows: { id: string }[]) => rows.map((r) => r.id)
const byName = <T extends { name: string }>(rows: T[]) => [...rows].sort((a, b) => a.name.localeCompare(b.name))
const chunks = <T>(xs: readonly T[]): T[][] => {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK))
  return out
}
const sum = async (lists: string[][], fn: (part: string[]) => Promise<number>) => {
  let n = 0
  for (const part of lists) n += await fn(part)
  return n
}

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next && !next.startsWith('--')) { out[key] = next; i++ } else out[key] = true
  }
  return out
}

interface DemoUser { id: string; displayName: string; login: string | null; phoneE164: string | null; roles: Role[]; isOwner: boolean; via: 'name' | 'teacher profile' }
interface Named { id: string; name: string; slug: string }

/** One table of the plan: how its rows are selected, how many there are, and what the run does with them. */
interface Step {
  table: string
  action: 'delete' | 'clear link'
  why: string
  count: (db: Client) => Promise<number>
  run: (tx: Tx) => Promise<number>
}

/** Real rows that point at demo rows; the link is cleared, the rows stay. */
interface CrossLink { what: string; rows: string[] }

interface Plan {
  centers: Named[]
  teachers: Named[]
  users: DemoUser[]
  steps: Step[]
  crossLinks: CrossLink[]
  /** Slots of university packages (SiteConfig.presets) that point at a demo course; left for the admin to re-map. */
  danglingPresetSlots: { presetId: string; courseId: string }[]
}

/** Finds every demo row of the current tenant and builds the ordered plan (children before parents). */
async function buildPlan(db: Client, tenantId: string): Promise<Plan> {
  const endsWithDemo = { endsWith: DEMO_MARKER }
  const userFields = { id: true, displayName: true, login: true, phoneE164: true, roles: true, isOwner: true } as const

  // 1. Roots: the "(demo)" marker on centers, users and teacher profiles.
  const centers = byName(await db.center.findMany(all({ where: { name: endsWithDemo }, select: { id: true, name: true, slug: true } })))
  const centerIds = ids(centers)
  const usersByName = await db.user.findMany(all({ where: { displayName: endsWithDemo }, select: userFields }))
  const teacherWhere: Prisma.TeacherProfileWhereInput = { OR: [{ name: endsWithDemo }, { userId: { in: ids(usersByName) } }] }
  const teachers = byName(await db.teacherProfile.findMany(all({ where: teacherWhere, select: { id: true, name: true, slug: true, userId: true } })))
  const teacherIds = ids(teachers)
  // A demo teacher whose login account was renamed is still demo: the account follows the profile.
  const linkedUserIds = teachers.map((t) => t.userId).filter((id): id is string => !!id && !usersByName.some((u) => u.id === id))
  const linkedUsers = linkedUserIds.length ? await db.user.findMany(all({ where: { id: { in: linkedUserIds } }, select: userFields })) : []
  const users: DemoUser[] = [...usersByName.map((u) => ({ ...u, via: 'name' as const })), ...linkedUsers.map((u) => ({ ...u, via: 'teacher profile' as const }))]
  const userIds = users.map((u) => u.id)
  const phones = users.map((u) => u.phoneE164).filter((p): p is string => !!p)
  const hasRoots = centerIds.length + teacherIds.length + userIds.length > 0

  // 2. Everything that hangs off the roots, by relation only.
  const courseWhere: Prisma.CourseWhereInput = { OR: [{ centerId: { in: centerIds } }, { teacherId: { in: teacherIds } }] }
  const courseIds = ids(await db.course.findMany(all({ where: courseWhere, select: { id: true } })))
  const subjectIds = ids(await db.subject.findMany(all({ where: { teacherId: { in: teacherIds } }, select: { id: true } })))
  const groupIds = ids(await db.group.findMany(all({ where: { courseId: { in: courseIds } }, select: { id: true } })))
  const sessionWhere: Prisma.LessonSessionWhereInput = { OR: [{ groupId: { in: groupIds } }, { courseId: { in: courseIds } }] }
  const sessionIds = ids(await db.lessonSession.findMany({ where: sessionWhere, select: { id: true } }))
  const attendanceWhere: Prisma.AttendanceRecordWhereInput = { OR: [{ studentId: { in: userIds } }, { session: sessionWhere }] }
  const attendanceIds = ids(await db.attendanceRecord.findMany({ where: attendanceWhere, select: { id: true } }))
  const subscriptionIds = ids(await db.subscription.findMany({ where: { studentId: { in: userIds } }, select: { id: true } }))
  const enrollmentWhere: Prisma.EnrollmentWhereInput = { OR: [{ studentId: { in: userIds } }, { subscriptionId: { in: subscriptionIds } }, { groupId: { in: groupIds } }, { courseId: { in: courseIds } }] }
  const paymentIds = ids(await db.payment.findMany({ where: { OR: [{ studentId: { in: userIds } }, { subscriptionId: { in: subscriptionIds } }] }, select: { id: true } }))
  // Journals of demo payments, and the reversal journals that point at them (a reversal of a reversal does not exist, but the loop costs nothing).
  const journalIds = ids(await db.ledgerJournal.findMany({ where: { referenceType: 'Payment', referenceId: { in: paymentIds } }, select: { id: true } }))
  for (let before = -1; before !== journalIds.length;) {
    before = journalIds.length
    journalIds.push(...ids(await db.ledgerJournal.findMany({ where: { reversalOfId: { in: journalIds }, id: { notIn: journalIds } }, select: { id: true } })))
  }
  const videoIds = ids(await db.video.findMany(all({ where: { teacherId: { in: teacherIds } }, select: { id: true } })))
  const playlistIds = ids(await db.playlist.findMany(all({ where: { teacherId: { in: teacherIds } }, select: { id: true } })))
  const resourceIds = ids(await db.resource.findMany(all({ where: { teacherId: { in: teacherIds } }, select: { id: true } })))
  const outboxKeys = paymentIds.flatMap((id) => [`receipt:${id}`, `refund:${id}`])
  const savedWhere: Prisma.SavedItemWhereInput = { OR: [{ userId: { in: userIds } }, { kind: 'course', itemId: { in: courseIds } }, { kind: 'teacher', itemId: { in: teacherIds } }] }
  const playlistItemWhere: Prisma.PlaylistItemWhereInput = { OR: [{ playlistId: { in: playlistIds } }, { videoId: { in: videoIds } }] }

  // Notifications sent to real users about demo rows (params name the entity), e.g. "center X (demo) registered" to the owner.
  const refSets: Record<(typeof NOTIFICATION_REF_KEYS)[number], Set<string>> = {
    centerId: new Set(centerIds), courseId: new Set(courseIds), groupId: new Set(groupIds), sessionId: new Set(sessionIds), studentId: new Set(userIds), teacherId: new Set(teacherIds),
  }
  const otherNotifications = hasRoots ? await db.notification.findMany({ where: { userId: { notIn: userIds } }, select: { id: true, params: true } }) : []
  const notificationIds = otherNotifications
    .filter((n) => n.params && typeof n.params === 'object' && !Array.isArray(n.params) && NOTIFICATION_REF_KEYS.some((k) => { const v = (n.params as Record<string, unknown>)[k]; return typeof v === 'string' && refSets[k].has(v) }))
    .map((n) => n.id)

  // Audit rows whose entity is a demo row (any actor): the entity disappears, so does its history.
  const auditEntityChunks = chunks([...userIds, ...centerIds, ...teacherIds, ...courseIds, ...groupIds, ...sessionIds, ...attendanceIds, ...subscriptionIds, ...paymentIds])

  // 3. Real rows that point at demo rows: cleared, not deleted, and listed.
  const staffWhere: Prisma.UserWhereInput = { centerId: { in: centerIds }, id: { notIn: userIds } }
  const staff = await db.user.findMany(all({ where: staffWhere, select: { id: true, login: true, displayName: true } }))
  const profileWhere: Prisma.TeacherProfileWhereInput = { centerId: { in: centerIds }, id: { notIn: teacherIds } }
  const profiles = await db.teacherProfile.findMany(all({ where: profileWhere, select: { id: true, name: true, slug: true } }))
  const videoLinkWhere: Prisma.VideoWhereInput = { courseId: { in: courseIds }, id: { notIn: videoIds } }
  const resourceLinkWhere: Prisma.ResourceWhereInput = { courseId: { in: courseIds }, id: { notIn: resourceIds } }
  const linkedVideos = await db.video.count(all({ where: videoLinkWhere }))
  const linkedResources = await db.resource.count(all({ where: resourceLinkWhere }))
  const recordedWhere: Prisma.AttendanceRecordWhereInput = { recordedById: { in: userIds }, studentId: { notIn: userIds }, session: { groupId: { notIn: groupIds }, courseId: { notIn: courseIds } } }
  const recordedByDemo = await db.attendanceRecord.count({ where: recordedWhere })
  const byDemoActor = await db.auditEvent.count({ where: { actorId: { in: userIds } } })
  const byDemoActorOnDemo = await sum(auditEntityChunks, (part) => db.auditEvent.count({ where: { actorId: { in: userIds }, entityId: { in: part } } }))
  const actorOnlyAudit = byDemoActor - byDemoActorOnDemo

  const crossLinks: CrossLink[] = []
  if (staff.length) crossLinks.push({ what: 'accounts attached to a demo center (centerId cleared, account kept)', rows: staff.map((u) => `${u.displayName} (${u.login ?? u.id})`) })
  if (profiles.length) crossLinks.push({ what: 'teacher profiles attached to a demo center (centerId cleared, profile kept)', rows: profiles.map((p) => `${p.name} (${p.slug})`) })
  if (linkedVideos) crossLinks.push({ what: 'videos of real teachers attached to a demo course (courseId cleared)', rows: [`${linkedVideos} video(s)`] })
  if (linkedResources) crossLinks.push({ what: 'resources of real teachers attached to a demo course (courseId cleared)', rows: [`${linkedResources} resource(s)`] })
  if (recordedByDemo) crossLinks.push({ what: 'attendance of real students in real lessons recorded by a demo teacher (recordedById cleared)', rows: [`${recordedByDemo} record(s)`] })
  if (actorOnlyAudit) crossLinks.push({ what: 'audit rows by a demo actor about a real entity (actor cleared, row kept)', rows: [`${actorOnlyAudit} audit row(s)`] })

  // 4. University packages in the site configuration that still point at a demo course (reported, not edited).
  const config = hasRoots ? await db.siteConfig.findUnique({ where: { tenantId }, select: { data: true } }) : null
  const demoCourses = new Set(courseIds)
  const presets = (config?.data && typeof config.data === 'object' && !Array.isArray(config.data) ? (config.data as { presets?: unknown }).presets : null) ?? []
  const danglingPresetSlots = (Array.isArray(presets) ? presets : []).flatMap((p: { id?: unknown; slots?: unknown }) =>
    (Array.isArray(p.slots) ? p.slots : []).flatMap((s: { courseId?: unknown }) => (typeof s.courseId === 'string' && demoCourses.has(s.courseId) ? [{ presetId: String(p.id ?? '?'), courseId: s.courseId }] : [])))

  // 5. The plan, children before parents (foreign keys are RESTRICT unless schema.prisma says otherwise).
  const step = (table: string, why: string, count: Step['count'], run: Step['run'], action: Step['action'] = 'delete'): Step => ({ table, action, why, count, run })
  const steps: Step[] = [
    step('User.centerId', 'real staff of demo centers', (c) => c.user.count(all({ where: staffWhere })), async (tx) => (await tx.user.updateMany(all({ where: staffWhere, data: { centerId: null } }))).count, 'clear link'),
    step('TeacherProfile.centerId', 'real profiles in demo centers', (c) => c.teacherProfile.count(all({ where: profileWhere })), async (tx) => (await tx.teacherProfile.updateMany(all({ where: profileWhere, data: { centerId: null } }))).count, 'clear link'),
    step('Video.courseId', 'real videos on demo courses', (c) => c.video.count(all({ where: videoLinkWhere })), async (tx) => (await tx.video.updateMany(all({ where: videoLinkWhere, data: { courseId: null } }))).count, 'clear link'),
    step('Resource.courseId', 'real resources on demo courses', (c) => c.resource.count(all({ where: resourceLinkWhere })), async (tx) => (await tx.resource.updateMany(all({ where: resourceLinkWhere, data: { courseId: null } }))).count, 'clear link'),
    step('AttendanceRecord.recordedById', 'real records by demo teachers', (c) => c.attendanceRecord.count({ where: recordedWhere }), async (tx) => (await tx.attendanceRecord.updateMany({ where: recordedWhere, data: { recordedById: null } })).count, 'clear link'),
    step('AuditEvent', 'entity is a demo row', (c) => sum(auditEntityChunks, (part) => c.auditEvent.count({ where: { entityId: { in: part } } })), (tx) => sum(auditEntityChunks, async (part) => (await tx.auditEvent.deleteMany({ where: { entityId: { in: part } } })).count)),
    step('AuditEvent.actorId', 'demo actor, real entity', () => Promise.resolve(actorOnlyAudit), async (tx) => (await tx.auditEvent.updateMany({ where: { actorId: { in: userIds } }, data: { actorId: null } })).count, 'clear link'),
    step('Notification', 'to demo users', (c) => c.notification.count({ where: { userId: { in: userIds } } }), async (tx) => (await tx.notification.deleteMany({ where: { userId: { in: userIds } } })).count),
    step('Notification', 'to real users, about demo rows', () => Promise.resolve(notificationIds.length), (tx) => sum(chunks(notificationIds), async (part) => (await tx.notification.deleteMany({ where: { id: { in: part } } })).count)),
    step('RefreshSession', 'of demo users', (c) => c.refreshSession.count({ where: { userId: { in: userIds } } }), async (tx) => (await tx.refreshSession.deleteMany({ where: { userId: { in: userIds } } })).count),
    step('SavedItem', 'of demo users, or a saved demo course/teacher', (c) => c.savedItem.count({ where: savedWhere }), async (tx) => (await tx.savedItem.deleteMany({ where: savedWhere })).count),
    step('OtpCode', 'demo phone numbers', (c) => c.otpCode.count({ where: { phoneE164: { in: phones } } }), async (tx) => (await tx.otpCode.deleteMany({ where: { phoneE164: { in: phones } } })).count),
    step('SmsMessage', 'demo phone numbers', (c) => c.smsMessage.count({ where: { phoneE164: { in: phones } } }), async (tx) => (await tx.smsMessage.deleteMany({ where: { phoneE164: { in: phones } } })).count),
    step('OutboxEvent', 'receipts/refunds of demo payments', (c) => c.outboxEvent.count({ where: { tenantId, dedupeKey: { in: outboxKeys } } }), async (tx) => (await tx.outboxEvent.deleteMany({ where: { tenantId, dedupeKey: { in: outboxKeys } } })).count),
    step('ProviderCallbackLog', 'of demo payments', (c) => c.providerCallbackLog.count({ where: { paymentId: { in: paymentIds } } }), async (tx) => (await tx.providerCallbackLog.deleteMany({ where: { paymentId: { in: paymentIds } } })).count),
    step('LedgerEntry', 'of demo payment journals', (c) => c.ledgerEntry.count({ where: { journalId: { in: journalIds } } }), async (tx) => (await tx.ledgerEntry.deleteMany({ where: { journalId: { in: journalIds } } })).count),
    step('LedgerJournal', 'of demo payments (+ reversals)', (c) => c.ledgerJournal.count({ where: { id: { in: journalIds } } }), async (tx) => (await tx.ledgerJournal.deleteMany({ where: { id: { in: journalIds } } })).count),
    step('Receipt', 'of demo payments', (c) => c.receipt.count({ where: { paymentId: { in: paymentIds } } }), async (tx) => (await tx.receipt.deleteMany({ where: { paymentId: { in: paymentIds } } })).count),
    step('PaymentTransaction', 'of demo payments', (c) => c.paymentTransaction.count({ where: { paymentId: { in: paymentIds } } }), async (tx) => (await tx.paymentTransaction.deleteMany({ where: { paymentId: { in: paymentIds } } })).count),
    step('Payment', 'of demo students/subscriptions', (c) => c.payment.count({ where: { id: { in: paymentIds } } }), async (tx) => (await tx.payment.deleteMany({ where: { id: { in: paymentIds } } })).count),
    step('AttendanceRecord', 'demo students or demo lessons', (c) => c.attendanceRecord.count({ where: attendanceWhere }), async (tx) => (await tx.attendanceRecord.deleteMany({ where: attendanceWhere })).count),
    step('LessonSession', 'of demo groups/courses', (c) => c.lessonSession.count({ where: sessionWhere }), async (tx) => (await tx.lessonSession.deleteMany({ where: sessionWhere })).count),
    step('Enrollment', 'demo students or demo groups', (c) => c.enrollment.count({ where: enrollmentWhere }), async (tx) => (await tx.enrollment.deleteMany({ where: enrollmentWhere })).count),
    step('Subscription', 'of demo students', (c) => c.subscription.count({ where: { id: { in: subscriptionIds } } }), async (tx) => (await tx.subscription.deleteMany({ where: { id: { in: subscriptionIds } } })).count),
    step('PlaylistItem', 'of demo playlists/videos', (c) => c.playlistItem.count({ where: playlistItemWhere }), async (tx) => (await tx.playlistItem.deleteMany({ where: playlistItemWhere })).count),
    step('Playlist', 'of demo teachers', (c) => c.playlist.count(all({ where: { id: { in: playlistIds } } })), async (tx) => (await tx.playlist.deleteMany(hard({ where: { id: { in: playlistIds } } }))).count),
    step('Video', 'of demo teachers', (c) => c.video.count(all({ where: { id: { in: videoIds } } })), async (tx) => (await tx.video.deleteMany(hard({ where: { id: { in: videoIds } } }))).count),
    step('Resource', 'of demo teachers', (c) => c.resource.count(all({ where: { id: { in: resourceIds } } })), async (tx) => (await tx.resource.deleteMany(hard({ where: { id: { in: resourceIds } } }))).count),
    step('Group', 'of demo courses', (c) => c.group.count(all({ where: { id: { in: groupIds } } })), async (tx) => (await tx.group.deleteMany(hard({ where: { id: { in: groupIds } } }))).count),
    step('Course', 'of demo centers or demo teachers', (c) => c.course.count(all({ where: { id: { in: courseIds } } })), async (tx) => (await tx.course.deleteMany(hard({ where: { id: { in: courseIds } } }))).count),
    step('Subject', 'of demo teachers', (c) => c.subject.count(all({ where: { id: { in: subjectIds } } })), async (tx) => (await tx.subject.deleteMany(hard({ where: { id: { in: subjectIds } } }))).count),
    step('TeacherProfile', `name ends with "${DEMO_MARKER}", or its login does`, (c) => c.teacherProfile.count(all({ where: { id: { in: teacherIds } } })), async (tx) => (await tx.teacherProfile.deleteMany(hard({ where: { id: { in: teacherIds } } }))).count),
    step('User', `display name ends with "${DEMO_MARKER}", or demo teacher login`, (c) => c.user.count(all({ where: { id: { in: userIds } } })), async (tx) => (await tx.user.deleteMany(hard({ where: { id: { in: userIds } } }))).count),
    step('Center', `name ends with "${DEMO_MARKER}"`, (c) => c.center.count(all({ where: { id: { in: centerIds } } })), async (tx) => (await tx.center.deleteMany(hard({ where: { id: { in: centerIds } } }))).count),
  ]

  return { centers, teachers: teachers.map(({ id, name, slug }) => ({ id, name, slug })), users, steps, crossLinks, danglingPresetSlots }
}

function printTable(rows: { table: string; action: string; rows: number; why: string }[]) {
  const w = [Math.max(5, ...rows.map((r) => r.table.length)), Math.max(6, ...rows.map((r) => r.action.length)), Math.max(4, ...rows.map((r) => String(r.rows).length))]
  const line = (a: string, b: string, c: string, d: string) => `  ${a.padEnd(w[0])}  ${b.padEnd(w[1])}  ${c.padStart(w[2])}  ${d}`
  console.log(line('Table', 'Action', 'Rows', 'Selected by'))
  console.log(line('-'.repeat(w[0]), '-'.repeat(w[1]), '-'.repeat(w[2]), '-----------'))
  for (const r of rows) console.log(line(r.table, r.action, String(r.rows), r.why))
}

/** Host, port and database of the connection, without credentials. */
function describe(url: string) {
  try {
    const u = new URL(url)
    return `${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`
  } catch {
    return '(unparseable DATABASE_URL)'
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const execute = args.yes === true
  if (execute && args['dry-run']) throw new Error('Use either --dry-run or --yes, not both')
  if (execute && typeof args.tenant !== 'string') throw new Error('--yes requires an explicit --tenant <slug>')
  if (execute && process.env.ALLOW_DATA_PURGE !== '1') throw new Error('Refusing to delete: set ALLOW_DATA_PURGE=1 in the environment of this command to confirm (and back up the database first)')
  const slug = typeof args.tenant === 'string' ? args.tenant : process.env.DEFAULT_TENANT_SLUG ?? 'ilmora'
  const url = process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is required')

  const db = buildClient(url)
  try {
    const tenant = await db.tenant.findUnique(all({ where: { slug }, select: { id: true, slug: true } }))
    if (!tenant) throw new Error(`Tenant "${slug}" does not exist`)
    console.log(`${execute ? 'PURGE' : 'DRY RUN'}: demo data of tenant "${tenant.slug}" (${tenant.id}) in ${describe(url)}`)
    console.log(`!! Back up the database before deleting anything (on ilmora-admin): ${BACKUP_COMMAND}`)
    console.log('')

    // Every query below is scoped to this tenant by the Prisma extension (system context with the tenant set).
    await TenantContext.run({ tenantId: tenant.id, system: true }, async () => {
      const plan = await buildPlan(db, tenant.id)
      const counts: { table: string; action: string; rows: number; why: string }[] = []
      for (const s of plan.steps) counts.push({ table: s.table, action: s.action, rows: await s.count(db), why: s.why })
      const total = counts.reduce((n, r) => n + r.rows, 0)

      if (total === 0) {
        console.log(`Nothing to purge: no "${DEMO_MARKER}" centers, users or teacher profiles and nothing attached to them.`)
        return
      }

      printTable(counts)
      console.log('')
      console.log(`Centers (${plan.centers.length}):`)
      for (const c of plan.centers) console.log(`  - ${c.name}  [${c.slug}, ${c.id}]`)
      console.log(`Teacher profiles (${plan.teachers.length}):`)
      for (const t of plan.teachers) console.log(`  - ${t.name}  [${t.slug}, ${t.id}]`)
      console.log(`Users (${plan.users.length}):`)
      for (const u of plan.users) console.log(`  - ${u.displayName}  login=${u.login ?? '—'} roles=${u.roles.join(',')}${u.via === 'teacher profile' ? '  (login of a demo teacher profile)' : ''}`)
      for (const link of plan.crossLinks) {
        console.log('')
        console.log(`!! Real rows pointing at demo rows — ${link.what}:`)
        for (const r of link.rows) console.log(`  - ${r}`)
      }
      if (plan.danglingPresetSlots.length) {
        const presets = [...new Set(plan.danglingPresetSlots.map((s) => s.presetId))]
        console.log('')
        console.log(`!! Site configuration: ${plan.danglingPresetSlots.length} university package slot(s) in ${presets.length} preset(s) point at demo courses (${presets.slice(0, 8).join(', ')}${presets.length > 8 ? ', …' : ''}).`)
        console.log('   Those packages stay hidden on the site until an admin maps the slots to real courses (Super Admin → universities) or re-runs `npm run db:seed:universities -- --refresh` once the real catalog exists. The configuration itself is not changed.')
      }

      // Never delete an owner or a privileged account, whatever its name says.
      const protectedUsers = plan.users.filter((u) => u.isOwner || u.roles.some((r) => PRIVILEGED.includes(r)))
      if (protectedUsers.length) throw new Error(`Refusing: ${protectedUsers.length} account(s) selected as demo are owners or carry platform roles: ${protectedUsers.map((u) => u.login ?? u.id).join(', ')}. Rename or demote them first (owner-setup --remove / --demote-others).`)

      console.log('')
      if (!execute) {
        console.log(`Dry run: ${total} row(s) would be affected; nothing was written. Re-run with --tenant ${tenant.slug} --yes and ALLOW_DATA_PURGE=1 to delete.`)
        return
      }

      console.log(`Deleting ${total} row(s) in one transaction…`)
      const affected = await db.$transaction(async (tx) => {
        const done: Record<string, number> = {}
        for (const s of plan.steps) {
          const n = await s.run(tx)
          if (!n) continue
          const key = s.action === 'clear link' ? `${s.table} (cleared)` : s.table
          done[key] = (done[key] ?? 0) + n
        }
        await tx.auditEvent.create({
          data: {
            tenantId: tenant.id, actorId: null, actorRoles: [], action: 'demo.purge', entityType: 'Tenant', entityId: tenant.id,
            before: { centers: plan.centers.map((c) => c.id), teacherProfiles: plan.teachers.map((t) => t.id), users: plan.users.map((u) => u.id) },
            after: { affected: done }, reason: 'purge-demo command',
          },
        })
        return done
      }, { timeout: 600_000, maxWait: 30_000 })
      for (const [table, n] of Object.entries(affected)) console.log(`  ${table}: ${n}`)

      // Verify after commit: a second plan must be empty.
      const left = await buildPlan(db, tenant.id)
      let remaining = 0
      for (const s of left.steps) remaining += await s.count(db)
      if (remaining) throw new Error(`Purge finished but ${remaining} demo row(s) still match; inspect the database before re-running`)
      console.log('')
      console.log(`Done: demo data of tenant "${tenant.slug}" removed; a second run finds nothing. Audit row "demo.purge" written.`)
    })
  } finally {
    await db.$disconnect()
  }
}

main().catch((err: Error) => {
  console.error(err.message)
  process.exit(1)
})
