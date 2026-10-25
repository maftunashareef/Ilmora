import { Inject, Injectable } from '@nestjs/common'
import { safeEqual } from '../../../common/crypto'
import { ENV, type Env } from '../../../config/env'
import { PrismaService } from '../../../infra/prisma/prisma.service'
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

  /** Returns { sandbox } when the Basic header matches the live key (or the test key outside production). */
  authenticate(authorization: string | undefined): { sandbox: boolean } {
    if (!authorization?.startsWith('Basic ')) throw new PaymeError(PAYME.UNAUTHORIZED, M.unauthorized)
    const decoded = Buffer.from(authorization.slice(6).trim(), 'base64').toString('utf8')
    const sep = decoded.indexOf(':')
    if (sep < 0) throw new PaymeError(PAYME.UNAUTHORIZED, M.unauthorized)
    const login = decoded.slice(0, sep)
    const key = decoded.slice(sep + 1)
    if (!safeEqual(login, this.env.PAYME_LOGIN)) throw new PaymeError(PAYME.UNAUTHORIZED, M.unauthorized)
    if (this.env.PAYME_KEY && safeEqual(key, this.env.PAYME_KEY)) return { sandbox: false }
    if (this.env.PAYME_TEST_KEY && this.env.NODE_ENV !== 'production' && safeEqual(key, this.env.PAYME_TEST_KEY)) return { sandbox: true }
    throw new PaymeError(PAYME.UNAUTHORIZED, M.unauthorized)
  }

  async handle(method: string, params: Record<string, unknown>, sandbox: boolean): Promise<unknown> {
    switch (method) {
      case 'CheckPerformTransaction': return this.checkPerform(params)
      case 'CreateTransaction': return this.create(params, sandbox)
      case 'PerformTransaction': return this.perform(params)
      case 'CancelTransaction': return this.cancel(params)
      case 'CheckTransaction': return this.check(params)
      case 'GetStatement': return this.statement(params)
      default: throw new PaymeError(PAYME.METHOD_NOT_FOUND, M.methodNotFound, method)
    }
  }

  private paymentIdFrom(params: Record<string, unknown>): string {
    const account = params.account as Account | undefined
    const id = account?.payment_id
    if (typeof id !== 'string' || !id) throw new PaymeError(PAYME.ACCOUNT_NOT_FOUND, M.orderNotFound, 'payment_id')
    return id
  }

  private amountFrom(params: Record<string, unknown>): bigint {
    const a = params.amount
    if (typeof a !== 'number' || !Number.isInteger(a) || a <= 0) throw new PaymeError(PAYME.WRONG_AMOUNT, M.wrongAmount)
    return BigInt(a)
  }

  private async checkPerform(params: Record<string, unknown>) {
    const paymentId = this.paymentIdFrom(params)
    const amount = this.amountFrom(params)
    const payment = await this.prisma.client.payment.findFirst({ where: { id: paymentId } })
    if (!payment) throw new PaymeError(PAYME.ACCOUNT_NOT_FOUND, M.orderNotFound, 'payment_id')
    if (payment.state !== 'PENDING' || (payment.expiresAt && payment.expiresAt < new Date())) throw new PaymeError(PAYME.ORDER_NOT_PENDING, M.orderNotPending, 'payment_id')
    if (payment.amountMinor !== amount) throw new PaymeError(PAYME.WRONG_AMOUNT, M.wrongAmount)
    return { allow: true }
  }

  private async create(params: Record<string, unknown>, sandbox: boolean) {
    const providerTxId = String(params.id ?? '')
    const time = typeof params.time === 'number' ? params.time : NaN
    if (!providerTxId || !Number.isFinite(time)) throw new PaymeError(PAYME.INVALID_REQUEST, M.invalidRequest)
    const paymentId = this.paymentIdFrom(params)
    const amount = this.amountFrom(params)

    return this.prisma.tx(async (tx) => {
      const payment = await this.payments.lockPayment(tx, paymentId)
      if (!payment) throw new PaymeError(PAYME.ACCOUNT_NOT_FOUND, M.orderNotFound, 'payment_id')
      const existing = await tx.paymentTransaction.findUnique({ where: { provider_providerTransactionId: { provider: 'PAYME', providerTransactionId: providerTxId } } })
      if (existing) {
        if (existing.paymentId !== payment.id) throw new PaymeError(PAYME.CANNOT_PERFORM, M.cannotPerform)
        if (existing.state === 'CREATED') {
          if (this.expired(existing.providerTime)) {
            await this.cancelCreated(tx, existing.id, payment.id, 4)
            throw new PaymeError(PAYME.CANNOT_PERFORM, M.cannotPerform)
          }
          return { create_time: existing.createdAt.getTime(), transaction: String(existing.seq), state: 1 }
        }
        throw new PaymeError(PAYME.CANNOT_PERFORM, M.cannotPerform)
      }
      if (payment.state !== 'PENDING' || (payment.expiresAt && payment.expiresAt < new Date())) throw new PaymeError(PAYME.ORDER_NOT_PENDING, M.orderNotPending, 'payment_id')
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

  private async perform(params: Record<string, unknown>) {
    const providerTxId = String(params.id ?? '')
    return this.prisma.tx(async (tx) => {
      const found = await tx.paymentTransaction.findUnique({ where: { provider_providerTransactionId: { provider: 'PAYME', providerTransactionId: providerTxId } } })
      if (!found) throw new PaymeError(PAYME.TX_NOT_FOUND, M.txNotFound)
      await this.payments.lockPayment(tx, found.paymentId)
      const row = await tx.paymentTransaction.findFirst({ where: { id: found.id } })
      if (!row) throw new PaymeError(PAYME.TX_NOT_FOUND, M.txNotFound)
      if (row.state === 'PERFORMED') return { transaction: String(row.seq), perform_time: row.performedAt!.getTime(), state: 2 }
      if (row.state !== 'CREATED') throw new PaymeError(PAYME.CANNOT_PERFORM, M.cannotPerform)
      if (this.expired(row.providerTime)) {
        await this.cancelCreated(tx, row.id, row.paymentId, 4)
        throw new PaymeError(PAYME.CANNOT_PERFORM, M.cannotPerform)
      }
      const performedAt = new Date()
      await this.payments.settle(tx, { paymentId: row.paymentId, provider: 'PAYME', providerTransactionId: providerTxId, performedAt })
      await tx.paymentTransaction.update({ where: { id: row.id }, data: { state: 'PERFORMED', providerState: 2, performedAt } })
      return { transaction: String(row.seq), perform_time: performedAt.getTime(), state: 2 }
    })
  }

  private async cancel(params: Record<string, unknown>) {
    const providerTxId = String(params.id ?? '')
    const reason = typeof params.reason === 'number' ? params.reason : 10
    return this.prisma.tx(async (tx) => {
      const found = await tx.paymentTransaction.findUnique({ where: { provider_providerTransactionId: { provider: 'PAYME', providerTransactionId: providerTxId } } })
      if (!found) throw new PaymeError(PAYME.TX_NOT_FOUND, M.txNotFound)
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

  private async check(params: Record<string, unknown>) {
    const row = await this.prisma.client.paymentTransaction.findUnique({ where: { provider_providerTransactionId: { provider: 'PAYME', providerTransactionId: String(params.id ?? '') } } })
    if (!row) throw new PaymeError(PAYME.TX_NOT_FOUND, M.txNotFound)
    return {
      create_time: row.createdAt.getTime(),
      perform_time: row.performedAt?.getTime() ?? 0,
      cancel_time: row.cancelledAt?.getTime() ?? 0,
      transaction: String(row.seq),
      state: row.providerState ?? 1,
      reason: row.cancelReason ?? null,
    }
  }

  private async statement(params: Record<string, unknown>) {
    const from = typeof params.from === 'number' ? BigInt(Math.trunc(params.from)) : 0n
    const to = typeof params.to === 'number' ? BigInt(Math.trunc(params.to)) : BigInt(Date.now())
    const rows = await this.prisma.client.paymentTransaction.findMany({ where: { provider: 'PAYME', providerTime: { gte: from, lte: to } }, orderBy: { providerTime: 'asc' } })
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
