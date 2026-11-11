import { Inject, Injectable } from '@nestjs/common'
import { safeEqual } from '../../../common/crypto'
import { ENV, type Env } from '../../../config/env'
import type { PaymentState } from '../../../generated/prisma/enums'
import { PrismaService, type TransactionClient } from '../../../infra/prisma/prisma.service'
import { PaymentsService } from '../payments.service'

/** Payme Merchant API error codes (docs/payments/payme-merchant-api.md §3). */
export const PAYME = {
  NOT_POST: -32300,
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  UNAUTHORIZED: -32504,
  INTERNAL: -32400,
  WRONG_AMOUNT: -31001,
  TX_NOT_FOUND: -31003,
  CANNOT_CANCEL: -31007,
  CANNOT_PERFORM: -31008,
  ACCOUNT_NOT_FOUND: -31050,
  ORDER_NOT_PENDING: -31051,
  TIMEOUT_MS: 43_200_000,
} as const

export class PaymeError extends Error {
  constructor(public readonly code: number, public readonly messages: { ru: string; uz: string; en: string }, public readonly data?: unknown) {
    super(messages.en)
  }
}

/** How long a test order listed in PAYME_SANDBOX_PAYMENT_IDS stays open to the test key in production (№39). */
export const SANDBOX_ORDER_DAYS = 7

const msg = (ru: string, uz: string, en: string) => ({ ru, uz, en })
const M = {
  unauthorized: msg('Недостаточно привилегий для выполнения метода', 'Metodni bajarish uchun huquq yetarli emas', 'Insufficient privileges to perform the method'),
  wrongAmount: msg('Неверная сумма', 'Noto‘g‘ri summa', 'Incorrect amount'),
  txNotFound: msg('Транзакция не найдена', 'Tranzaksiya topilmadi', 'Transaction not found'),
  cannotPerform: msg('Невозможно выполнить операцию', 'Amalni bajarib bo‘lmaydi', 'Unable to perform operation'),
  cannotCancel: msg('Заказ выполнен. Невозможно отменить транзакцию.', 'Buyurtma bajarilgan. Tranzaksiyani bekor qilib bo‘lmaydi.', 'Order completed. Unable to cancel the transaction.'),
  orderNotFound: msg('Заказ не найден', 'Buyurtma topilmadi', 'Order not found'),
  orderNotPending: msg('Заказ уже оплачен или отменён', 'Buyurtma allaqachon to‘langan yoki bekor qilingan', 'Order is already paid or cancelled'),
  methodNotFound: msg('Метод не найден', 'Metod topilmadi', 'Method not found'),
  invalidRequest: msg('Неверный запрос', 'Noto‘g‘ri so‘rov', 'Invalid request'),
  internal: msg('Внутренняя ошибка', 'Ichki xatolik', 'Internal error'),
}

type Account = { payment_id?: unknown }

/**
 * Payme JSON-RPC merchant endpoint logic. One active transaction per payment; every state change runs
 * inside a transaction holding the Payment row lock, so retried or concurrent calls return identical results.
 */
@Injectable()
export class PaymeService {
  constructor(private readonly prisma: PrismaService, private readonly payments: PaymentsService, @Inject(ENV) private readonly env: Env) {}

  /**
   * Returns { sandbox } when the Basic header matches the live key, or the test key. The test key is accepted outside
   * production, and in production only while PAYME_SANDBOX_PAYMENT_IDS lists the test orders (see `fenced`).
   */
  authenticate(authorization: string | undefined): { sandbox: boolean } {
    if (!authorization?.startsWith('Basic ')) throw new PaymeError(PAYME.UNAUTHORIZED, M.unauthorized)
    const decoded = Buffer.from(authorization.slice(6).trim(), 'base64').toString('utf8')
    const sep = decoded.indexOf(':')
    if (sep < 0) throw new PaymeError(PAYME.UNAUTHORIZED, M.unauthorized)
    const login = decoded.slice(0, sep)
    const key = decoded.slice(sep + 1)
    if (!safeEqual(login, this.env.PAYME_LOGIN)) throw new PaymeError(PAYME.UNAUTHORIZED, M.unauthorized)
    if (this.env.PAYME_KEY && safeEqual(key, this.env.PAYME_KEY)) return { sandbox: false }
    if (this.env.PAYME_TEST_KEY && (this.env.NODE_ENV !== 'production' || this.env.PAYME_SANDBOX_PAYMENT_IDS.length > 0) && safeEqual(key, this.env.PAYME_TEST_KEY)) return { sandbox: true }
    throw new PaymeError(PAYME.UNAUTHORIZED, M.unauthorized)
  }

  async handle(method: string, params: Record<string, unknown>, sandbox: boolean): Promise<unknown> {
    switch (method) {
      case 'CheckPerformTransaction': return this.checkPerform(params, sandbox)
      case 'CreateTransaction': return this.create(params, sandbox)
      case 'PerformTransaction': return this.perform(params, sandbox)
      case 'CancelTransaction': return this.cancel(params, sandbox)
      case 'CheckTransaction': return this.check(params, sandbox)
      case 'GetStatement': return this.statement(params, sandbox)
      default: throw new PaymeError(PAYME.METHOD_NOT_FOUND, M.methodNotFound, method)
    }
  }

  /**
   * A test-key call in production: a sandbox payment settles like a real one, so it may only reach the test orders
   * listed in PAYME_SANDBOX_PAYMENT_IDS and the sandbox transactions on them. Everything else looks absent to it.
   */
  private fenced(sandbox: boolean): boolean {
    return sandbox && this.env.NODE_ENV === 'production'
  }

  /**
   * In production a test order is open to the test key for SANDBOX_ORDER_DAYS after it was created: a forgotten
   * PAYME_SANDBOX_PAYMENT_IDS does not keep the test key alive forever (security review 10.11 №39).
   */
  private assertSandboxFresh(payment: { createdAt: Date }, sandbox: boolean) {
    if (this.fenced(sandbox) && Date.now() - payment.createdAt.getTime() > SANDBOX_ORDER_DAYS * 86_400_000) throw new PaymeError(PAYME.ACCOUNT_NOT_FOUND, M.orderNotFound, 'payment_id')
  }

  private paymentIdFrom(params: Record<string, unknown>, sandbox: boolean): string {
    const account = params.account as Account | undefined
    const id = account?.payment_id
    if (typeof id !== 'string' || !id) throw new PaymeError(PAYME.ACCOUNT_NOT_FOUND, M.orderNotFound, 'payment_id')
    if (this.fenced(sandbox) && !this.env.PAYME_SANDBOX_PAYMENT_IDS.includes(id)) throw new PaymeError(PAYME.ACCOUNT_NOT_FOUND, M.orderNotFound, 'payment_id')
    return id
  }

  /** The Payme transaction by its id, as the caller may see it: a fenced test-key call sees only sandbox rows. */
  private async findTx(db: TransactionClient | PrismaService['client'], params: Record<string, unknown>, sandbox: boolean) {
    const row = await db.paymentTransaction.findUnique({ where: { provider_providerTransactionId: { provider: 'PAYME', providerTransactionId: String(params.id ?? '') } } })
    if (!row || (this.fenced(sandbox) && !row.sandbox)) throw new PaymeError(PAYME.TX_NOT_FOUND, M.txNotFound)
    return row
  }

  private amountFrom(params: Record<string, unknown>): bigint {
    const a = params.amount
    if (typeof a !== 'number' || !Number.isInteger(a) || a <= 0) throw new PaymeError(PAYME.WRONG_AMOUNT, M.wrongAmount)
    return BigInt(a)
  }

  private async checkPerform(params: Record<string, unknown>, sandbox: boolean) {
    const paymentId = this.paymentIdFrom(params, sandbox)
    const amount = this.amountFrom(params)
    const payment = await this.prisma.client.payment.findFirst({ where: { id: paymentId } })
    if (!payment) throw new PaymeError(PAYME.ACCOUNT_NOT_FOUND, M.orderNotFound, 'payment_id')
    this.assertSandboxFresh(payment, sandbox)
    if (!(await this.payable(this.prisma.client, payment))) throw new PaymeError(PAYME.ORDER_NOT_PENDING, M.orderNotPending, 'payment_id')
    if (payment.amountMinor !== amount) throw new PaymeError(PAYME.WRONG_AMOUNT, M.wrongAmount)
    return {
      allow: true,
      // Fiscal receipt: one line for the whole amount (tiyins); codes and VAT come from env.
      detail: {
        receipt_type: 0,
        items: [{
          title: await this.receiptTitle(payment.subscriptionId),
          price: Number(payment.amountMinor),
          count: 1,
          code: this.env.PAYME_FISCAL_IKPU,
          package_code: this.env.PAYME_FISCAL_PACKAGE_CODE,
          vat_percent: this.env.PAYME_FISCAL_VAT_PERCENT,
        }],
      },
    }
  }

  /**
   * The order can still be paid: pending, inside its hold, and its subscription not closed meanwhile. A Payme test order
   * (PAYME_SANDBOX_PAYMENT_IDS) has no hold: Payme's tests take days, and the hold is an hour for everybody else (№82).
   */
  private async payable(db: TransactionClient | PrismaService['client'], payment: { id: string; state: PaymentState; subscriptionId: string; periodStart: Date; periodEnd: Date; expiresAt: Date | null }): Promise<boolean> {
    if (payment.expiresAt && payment.expiresAt < new Date() && !this.env.PAYME_SANDBOX_PAYMENT_IDS.includes(payment.id)) return false
    return (await this.payments.settleBlocker(db, payment)) === null
  }

  /**
   * Runs `fn` in one transaction and raises a PaymeError it *returns* only after the commit. Throwing inside the
   * transaction would roll back the bookkeeping done before refusing (a transaction row cancelled with its reason).
   */
  private async txRefusing<T>(fn: (tx: TransactionClient) => Promise<T | PaymeError>): Promise<T> {
    const out = await this.prisma.tx(fn)
    if (out instanceof PaymeError) throw out
    return out
  }

  /**
   * The receipt line names what is bought (security review 10.11 №41): the package, or the courses of a selection —
   * in Russian, as the fiscal receipt is printed; at most 128 characters.
   */
  private async receiptTitle(subscriptionId: string): Promise<string> {
    const sub = await this.prisma.client.subscription.findFirst({
      where: { id: subscriptionId },
      select: { package: { select: { name: true } }, enrollments: { where: { status: { in: ['PENDING', 'ACTIVE'] } }, select: { group: { select: { course: { select: { title: true } } } } } } },
    })
    const ru = (v: unknown): string => {
      const o = (v ?? {}) as Record<string, unknown>
      return String(o.ru || o.uz || o.en || '').trim()
    }
    const what = ru(sub?.package?.name) || [...new Set((sub?.enrollments ?? []).map((e) => ru(e.group.course.title)).filter(Boolean))].join(', ')
    const title = what ? `ILMORA — ${what}` : 'ILMORA — подписка на занятия'
    return title.length > 128 ? `${title.slice(0, 127)}…` : title
  }

  private async create(params: Record<string, unknown>, sandbox: boolean) {
    const providerTxId = String(params.id ?? '')
    const time = typeof params.time === 'number' ? params.time : NaN
    if (!providerTxId || !Number.isFinite(time)) throw new PaymeError(PAYME.INVALID_REQUEST, M.invalidRequest)
    const paymentId = this.paymentIdFrom(params, sandbox)
    const amount = this.amountFrom(params)

    return this.txRefusing(async (tx) => {
      const payment = await this.payments.lockPayment(tx, paymentId)
      if (!payment) throw new PaymeError(PAYME.ACCOUNT_NOT_FOUND, M.orderNotFound, 'payment_id')
      this.assertSandboxFresh(payment, sandbox)
      const existing = await tx.paymentTransaction.findUnique({ where: { provider_providerTransactionId: { provider: 'PAYME', providerTransactionId: providerTxId } } })
      if (existing) {
        if (existing.paymentId !== payment.id) throw new PaymeError(PAYME.CANNOT_PERFORM, M.cannotPerform)
        if (existing.state === 'CREATED') {
          if (this.expired(existing.providerTime)) {
            await this.cancelCreated(tx, existing.id, payment.id, 4)
            return new PaymeError(PAYME.CANNOT_PERFORM, M.cannotPerform)
          }
          return { create_time: existing.createdAt.getTime(), transaction: String(existing.seq), state: 1 }
        }
        throw new PaymeError(PAYME.CANNOT_PERFORM, M.cannotPerform)
      }
      if (!(await this.payable(tx, payment))) throw new PaymeError(PAYME.ORDER_NOT_PENDING, M.orderNotPending, 'payment_id')
      if (payment.amountMinor !== amount) throw new PaymeError(PAYME.WRONG_AMOUNT, M.wrongAmount)
      const active = await tx.paymentTransaction.findFirst({ where: { paymentId: payment.id, provider: 'PAYME', state: 'CREATED' } })
      if (active) throw new PaymeError(PAYME.CANNOT_PERFORM, M.cannotPerform)
      if (this.expired(BigInt(Math.trunc(time)))) throw new PaymeError(PAYME.CANNOT_PERFORM, M.cannotPerform)
      const created = await tx.paymentTransaction.create({
        data: { tenantId: payment.tenantId, paymentId: payment.id, provider: 'PAYME', providerTransactionId: providerTxId, providerTime: BigInt(Math.trunc(time)), providerState: 1, state: 'CREATED', amountMinor: amount, currency: payment.currency, sandbox },
      })
      return { create_time: created.createdAt.getTime(), transaction: String(created.seq), state: 1 }
    })
  }

  private async perform(params: Record<string, unknown>, sandbox: boolean) {
    const providerTxId = String(params.id ?? '')
    return this.txRefusing(async (tx) => {
      const found = await this.findTx(tx, params, sandbox)
      const payment = await this.payments.lockPayment(tx, found.paymentId)
      const row = await tx.paymentTransaction.findFirst({ where: { id: found.id } })
      if (!row) throw new PaymeError(PAYME.TX_NOT_FOUND, M.txNotFound)
      if (row.state === 'PERFORMED') return { transaction: String(row.seq), perform_time: row.performedAt!.getTime(), state: 2 }
      if (row.state !== 'CREATED') throw new PaymeError(PAYME.CANNOT_PERFORM, M.cannotPerform)
      if (this.expired(row.providerTime)) {
        await this.cancelCreated(tx, row.id, row.paymentId, 4)
        return new PaymeError(PAYME.CANNOT_PERFORM, M.cannotPerform)
      }
      // The order can no longer be fulfilled (hold expired or cancelled, paid through the other provider, subscription
      // closed): refusing makes Payme reverse the debit instead of us taking money that activates nothing. The row is
      // closed the way a timeout is, so CheckTransaction and a later CancelTransaction tell the same story.
      if (!payment || (await this.payments.settleBlocker(tx, payment))) {
        await this.cancelCreated(tx, row.id, row.paymentId, 3)
        return new PaymeError(PAYME.CANNOT_PERFORM, M.cannotPerform)
      }
      const performedAt = new Date()
      await this.payments.settle(tx, { paymentId: row.paymentId, provider: 'PAYME', providerTransactionId: providerTxId, performedAt, sandbox: row.sandbox })
      await tx.paymentTransaction.update({ where: { id: row.id }, data: { state: 'PERFORMED', providerState: 2, performedAt } })
      return { transaction: String(row.seq), perform_time: performedAt.getTime(), state: 2 }
    })
  }

  private async cancel(params: Record<string, unknown>, sandbox: boolean) {
    const reason = typeof params.reason === 'number' ? params.reason : 10
    return this.prisma.tx(async (tx) => {
      const found = await this.findTx(tx, params, sandbox)
      await this.payments.lockPayment(tx, found.paymentId)
      const row = await tx.paymentTransaction.findFirst({ where: { id: found.id } })
      if (!row) throw new PaymeError(PAYME.TX_NOT_FOUND, M.txNotFound)
      if (row.state === 'CANCELLED') return { transaction: String(row.seq), cancel_time: row.cancelledAt!.getTime(), state: row.providerState }
      const cancelledAt = new Date()
      if (row.state === 'CREATED') {
        await this.cancelCreated(tx, row.id, row.paymentId, reason, cancelledAt)
        return { transaction: String(row.seq), cancel_time: cancelledAt.getTime(), state: -1 }
      }
      // Performed: refund path (state -2). Seats are released and the ledger is reversed.
      const refunded = await this.payments.refundPaid(tx, row.paymentId, `payme-cancel:${reason}`)
      if (!refunded) throw new PaymeError(PAYME.CANNOT_CANCEL, M.cannotCancel)
      await tx.paymentTransaction.update({ where: { id: row.id }, data: { state: 'CANCELLED', providerState: -2, cancelReason: reason, cancelledAt } })
      return { transaction: String(row.seq), cancel_time: cancelledAt.getTime(), state: -2 }
    })
  }

  private async check(params: Record<string, unknown>, sandbox: boolean) {
    const row = await this.findTx(this.prisma.client, params, sandbox)
    return {
      create_time: row.createdAt.getTime(),
      perform_time: row.performedAt?.getTime() ?? 0,
      cancel_time: row.cancelledAt?.getTime() ?? 0,
      transaction: String(row.seq),
      state: row.providerState ?? 1,
      reason: row.cancelReason ?? null,
    }
  }

  private async statement(params: Record<string, unknown>, sandbox: boolean) {
    const from = typeof params.from === 'number' ? BigInt(Math.trunc(params.from)) : 0n
    const to = typeof params.to === 'number' ? BigInt(Math.trunc(params.to)) : BigInt(Date.now())
    const rows = await this.prisma.client.paymentTransaction.findMany({ where: { provider: 'PAYME', providerTime: { gte: from, lte: to }, ...(this.fenced(sandbox) ? { sandbox: true } : {}) }, orderBy: { providerTime: 'asc' } })
    return {
      transactions: rows.map((r) => ({
        id: r.providerTransactionId,
        time: Number(r.providerTime ?? 0n),
        amount: Number(r.amountMinor),
        account: { payment_id: r.paymentId },
        create_time: r.createdAt.getTime(),
        perform_time: r.performedAt?.getTime() ?? 0,
        cancel_time: r.cancelledAt?.getTime() ?? 0,
        transaction: String(r.seq),
        state: r.providerState ?? 1,
        reason: r.cancelReason ?? null,
      })),
    }
  }

  private expired(providerTime: bigint | null): boolean {
    if (providerTime === null) return false
    return Date.now() - Number(providerTime) >= PAYME.TIMEOUT_MS
  }

  private async cancelCreated(tx: Parameters<PaymentsService['cancelPending']>[0], txId: string, paymentId: string, reason: number, at = new Date()) {
    await tx.paymentTransaction.update({ where: { id: txId }, data: { state: 'CANCELLED', providerState: -1, cancelReason: reason, cancelledAt: at } })
    await this.payments.cancelPending(tx, paymentId, `payme-cancel:${reason}`)
  }
}
