import { Inject, Injectable } from '@nestjs/common'
import { finalPriceMinor, MAX_CART_COURSES, overlaps } from '@ilmora/shared'
import { AppError } from '../../common/errors'
import { addMonthsUtc } from '../../common/time'
import { ENV, type Env } from '../../config/env'
import type { PaymentProvider } from '../../generated/prisma/enums'
import { PrismaService, type TransactionClient } from '../../infra/prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { discountWindow, toGroup } from '../catalog/catalog.service'

export interface DraftInput { packageId: string | null; groupIds: string[]; meyosGrant: boolean }

type GroupRow = { id: string; courseId: string; name: string; days: number[]; startTime: string; endTime: string; room: string; capacity: number; course: { id: string; priceMinor: bigint; discountPercent: number | null; discountStartsAt: Date | null; discountEndsAt: Date | null; meyosGrant: boolean; status: string } }

/**
 * Subscription lifecycle: draft (builder) → checkout (seat holds + pending payment) → active (on settlement).
 * Capacity is enforced inside a transaction that locks the group rows, so two students cannot take the last seat.
 */
@Injectable()
export class SubscriptionService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, @Inject(ENV) private readonly env: Env) {}

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
    const groups = (await db.group.findMany({ where: { tenantId, id: { in: groupIds }, deletedAt: null }, include: { course: { select: { id: true, priceMinor: true, discountPercent: true, discountStartsAt: true, discountEndsAt: true, meyosGrant: true, status: true } } } })) as GroupRow[]
    if (groups.length !== groupIds.length) throw AppError.notFound('Group')
    if (groups.some((g) => g.course.status !== 'PUBLISHED')) throw AppError.invalid('disabled', 'One of the courses is not open for enrollment')
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

  /**
   * Checkout: turns the draft into a PENDING_PAYMENT subscription with seat holds and creates the payment
   * the provider adapters will settle. Group rows are locked so capacity is re-checked atomically.
   */
  async checkout(tenantId: string, studentId: string, provider: PaymentProvider) {
    const draft = await this.prisma.client.subscription.findFirst({ where: { tenantId, studentId, status: 'DRAFT' } })
    if (!draft) throw AppError.invalid('incomplete', 'Choose a package and your courses first')
    if (draft.packageId) {
      // Duo/Trio style package: the number of courses must match the package exactly.
      const pkg = await this.prisma.client.package.findFirst({ where: { tenantId, id: draft.packageId } })
      if (!pkg || draft.draftGroupIds.length !== pkg.maxCourses) throw AppError.invalid('incomplete', `Select ${pkg?.maxCourses ?? ''} courses to continue`)
    } else if (draft.draftGroupIds.length === 0) {
      // Custom selection: any number of courses from one up to the cart limit, validated below.
      throw AppError.invalid('incomplete', 'Select at least one course to continue')
    }
    const open = await this.prisma.client.subscription.findFirst({ where: { tenantId, studentId, status: { in: ['PENDING_PAYMENT', 'ACTIVE', 'PAST_DUE'] } } })
    if (open) throw AppError.conflict('subscription_exists', 'You already have an active or pending subscription')

    const now = new Date()
    const expiresAt = new Date(now.getTime() + this.env.PAYMENT_EXPIRES_HOURS * 3_600_000)
    const result = await this.prisma.tx(async (tx) => {
      // Row locks serialize concurrent checkouts touching the same groups.
      await tx.$queryRawUnsafe(`SELECT id FROM "Group" WHERE id = ANY($1::text[]) AND "tenantId" = $2 FOR UPDATE`, draft.draftGroupIds, tenantId)
      const groups = await this.validateSelection(tenantId, draft.packageId, draft.draftGroupIds, studentId, tx)
      // Each course is charged its list price minus the discount active right now (none stacks with anything else); the server
      // decides the amount, the browser only displays it. The amount stays fixed for this payment's hold.
      const listMinor = groups.reduce((sum, g) => sum + g.course.priceMinor, 0n)
      const amountMinor = groups.reduce((sum, g) => sum + finalPriceMinor(g.course.priceMinor, discountWindow(g.course), now), 0n)
      const sub = await tx.subscription.update({
        where: { id: draft.id },
        data: { status: 'PENDING_PAYMENT', amountMinor, currency: 'UZS', currentPeriodStart: now, currentPeriodEnd: addMonthsUtc(now, 1) },
      })
      await tx.enrollment.createMany({
        data: groups.map((g) => ({ tenantId, subscriptionId: sub.id, studentId, groupId: g.id, courseId: g.courseId, status: 'PENDING' as const })),
      })
      const payment = await tx.payment.create({
        data: { tenantId, studentId, subscriptionId: sub.id, periodStart: now, periodEnd: addMonthsUtc(now, 1), amountMinor, currency: 'UZS', provider, expiresAt, createdById: studentId },
      })
      await this.audit.record({ tx, action: 'subscription.checkout', entityType: 'Subscription', entityId: sub.id, after: { provider, amountMinor: amountMinor.toString(), listAmountMinor: listMinor.toString(), discountMinor: (listMinor - amountMinor).toString(), groupIds: draft.draftGroupIds, packageId: draft.packageId } })
      return { subscription: sub, payment }
    })
    return result
  }

  /** Renewal payment for the next period of an active subscription (no new seat holds). */
  async renew(tenantId: string, studentId: string, provider: PaymentProvider) {
    const sub = await this.prisma.client.subscription.findFirst({ where: { tenantId, studentId, status: { in: ['ACTIVE', 'PAST_DUE'] } } })
    if (!sub) throw AppError.notFound('Active subscription')
    const pending = await this.prisma.client.payment.findFirst({ where: { tenantId, subscriptionId: sub.id, state: 'PENDING' } })
    if (pending) return { subscription: sub, payment: pending }
    const periodStart = sub.currentPeriodEnd ?? new Date()
    const payment = await this.prisma.client.payment.create({
      data: { tenantId, studentId, subscriptionId: sub.id, periodStart, periodEnd: addMonthsUtc(periodStart, 1), amountMinor: sub.amountMinor, currency: sub.currency, provider, expiresAt: new Date(Date.now() + this.env.PAYMENT_EXPIRES_HOURS * 3_600_000), createdById: studentId },
    })
    return { subscription: sub, payment }
  }

  /** Called inside the settlement transaction by the payments module. Idempotent per payment. */
  async applySettlement(tx: TransactionClient, payment: { id: string; tenantId: string; subscriptionId: string; periodStart: Date; periodEnd: Date }) {
    const sub = await tx.subscription.findFirst({ where: { id: payment.subscriptionId } })
    if (!sub) throw new Error(`Subscription ${payment.subscriptionId} missing for payment ${payment.id}`)
    const now = new Date()
    await tx.enrollment.updateMany({ where: { subscriptionId: sub.id, status: 'PENDING' }, data: { status: 'ACTIVE', enrolledAt: now } })
    await tx.subscription.update({
      where: { id: sub.id },
      data: {
        status: 'ACTIVE',
        startedAt: sub.startedAt ?? now,
        currentPeriodStart: payment.periodStart,
        currentPeriodEnd: payment.periodEnd > (sub.currentPeriodEnd ?? new Date(0)) ? payment.periodEnd : sub.currentPeriodEnd,
      },
    })
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
    await this.prisma.tx(async (tx) => {
      await tx.enrollment.updateMany({ where: { subscriptionId: sub.id, status: { in: ['PENDING', 'ACTIVE'] } }, data: { status: 'CANCELLED', cancelledAt: new Date() } })
      await tx.payment.updateMany({ where: { subscriptionId: sub.id, state: 'PENDING' }, data: { state: 'CANCELLED', cancelledAt: new Date() } })
      await tx.subscription.update({ where: { id: sub.id }, data: { status: 'CANCELLED', cancelledAt: new Date() } })
      await this.audit.record({ tx, action: 'subscription.cancel', entityType: 'Subscription', entityId: sub.id, reason })
    })
    return { ok: true }
  }

  private async grantCourseIds(tenantId: string, groupIds: string[]): Promise<string[]> {
    if (!groupIds.length) return []
    const groups = await this.prisma.client.group.findMany({ where: { tenantId, id: { in: groupIds } }, include: { course: { select: { id: true, meyosGrant: true } } } })
    return groups.filter((g) => g.course.meyosGrant).map((g) => g.course.id)
  }
}
