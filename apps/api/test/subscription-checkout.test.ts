import { describe, expect, it, vi } from 'vitest'
import { OFFER_VERSION } from '@ilmora/shared'
import type { Env } from '../src/config/env'
import type { PrismaService, TransactionClient } from '../src/infra/prisma/prisma.service'
import type { AuditService } from '../src/modules/audit/audit.service'
import { SubscriptionService } from '../src/modules/enrollment/subscription.service'
import { LedgerService } from '../src/modules/payments/ledger.service'
import type { OutboxService } from '../src/modules/payments/outbox.service'
import { PaymentsService } from '../src/modules/payments/payments.service'
import { notificationsStub } from './stubs'

const env = { PAYMENT_EXPIRES_HOURS: 24, PUBLIC_WEB_URL: 'http://localhost:3000', PAYME_MERCHANT_ID: 'm', PAYME_TEST_KEY: 'k' } as unknown as Env
const audit = { record: async () => undefined } as unknown as AuditService

const group = (priceMinor: bigint) => ({
  id: 'g1', courseId: 'c1', name: 'A', days: [0, 2], startTime: '18:00', endTime: '19:30', room: '', capacity: 10,
  course: { id: 'c1', center: { status: 'ACTIVE' }, priceMinor, discountPercent: null, discountStartsAt: null, discountEndsAt: null, meyosGrant: false, status: 'PUBLISHED' },
})

/** A draft with one custom-selected course, optionally next to another open subscription of the same student. */
function setup(opts: { priceMinor?: bigint; open?: { id: string; status: string } | null; raceLost?: boolean; subStatus?: string } = {}) {
  const calls: Record<string, unknown[]> = {}
  const spy = (name: string, result: unknown) => vi.fn(async (args: unknown) => { (calls[name] ??= []).push(args); return result })
  const draft = { id: 'sub-draft', tenantId: 't', studentId: 's1', status: 'DRAFT', packageId: null, draftGroupIds: ['g1'], meyosGrant: false, grantCourseIds: [] }
  const tx = {
    $queryRawUnsafe: spy('tx.$queryRawUnsafe', []),
    group: { findMany: vi.fn(async () => [group(opts.priceMinor ?? 50_000_00n)]) },
    enrollment: { groupBy: vi.fn(async () => []), deleteMany: spy('enrollment.deleteMany', { count: 0 }), createManyAndReturn: spy('enrollment.createManyAndReturn', [{ id: 'e1', groupId: 'g1' }]), updateMany: spy('enrollment.updateMany', { count: 1 }), findMany: vi.fn(async () => []) },
    subscription: {
      updateMany: spy('subscription.updateMany', { count: opts.raceLost ? 0 : 1 }),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { (calls['subscription.update'] ??= []).push(data); return { ...draft, kind: 'PERIOD', lessonsTotal: null, ...data } }),
      // The draft read again under the lock (a bare `where: { id }`) is still a draft; the settlement path reads it with its
      // package and student.
      findFirst: vi.fn(async (args?: { include?: unknown }) => (args?.include ? { ...draft, status: opts.subStatus ?? 'PENDING_PAYMENT', kind: 'PERIOD', startedAt: null, currentPeriodEnd: null, amountMinor: 0n, package: null, student: { displayName: 'S' } } : { ...draft, status: 'DRAFT' })),
    },
    paymentLine: { createMany: spy('paymentLine.createMany', { count: 1 }) },
    payment: {
      findFirst: vi.fn(async () => null),
      updateMany: spy('payment.updateMany', { count: 1 }),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { (calls['payment.create'] ??= []).push(data); return { id: 'pay-new', state: 'PENDING', provider: null, paidAt: null, ...data } }),
    },
  }
  const prisma = {
    client: {
      subscription: { findFirst: vi.fn(async (args: { where: { status: unknown } }) => (args.where.status === 'DRAFT' ? draft : opts.open ?? null)) },
      package: { findFirst: vi.fn(async () => null) },
      // The student has accepted the current offer and the personal-data consent (security review №31).
      user: { findFirst: vi.fn(async () => ({ offerAcceptedAt: new Date(), offerVersion: OFFER_VERSION, consentAt: new Date() })) },
    },
    tx: vi.fn(async (fn: (t: TransactionClient) => Promise<unknown>) => fn(tx as unknown as TransactionClient)),
  }
  const subscriptions = new SubscriptionService(prisma as unknown as PrismaService, audit, notificationsStub, env)
  const payments = new PaymentsService(prisma as unknown as PrismaService, new LedgerService(), { enqueue: async () => undefined } as unknown as OutboxService, subscriptions, audit, env)
  return { subscriptions, payments, prisma, tx, calls }
}

describe('checkout after a failed, cancelled or abandoned payment', () => {
  it('cancels the unpaid earlier checkout inside the transaction and goes on with the new one', async () => {
    const { subscriptions, calls } = setup({ open: { id: 'sub-old', status: 'PENDING_PAYMENT' } })
    const { payment } = await subscriptions.checkout('t', 's1', 'PAYME')
    expect(calls['subscription.updateMany']?.[0]).toMatchObject({ where: { id: 'sub-old', status: { in: ['PENDING_PAYMENT'] } }, data: { status: 'CANCELLED' } })
    expect(calls['enrollment.updateMany']?.[0]).toMatchObject({ where: { subscriptionId: 'sub-old', status: { in: ['PENDING', 'ACTIVE'] } }, data: { status: 'CANCELLED' } })
    expect(calls['payment.updateMany']?.[0]).toMatchObject({ where: { subscriptionId: 'sub-old', state: 'PENDING' }, data: { state: 'CANCELLED' } })
    expect(calls['payment.create']?.[0]).toMatchObject({ subscriptionId: 'sub-draft', provider: 'PAYME', amountMinor: 50_000_00n })
    expect(payment.id).toBe('pay-new')
  })

  it('still refuses while a paid subscription is active or blocked', async () => {
    for (const status of ['ACTIVE', 'PAST_DUE']) {
      const { subscriptions, prisma, calls } = setup({ open: { id: 'sub-paid', status } })
      await expect(subscriptions.checkout('t', 's1', 'PAYME')).rejects.toMatchObject({ code: 'subscription_exists' })
      expect(prisma.tx).not.toHaveBeenCalled()
      expect(calls['payment.create']).toBeUndefined()
    }
  })

  it('refuses when the earlier checkout got paid in the meantime', async () => {
    const { subscriptions, calls } = setup({ open: { id: 'sub-old', status: 'PENDING_PAYMENT' }, raceLost: true })
    await expect(subscriptions.checkout('t', 's1', 'PAYME')).rejects.toMatchObject({ code: 'subscription_exists' })
    expect(calls['enrollment.updateMany']).toBeUndefined()
    expect(calls['payment.create']).toBeUndefined()
  })
})

describe('free checkout', () => {
  it('records the payment as paid without a provider and activates the subscription on the spot', async () => {
    const { subscriptions, payments, calls } = setup({ priceMinor: 0n })
    const { payment } = await subscriptions.checkout('t', 's1', 'PAYME')
    expect(calls['payment.create']?.[0]).toMatchObject({ amountMinor: 0n, provider: null, state: 'PAID' })
    expect(calls['enrollment.updateMany']?.[0]).toMatchObject({ where: { subscriptionId: 'sub-draft', status: 'PENDING' }, data: { status: 'ACTIVE' } })
    expect(calls['subscription.update']?.map((d) => (d as { status: string }).status)).toEqual(['PENDING_PAYMENT', 'ACTIVE'])
    expect(payments.checkoutLink(payment, 'PAYME', 'uz')).toEqual({ paymentId: 'pay-new', provider: null, url: null, expiresAt: payment.expiresAt, free: true })
  })

  it('a priced checkout stays pending for the provider', async () => {
    const { subscriptions, calls } = setup({ priceMinor: 50_000_00n })
    const { payment } = await subscriptions.checkout('t', 's1', 'PAYME')
    expect(calls['payment.create']?.[0]).toMatchObject({ amountMinor: 50_000_00n, provider: 'PAYME' })
    expect(calls['payment.create']?.[0]).not.toHaveProperty('state')
    // What the payment pays for each course is kept with it: a refund is counted from it (security review №42).
    expect(calls['paymentLine.createMany']?.[0]).toEqual({ data: [{ tenantId: 't', paymentId: 'pay-new', enrollmentId: 'e1', courseId: 'c1', listPriceMinor: 50_000_00n, amountMinor: 50_000_00n }] })
    expect(calls['enrollment.updateMany']).toBeUndefined()
    expect(payment.state).toBe('PENDING')
  })
})

describe('settlement of a closed subscription', () => {
  it('is refused, so a late provider callback never re-enrolls a student who left', async () => {
    for (const subStatus of ['CANCELLED', 'EXPIRED']) {
      const { subscriptions, tx, calls } = setup({ subStatus })
      const payment = { id: 'pay-late', tenantId: 't', subscriptionId: 'sub-draft', periodStart: new Date(), periodEnd: new Date() }
      await expect(subscriptions.applySettlement(tx as unknown as TransactionClient, payment)).rejects.toMatchObject({ code: 'subscription_closed' })
      expect(calls['enrollment.updateMany']).toBeUndefined()
      expect(calls['subscription.update']).toBeUndefined()
    }
  })
})
