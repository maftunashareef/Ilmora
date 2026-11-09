import { Inject, Injectable, Logger } from '@nestjs/common'
import { dueReminder, finalPriceMinor, MAX_CART_COURSES, nextLifecycleStep, overlaps, subscriptionAccess, type SubscriptionAccess } from '@ilmora/shared'
import { AppError } from '../../common/errors'
import { addMonthsUtc } from '../../common/time'
import { ENV, type Env } from '../../config/env'
import type { PaymentProvider, SubscriptionStatus } from '../../generated/prisma/enums'
import { PrismaService, type TransactionClient } from '../../infra/prisma/prisma.service'
import { TenantContext } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import { discountWindow, toGroup } from '../catalog/catalog.service'
import { NotificationsService } from '../notifications/notifications.service'

export interface DraftInput { packageId: string | null; groupIds: string[]; meyosGrant: boolean }

type GroupRow = { id: string; courseId: string; name: string; days: number[]; startTime: string; endTime: string; room: string; capacity: number; course: { id: string; center: { status: string }; priceMinor: bigint; discountPercent: number | null; discountStartsAt: Date | null; discountEndsAt: Date | null; meyosGrant: boolean; status: string } }
type Db = TransactionClient | PrismaService['client']
type PackageAccess = { accessKind: 'PERIOD' | 'LESSONS'; periodDays: number | null; lessonCount: number | null } | null

const DAY_MS = 86_400_000

/** A cancelled or expired subscription never comes back: a late settlement is refused (and refunded) rather than applied. */
export const isClosed = (status: SubscriptionStatus): boolean => status === 'CANCELLED' || status === 'EXPIRED'

/**
 * Subscription lifecycle: draft (builder) → checkout (seat holds + pending payment) → active (on settlement) →
 * blocked (PAST_DUE: period ended or lessons used up; seats held for a grace period) → expired (seats released).
 * A settled payment reactivates instantly. Capacity is enforced inside a transaction that locks the group rows,
 * so two students cannot take the last seat.
 */
@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name)

  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly notifications: NotificationsService, @Inject(ENV) private readonly env: Env) {}

  async overview(tenantId: string, studentId: string) {
    const [draft, active, payments] = await Promise.all([
      this.prisma.client.subscription.findFirst({ where: { tenantId, studentId, status: 'DRAFT' }, orderBy: { updatedAt: 'desc' } }),
      this.prisma.client.subscription.findFirst({
        where: { tenantId, studentId, status: { in: ['PENDING_PAYMENT', 'ACTIVE', 'PAST_DUE'] } },
        orderBy: { updatedAt: 'desc' },
        include: { enrollments: { where: { status: { in: ['PENDING', 'ACTIVE'] } }, include: { group: true } }, package: true },
      }),
      this.prisma.client.payment.findMany({ where: { tenantId, studentId }, orderBy: { createdAt: 'desc' }, take: 12, include: { transactions: { orderBy: { createdAt: 'desc' }, take: 1 } } }),
    ])
    const access = active ? subscriptionAccess(active) : null
    return {
      builder: draft ? { packageId: draft.packageId, groupIds: draft.draftGroupIds, meyosGrant: draft.meyosGrant } : { packageId: null, groupIds: [], meyosGrant: false },
      subscription: active
        ? {
            id: active.id,
            packageId: active.packageId,
            status: active.status,
            groupIds: active.enrollments.map((e) => e.groupId),
            enrollments: active.enrollments.map((e) => ({ id: e.id, status: e.status, group: toGroup(e.group), courseId: e.courseId, enrolledAt: e.enrolledAt })),
            startedAt: active.startedAt,
            currentPeriodStart: active.currentPeriodStart,
            currentPeriodEnd: active.currentPeriodEnd,
            amountMinor: active.amountMinor.toString(),
            currency: active.currency,
            funding: { meyosGrant: active.meyosGrant, courseIds: active.grantCourseIds },
            kind: active.kind,
            lessonsTotal: active.lessonsTotal,
            lessonsUsed: active.lessonsUsed,
            blocked: access?.blocked ?? false,
            blockReason: access?.reason ?? null,
            blockedAt: active.blockedAt,
            graceEndsAt: active.graceEndsAt,
            remainingDays: access?.remainingDays ?? null,
            remainingLessons: access?.remainingLessons ?? null,
          }
        : null,
      payments: payments.map((p) => ({
        id: p.id, state: p.state, provider: p.provider, amountMinor: p.amountMinor.toString(), currency: p.currency, periodStart: p.periodStart, periodEnd: p.periodEnd,
        paidAt: p.paidAt, expiresAt: p.expiresAt, createdAt: p.createdAt, lastTransaction: p.transactions[0] ? { provider: p.transactions[0].provider, state: p.transactions[0].state, providerTransactionId: p.transactions[0].providerTransactionId } : null,
      })),
    }
  }

  /** Validates and stores the builder selection. Throws with the same reason codes the web builder shows. */
  async saveDraft(tenantId: string, studentId: string, input: DraftInput) {
    const groupIds = [...new Set(input.groupIds)]
    // One validation path for both modes: a package enforces its own size, a custom selection (no package) the cart limit.
    await this.validateSelection(tenantId, input.packageId, groupIds, studentId)
    const grantCourses = input.meyosGrant ? await this.grantCourseIds(tenantId, groupIds) : []
    const existing = await this.prisma.client.subscription.findFirst({ where: { tenantId, studentId, status: 'DRAFT' } })
    const data = { packageId: input.packageId, draftGroupIds: groupIds, meyosGrant: input.meyosGrant && grantCourses.length > 0, grantCourseIds: grantCourses }
    const row = existing
      ? await this.prisma.client.subscription.update({ where: { id: existing.id }, data })
      : await this.prisma.client.subscription.create({ data: { tenantId, studentId, status: 'DRAFT', ...data } })
    return { packageId: row.packageId, groupIds: row.draftGroupIds, meyosGrant: row.meyosGrant }
  }

  /**
   * Rules shared with the client: with a package, it exists, is enabled and allows at most maxCourses courses; without
   * one (custom selection) at most MAX_CART_COURSES. Always: published courses, one group per course, no overlapping
   * schedules, every group has a free seat (the student's own current seat does not count against them).
   */
  async validateSelection(tenantId: string, packageId: string | null, groupIds: string[], studentId?: string, tx?: TransactionClient): Promise<GroupRow[]> {
    const db = tx ?? this.prisma.client
    const pkg = packageId ? await db.package.findFirst({ where: { tenantId, id: packageId } }) : null
    if (packageId) {
      if (!pkg) throw AppError.invalid('no-package', 'Choose a package first')
      if (!pkg.enabled) throw AppError.invalid('disabled', 'This package is not available')
    }
    if (groupIds.length === 0) return []
    const groups = (await db.group.findMany({ where: { tenantId, id: { in: groupIds }, deletedAt: null }, include: { course: { select: { id: true, center: { select: { status: true } }, priceMinor: true, discountPercent: true, discountStartsAt: true, discountEndsAt: true, meyosGrant: true, status: true } } } })) as GroupRow[]
    if (groups.length !== groupIds.length) throw AppError.notFound('Group')
    if (groups.some((g) => g.course.status !== 'PUBLISHED')) throw AppError.invalid('disabled', 'One of the courses is not open for enrollment')
    if (groups.some((g) => g.course.center.status !== 'ACTIVE')) throw AppError.invalid('disabled', 'One of the courses belongs to a center that is not approved')
    const courses = new Set(groups.map((g) => g.courseId))
    if (courses.size !== groups.length) throw AppError.invalid('duplicate', 'A course can be selected only once')
    const max = pkg?.maxCourses ?? MAX_CART_COURSES
    if (groups.length > max) throw AppError.invalid('limit', pkg ? `This package allows ${max} courses` : `A selection can include at most ${max} courses`)
    for (let i = 0; i < groups.length; i++)
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i], b = groups[j]
        if (overlaps({ ...a, start: a.startTime, end: a.endTime }, { ...b, start: b.startTime, end: b.endTime }))
          throw AppError.invalid('conflict', 'Two selected groups overlap in the weekly schedule', { conflictWith: b.courseId, groupIds: [a.id, b.id] })
      }
    const taken = await db.enrollment.groupBy({ by: ['groupId'], where: { tenantId, groupId: { in: groupIds }, status: { in: ['PENDING', 'ACTIVE'] }, ...(studentId ? { NOT: { studentId } } : {}) }, _count: { _all: true } })
    const counts = new Map(taken.map((t) => [t.groupId, t._count._all]))
    const full = groups.find((g) => (counts.get(g.id) ?? 0) >= g.capacity)
    if (full) throw AppError.invalid('full', 'This group is full', { groupId: full.id })
    return groups
  }

  /** End of a paid period: the package's periodDays, or one calendar month (custom selections and packages without periodDays). */
  private periodEnd(start: Date, pkg: PackageAccess): Date {
    return pkg?.periodDays ? new Date(start.getTime() + pkg.periodDays * DAY_MS) : addMonthsUtc(start, 1)
  }

  /** Access columns copied from the package when a subscription is created or renewed. */
  private accessColumns(pkg: PackageAccess) {
    const kind = pkg?.accessKind ?? 'PERIOD'
    return { kind, lessonsTotal: kind === 'LESSONS' ? (pkg?.lessonCount ?? 0) : null, lessonsUsed: 0 }
  }

  /**
   * Checkout: turns the draft into a PENDING_PAYMENT subscription with seat holds and creates the payment
   * the provider adapters will settle. Group rows are locked so capacity is re-checked atomically.
   */
  async checkout(tenantId: string, studentId: string, provider: PaymentProvider) {
    const draft = await this.prisma.client.subscription.findFirst({ where: { tenantId, studentId, status: 'DRAFT' } })
    if (!draft) throw AppError.invalid('incomplete', 'Choose a package and your courses first')
    const pkg = draft.packageId ? await this.prisma.client.package.findFirst({ where: { tenantId, id: draft.packageId } }) : null
    if (draft.packageId) {
      // Duo/Trio style package: the number of courses must match the package exactly.
      if (!pkg || draft.draftGroupIds.length !== pkg.maxCourses) throw AppError.invalid('incomplete', `Select ${pkg?.maxCourses ?? ''} courses to continue`)
    } else if (draft.draftGroupIds.length === 0) {
      // Custom selection: any number of courses from one up to the cart limit, validated below.
      throw AppError.invalid('incomplete', 'Select at least one course to continue')
    }
    const open = await this.prisma.client.subscription.findFirst({ where: { tenantId, studentId, status: { in: ['PENDING_PAYMENT', 'ACTIVE', 'PAST_DUE'] } } })
    if (open && open.status !== 'PENDING_PAYMENT') throw AppError.conflict('subscription_exists', 'You already have an active or pending subscription')

    const now = new Date()
    const periodEnd = this.periodEnd(now, pkg)
    const expiresAt = new Date(now.getTime() + this.env.PAYMENT_EXPIRES_HOURS * 3_600_000)
    const result = await this.prisma.tx(async (tx) => {
      // An earlier checkout whose payment failed, was cancelled by the bank or was simply abandoned gives way to this one
      // instead of blocking the student until its hold expires; a settlement that landed meanwhile wins.
      if (open && !(await this.cancelIn(tx, open.id, ['PENDING_PAYMENT'], 'checkout_retry', now))) {
        throw AppError.conflict('subscription_exists', 'You already have an active or pending subscription')
      }
      // Row locks serialize concurrent checkouts touching the same groups.
      await tx.$queryRawUnsafe(`SELECT id FROM "Group" WHERE id = ANY($1::text[]) AND "tenantId" = $2 FOR UPDATE`, draft.draftGroupIds, tenantId)
      const groups = await this.validateSelection(tenantId, draft.packageId, draft.draftGroupIds, studentId, tx)
      // Each course is charged its list price minus the discount active right now (none stacks with anything else); the server
      // decides the amount, the browser only displays it. The amount stays fixed for this payment's hold.
      const listMinor = groups.reduce((sum, g) => sum + g.course.priceMinor, 0n)
      const amountMinor = groups.reduce((sum, g) => sum + finalPriceMinor(g.course.priceMinor, discountWindow(g.course), now), 0n)
      const sub = await tx.subscription.update({
        where: { id: draft.id },
        data: { status: 'PENDING_PAYMENT', amountMinor, currency: 'UZS', currentPeriodStart: now, currentPeriodEnd: periodEnd, ...this.accessColumns(pkg) },
      })
      await tx.enrollment.createMany({
        data: groups.map((g) => ({ tenantId, subscriptionId: sub.id, studentId, groupId: g.id, courseId: g.courseId, status: 'PENDING' as const })),
      })
      const payment = await this.createPayment(tx, now, { tenantId, studentId, subscriptionId: sub.id, periodStart: now, periodEnd, amountMinor, currency: 'UZS', provider, expiresAt, createdById: studentId })
      await this.audit.record({ tx, action: 'subscription.checkout', entityType: 'Subscription', entityId: sub.id, after: { provider: payment.provider, free: payment.state === 'PAID', amountMinor: amountMinor.toString(), listAmountMinor: listMinor.toString(), discountMinor: (listMinor - amountMinor).toString(), groupIds: draft.draftGroupIds, packageId: draft.packageId, kind: sub.kind, lessonsTotal: sub.lessonsTotal } })
      return { subscription: sub, payment }
    })
    return result
  }

  /**
   * The payment a provider adapter will settle. Nothing to collect (free courses) means nothing a provider could ever
   * confirm, so the payment is recorded as paid without a provider and the subscription starts on the spot.
   */
  private async createPayment(tx: TransactionClient, now: Date, data: { tenantId: string; studentId: string; subscriptionId: string; periodStart: Date; periodEnd: Date; amountMinor: bigint; currency: string; provider: PaymentProvider; expiresAt: Date; createdById: string }) {
    const free = data.amountMinor === 0n
    const payment = await tx.payment.create({ data: free ? { ...data, provider: null, state: 'PAID', paidAt: now } : data })
    if (free) await this.applySettlement(tx, payment)
    return payment
  }

  /** Renewal payment for the next period of an active or blocked subscription (no new seat holds). */
  async renew(tenantId: string, studentId: string, provider: PaymentProvider) {
    const sub = await this.prisma.client.subscription.findFirst({ where: { tenantId, studentId, status: { in: ['ACTIVE', 'PAST_DUE'] } }, include: { package: true } })
    if (!sub) throw AppError.notFound('Active subscription')
    const pending = await this.prisma.client.payment.findFirst({ where: { tenantId, subscriptionId: sub.id, state: 'PENDING' } })
    if (pending) return { subscription: sub, payment: pending }
    const now = new Date()
    // An early renewal continues after the current period; a renewal of a blocked subscription starts a fresh period now.
    const periodStart = sub.status === 'ACTIVE' && sub.kind === 'PERIOD' && sub.currentPeriodEnd && sub.currentPeriodEnd > now ? sub.currentPeriodEnd : now
    const payment = await this.prisma.tx((tx) =>
      this.createPayment(tx, now, { tenantId, studentId, subscriptionId: sub.id, periodStart, periodEnd: this.periodEnd(periodStart, sub.package), amountMinor: sub.amountMinor, currency: sub.currency, provider, expiresAt: new Date(now.getTime() + this.env.PAYMENT_EXPIRES_HOURS * 3_600_000), createdById: studentId }),
    )
    return { subscription: sub, payment }
  }

  /**
   * Called inside the settlement transaction by the payments module. Idempotent per payment: activates (or reactivates)
   * the subscription, confirms pending seats, resets a lesson balance, and notifies the student and the staff of newly
   * joined groups.
   */
  async applySettlement(tx: TransactionClient, payment: { id: string; tenantId: string; subscriptionId: string; periodStart: Date; periodEnd: Date; amountMinor?: bigint }) {
    const sub = await tx.subscription.findFirst({ where: { id: payment.subscriptionId }, include: { package: true, student: { select: { displayName: true } } } })
    if (!sub) throw new Error(`Subscription ${payment.subscriptionId} missing for payment ${payment.id}`)
    // Money arriving for a subscription that was cancelled or expired meanwhile must be refused (and refunded), never
    // re-enroll the student behind their back. The adapters check this before debiting; the settle path confirms it here.
    if (isClosed(sub.status)) throw AppError.conflict('subscription_closed', `Subscription is ${sub.status.toLowerCase()}`)
    const now = new Date()
    const joining = await tx.enrollment.findMany({ where: { subscriptionId: sub.id, status: 'PENDING' }, include: { group: { select: { id: true, name: true, course: { select: { id: true, title: true, teacherId: true, centerId: true } } } } } })
    await tx.enrollment.updateMany({ where: { subscriptionId: sub.id, status: 'PENDING' }, data: { status: 'ACTIVE', enrolledAt: now } })
    const access = this.accessColumns(sub.package)
    const periodEnd = sub.kind === 'LESSONS' || payment.periodEnd > (sub.currentPeriodEnd ?? new Date(0)) ? payment.periodEnd : sub.currentPeriodEnd
    await tx.subscription.update({
      where: { id: sub.id },
      data: {
        status: 'ACTIVE',
        startedAt: sub.startedAt ?? now,
        currentPeriodStart: payment.periodStart,
        currentPeriodEnd: periodEnd,
        blockedAt: null,
        blockReason: null,
        graceEndsAt: null,
        expiryReminderAt: null,
        // A payment buys a fresh lesson balance (LESSONS) or a period (PERIOD); the kind follows the package.
        kind: access.kind,
        lessonsTotal: access.lessonsTotal,
        lessonsUsed: 0,
      },
    })
    await this.notifications.notify({ tenantId: payment.tenantId, userIds: [sub.studentId], type: 'payment.confirmed', params: { amountMinor: (payment.amountMinor ?? sub.amountMinor).toString(), periodEnd: periodEnd?.toISOString() ?? null, kind: access.kind, lessons: access.lessonsTotal }, dedupeKey: `payment-confirmed:${payment.id}` }, tx)
    for (const e of joining) {
      const staff = await this.notifications.courseStaffIds(payment.tenantId, e.group.course, tx)
      await this.notifications.notify({ tenantId: payment.tenantId, userIds: staff, type: 'enrollment.new', params: { studentName: sub.student.displayName, studentId: sub.studentId, courseTitle: e.group.course.title, courseId: e.group.course.id, groupName: e.group.name, groupId: e.group.id }, dedupeKey: `enrollment-new:${e.id}` }, tx)
    }
  }

  /** Access of the student's current subscription (used by check-ins and private materials). */
  async accessFor(studentId: string, db: Db = this.prisma.client): Promise<SubscriptionAccess & { subscriptionId: string | null }> {
    const sub = await db.subscription.findFirst({ where: { studentId, status: { in: ['ACTIVE', 'PAST_DUE'] } }, orderBy: { updatedAt: 'desc' } })
    if (!sub) return { active: false, blocked: false, reason: null, remainingDays: null, remainingLessons: null, subscriptionId: null }
    return { ...subscriptionAccess(sub), subscriptionId: sub.id }
  }

  /**
   * A PRESENT record consumes one lesson of a LESSONS subscription; when the balance is used up the subscription is blocked
   * on the spot. Counted at most once per record (AttendanceRecord.lessonCounted). PERIOD subscriptions are untouched.
   */
  async consumeLesson(db: Db, tenantId: string, studentId: string, recordId: string): Promise<{ counted: boolean; blocked: boolean }> {
    const record = await db.attendanceRecord.findFirst({ where: { id: recordId }, select: { lessonCounted: true, status: true } })
    if (!record || record.lessonCounted || record.status !== 'PRESENT') return { counted: false, blocked: false }
    const sub = await db.subscription.findFirst({ where: { tenantId, studentId, status: 'ACTIVE', kind: 'LESSONS' } })
    if (!sub) return { counted: false, blocked: false }
    const updated = await db.subscription.update({ where: { id: sub.id }, data: { lessonsUsed: { increment: 1 } } })
    await db.attendanceRecord.update({ where: { id: recordId }, data: { lessonCounted: true } })
    if (updated.lessonsTotal != null && updated.lessonsUsed >= updated.lessonsTotal) {
      await this.block(db, { id: sub.id, tenantId, studentId }, 'lessons_exhausted', new Date())
      return { counted: true, blocked: true }
    }
    return { counted: true, blocked: false }
  }

  /** A correction away from PRESENT gives the lesson back; a subscription blocked only by the balance is unblocked. */
  async releaseLesson(db: Db, tenantId: string, studentId: string, recordId: string): Promise<void> {
    const record = await db.attendanceRecord.findFirst({ where: { id: recordId }, select: { lessonCounted: true } })
    if (!record?.lessonCounted) return
    await db.attendanceRecord.update({ where: { id: recordId }, data: { lessonCounted: false } })
    const sub = await db.subscription.findFirst({ where: { tenantId, studentId, status: { in: ['ACTIVE', 'PAST_DUE'] }, kind: 'LESSONS' } })
    if (!sub) return
    const used = Math.max(0, sub.lessonsUsed - 1)
    const unblock = sub.status === 'PAST_DUE' && sub.blockReason === 'lessons_exhausted' && sub.lessonsTotal != null && used < sub.lessonsTotal
    await db.subscription.update({ where: { id: sub.id }, data: { lessonsUsed: used, ...(unblock ? { status: 'ACTIVE', blockedAt: null, blockReason: null, graceEndsAt: null } : {}) } })
  }

  private async block(db: Db, sub: { id: string; tenantId: string; studentId: string }, reason: 'period_ended' | 'lessons_exhausted', now: Date) {
    await db.subscription.update({ where: { id: sub.id }, data: { status: 'PAST_DUE', blockedAt: now, blockReason: reason, graceEndsAt: new Date(now.getTime() + this.env.SUBSCRIPTION_GRACE_DAYS * DAY_MS) } })
    await this.audit.record({ tx: db as TransactionClient, tenantId: sub.tenantId, action: 'subscription.blocked', entityType: 'Subscription', entityId: sub.id, after: { reason } })
    await this.notifications.notify({ tenantId: sub.tenantId, userIds: [sub.studentId], type: 'subscription.expired', params: { reason, graceDays: this.env.SUBSCRIPTION_GRACE_DAYS }, dedupeKey: `subscription-blocked:${sub.id}:${now.toISOString().slice(0, 10)}` }, db)
  }

  /**
   * Lifecycle sweep for one tenant: blocks ended periods and used-up balances, expires blocked subscriptions after the
   * grace period (seats released), and sends the "ending soon" reminders. Safe to run often; every step is idempotent.
   */
  async runLifecycle(tenantId: string, now = new Date()): Promise<{ blocked: number; expired: number; reminded: number }> {
    const remindMs = this.env.SUBSCRIPTION_REMIND_DAYS * DAY_MS
    const [active, blocked] = await Promise.all([
      this.prisma.client.subscription.findMany({ where: { tenantId, status: 'ACTIVE', OR: [{ currentPeriodEnd: { lte: new Date(now.getTime() + remindMs) } }, { kind: 'LESSONS' }] } }),
      this.prisma.client.subscription.findMany({ where: { tenantId, status: 'PAST_DUE', graceEndsAt: { lte: now } } }),
    ])
    const out = { blocked: 0, expired: 0, reminded: 0 }
    for (const sub of active) {
      const step = nextLifecycleStep(sub, now)
      if (step === 'block_period' || step === 'block_lessons') {
        await this.block(this.prisma.client, sub, step === 'block_period' ? 'period_ended' : 'lessons_exhausted', now)
        out.blocked++
        continue
      }
      const reminder = dueReminder(sub, now, this.env.SUBSCRIPTION_REMIND_DAYS)
      if (!reminder) continue
      const access = subscriptionAccess(sub, now)
      const marker = sub.currentPeriodEnd?.toISOString().slice(0, 10) ?? now.toISOString().slice(0, 10)
      await this.notifications.notify({
        tenantId, userIds: [sub.studentId],
        type: reminder === 'expiring' ? 'subscription.expiring' : 'subscription.lessonsLow',
        params: reminder === 'expiring' ? { days: access.remainingDays ?? 0, periodEnd: sub.currentPeriodEnd?.toISOString() ?? null } : { lessons: access.remainingLessons ?? 0 },
        dedupeKey: `subscription-${reminder}:${sub.id}:${marker}`,
      })
      await this.prisma.client.subscription.update({ where: { id: sub.id }, data: { expiryReminderAt: now } })
      out.reminded++
    }
    for (const sub of blocked) {
      if (nextLifecycleStep(sub, now) !== 'expire') continue
      await this.prisma.tx(async (tx) => {
        const locked = await tx.subscription.updateMany({ where: { id: sub.id, status: 'PAST_DUE' }, data: { status: 'EXPIRED' } })
        if (locked.count !== 1) return
        await tx.enrollment.updateMany({ where: { subscriptionId: sub.id, status: { in: ['PENDING', 'ACTIVE'] } }, data: { status: 'CANCELLED', cancelledAt: now } })
        await tx.payment.updateMany({ where: { subscriptionId: sub.id, state: 'PENDING' }, data: { state: 'CANCELLED', cancelledAt: now } })
        await this.audit.record({ tx, tenantId, action: 'subscription.expired', entityType: 'Subscription', entityId: sub.id, after: { reason: sub.blockReason } })
        await this.notifications.notify({ tenantId, userIds: [sub.studentId], type: 'subscription.ended', params: { reason: sub.blockReason }, dedupeKey: `subscription-ended:${sub.id}` }, tx)
        out.expired++
      })
    }
    if (out.blocked || out.expired || out.reminded) this.logger.log(`Subscription lifecycle for ${tenantId}: ${JSON.stringify(out)}`)
    return out
  }

  /** Lifecycle sweep for every tenant (maintenance job). */
  async runLifecycleAll(now = new Date()): Promise<{ blocked: number; expired: number; reminded: number }> {
    const total = { blocked: 0, expired: 0, reminded: 0 }
    const tenants = await TenantContext.system(() => this.prisma.client.tenant.findMany({ select: { id: true } }))
    for (const t of tenants) {
      const r = await TenantContext.forTenant(t.id, () => this.runLifecycle(t.id, now))
      total.blocked += r.blocked; total.expired += r.expired; total.reminded += r.reminded
    }
    return total
  }

  /** Expire pending payments past their deadline and release the seat holds. */
  async expirePending(tenantId: string, now = new Date()): Promise<number> {
    const expired = await this.prisma.client.payment.findMany({ where: { tenantId, state: 'PENDING', expiresAt: { lt: now } }, select: { id: true, subscriptionId: true } })
    for (const p of expired) {
      await this.prisma.tx(async (tx) => {
        const locked = await tx.payment.updateMany({ where: { id: p.id, state: 'PENDING' }, data: { state: 'EXPIRED' } })
        if (locked.count !== 1) return
        const sub = await tx.subscription.findFirst({ where: { id: p.subscriptionId } })
        if (sub?.status === 'PENDING_PAYMENT') {
          await tx.enrollment.updateMany({ where: { subscriptionId: sub.id, status: 'PENDING' }, data: { status: 'CANCELLED', cancelledAt: now } })
          await tx.subscription.update({ where: { id: sub.id }, data: { status: 'DRAFT' } })
        }
        await this.audit.record({ tx, tenantId, action: 'payment.expired', entityType: 'Payment', entityId: p.id })
      })
    }
    return expired.length
  }

  async cancel(tenantId: string, studentId: string, reason?: string) {
    const sub = await this.prisma.client.subscription.findFirst({ where: { tenantId, studentId, status: { in: ['ACTIVE', 'PAST_DUE', 'PENDING_PAYMENT'] } } })
    if (!sub) throw AppError.notFound('Subscription')
    const cancelled = await this.prisma.tx((tx) => this.cancelIn(tx, sub.id, ['ACTIVE', 'PAST_DUE', 'PENDING_PAYMENT'], reason))
    if (!cancelled) throw AppError.notFound('Subscription')
    return { ok: true }
  }

  /**
   * Cancels a subscription inside the caller's transaction: seats released, pending payments voided. Returns false
   * (nothing written) when the row is no longer in one of `from`, e.g. a settlement activated it meanwhile. The payment
   * rows are locked first, in the order settle() takes them, so the two serialize instead of deadlocking.
   */
  private async cancelIn(tx: TransactionClient, subscriptionId: string, from: SubscriptionStatus[], reason?: string, now = new Date()): Promise<boolean> {
    await tx.$queryRawUnsafe(`SELECT id FROM "Payment" WHERE "subscriptionId" = $1 FOR UPDATE`, subscriptionId)
    const cancelled = await tx.subscription.updateMany({ where: { id: subscriptionId, status: { in: from } }, data: { status: 'CANCELLED', cancelledAt: now } })
    if (cancelled.count !== 1) return false
    await tx.enrollment.updateMany({ where: { subscriptionId, status: { in: ['PENDING', 'ACTIVE'] } }, data: { status: 'CANCELLED', cancelledAt: now } })
    await tx.payment.updateMany({ where: { subscriptionId, state: 'PENDING' }, data: { state: 'CANCELLED', cancelledAt: now } })
    await this.audit.record({ tx, action: 'subscription.cancel', entityType: 'Subscription', entityId: subscriptionId, reason })
    return true
  }

  private async grantCourseIds(tenantId: string, groupIds: string[]): Promise<string[]> {
    if (!groupIds.length) return []
    const groups = await this.prisma.client.group.findMany({ where: { tenantId, id: { in: groupIds } }, include: { course: { select: { id: true, meyosGrant: true } } } })
    return groups.filter((g) => g.course.meyosGrant).map((g) => g.course.id)
  }
}
