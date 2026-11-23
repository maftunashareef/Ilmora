import { Inject, Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { somToTiyin } from '@ilmora/shared'
import { safeEqual } from '../../../common/crypto'
import { clickConfigured, ENV, type Env } from '../../../config/env'
import type { PaymentState } from '../../../generated/prisma/enums'
import { PrismaService, type TransactionClient } from '../../../infra/prisma/prisma.service'
import { PaymentsService } from '../payments.service'

/** Click SHOP API error codes (docs/payments/click-shop-api.md §4). */
export const CLICK = {
  OK: 0,
  SIGN_FAILED: -1,
  WRONG_AMOUNT: -2,
  ACTION_NOT_FOUND: -3,
  ALREADY_PAID: -4,
  ORDER_NOT_FOUND: -5,
  TX_NOT_FOUND: -6,
  UPDATE_FAILED: -7,
  BAD_REQUEST: -8,
  CANCELLED: -9,
} as const

const NOTE: Record<number, string> = {
  0: 'Success',
  [-1]: 'SIGN CHECK FAILED!',
  [-2]: 'Incorrect parameter amount',
  [-3]: 'Action not found',
  [-4]: 'Already paid',
  [-5]: 'User does not exist',
  [-6]: 'Transaction does not exist',
  [-7]: 'Failed to update user',
  [-8]: 'Error in request from click',
  [-9]: 'Transaction cancelled',
}

/**
 * `providerState` of a Click row: 0 — Prepare accepted; 1 — Click reported the payment complete (it debits before
 * Complete); a negative number — Click's own error from a failed Complete.
 */
export const CLICK_STATE = { PREPARED: 0, COMPLETED: 1 } as const

export interface ClickResponse {
  click_trans_id: number | string
  merchant_trans_id: string
  merchant_prepare_id?: number
  merchant_confirm_id?: number
  error: number
  error_note: string
}

export type ClickForm = Record<string, string | undefined>

const md5 = (s: string) => createHash('md5').update(s, 'utf8').digest('hex')
const DIGITS = /^\d{1,20}$/

/**
 * Click Prepare/Complete handling. merchant_trans_id = our Payment id; merchant_prepare_id = merchant_confirm_id = the
 * transaction's seq. Every state change runs in a transaction holding the Payment row lock, as Payme's does, and money is
 * booked only through PaymentsService.settle — one path for every provider.
 */
@Injectable()
export class ClickService {
  constructor(private readonly prisma: PrismaService, private readonly payments: PaymentsService, @Inject(ENV) private readonly env: Env) {}

  /** Click takes part only with the service id, the merchant id and the secret all set (security review №5). */
  configured(): boolean {
    return clickConfigured(this.env)
  }

  reply(form: ClickForm, error: number, extra: Partial<ClickResponse> = {}): ClickResponse {
    const id = Number(form.click_trans_id ?? 0)
    return { click_trans_id: Number.isSafeInteger(id) ? id : String(form.click_trans_id), merchant_trans_id: form.merchant_trans_id ?? '', error, error_note: NOTE[error] ?? 'Error', ...extra }
  }

  /**
   * MD5 of the received values as they came, in the documented order. Never computed without the secret: with Click not
   * fully configured every signature fails (security review №5 — an empty secret let anyone sign).
   */
  verifySign(form: ClickForm, action: 0 | 1): boolean {
    const secret = this.env.CLICK_SECRET_KEY
    if (!this.configured() || !secret) return false
    const parts = action === 0
      ? [form.click_trans_id, form.service_id, secret, form.merchant_trans_id, form.amount, form.action, form.sign_time]
      : [form.click_trans_id, form.service_id, secret, form.merchant_trans_id, form.merchant_prepare_id, form.amount, form.action, form.sign_time]
    if (parts.some((p) => p === undefined || p === '')) return false
    return safeEqual(md5(parts.join('')), String(form.sign_string ?? '').toLowerCase())
  }

  /** -8 for a request that cannot be read: a field missing or of the wrong shape, or another service's call. */
  private malformed(form: ClickForm, action: 0 | 1): boolean {
    if (!form.click_trans_id || !DIGITS.test(form.click_trans_id)) return true
    if (!form.merchant_trans_id || form.merchant_trans_id.length > 64) return true
    if (!form.amount || !form.sign_time || !form.sign_string || !form.service_id) return true
    if (action === 1 && (!form.merchant_prepare_id || !DIGITS.test(form.merchant_prepare_id))) return true
    return !safeEqual(form.service_id, this.env.CLICK_SERVICE_ID ?? '')
  }

  /** The amount in tiyin, exactly («1000.00» → 100000); null when it is not a positive amount of so'm with ≤ 2 decimals. */
  private amountOf(form: ClickForm): bigint | null {
    try {
      const a = somToTiyin(form.amount ?? '')
      return a > 0n ? a : null
    } catch {
      return null
    }
  }

  /** Tenant resolution for the callback log and the data layer. */
  async tenantFor(form: ClickForm): Promise<string | null> {
    if (!form.merchant_trans_id) return null
    const p = await this.prisma.client.payment.findFirst({ where: { id: form.merchant_trans_id }, select: { tenantId: true } })
    return p?.tenantId ?? null
  }

  /** The invoice can still be paid: pending, inside its seat hold, nothing closed since the order. */
  private async payable(tx: TransactionClient, payment: { id: string; state: PaymentState; subscriptionId: string; periodStart: Date; periodEnd: Date; expiresAt: Date | null }): Promise<boolean> {
    if (payment.expiresAt && payment.expiresAt < new Date()) return false
    return (await this.payments.settleBlocker(tx, payment)) === null
  }

  async prepare(form: ClickForm): Promise<ClickResponse> {
    if (this.malformed(form, 0)) return this.reply(form, CLICK.BAD_REQUEST)
    if (!this.verifySign(form, 0)) return this.reply(form, CLICK.SIGN_FAILED)
    const amount = this.amountOf(form)
    if (amount === null) return this.reply(form, CLICK.WRONG_AMOUNT)
    const clickTransId = form.click_trans_id!
    return this.prisma.tx(async (tx) => {
      const payment = await this.payments.lockPayment(tx, form.merchant_trans_id!)
      if (!payment) return this.reply(form, CLICK.ORDER_NOT_FOUND)
      const existing = await tx.paymentTransaction.findUnique({ where: { provider_providerTransactionId: { provider: 'CLICK', providerTransactionId: clickTransId } } })
      if (existing) {
        // A repeated Prepare of the same attempt gets the same answer — for the same invoice and amount only.
        if (existing.paymentId !== payment.id) return this.reply(form, CLICK.BAD_REQUEST)
        if (existing.amountMinor !== amount) return this.reply(form, CLICK.WRONG_AMOUNT)
        if (existing.state === 'PERFORMED' || payment.state === 'PAID') return this.reply(form, CLICK.ALREADY_PAID)
        if (existing.state !== 'CREATED' || !(await this.payable(tx, payment))) return this.reply(form, CLICK.CANCELLED)
        return this.reply(form, CLICK.OK, { merchant_prepare_id: existing.seq })
      }
      if (payment.state === 'PAID') return this.reply(form, CLICK.ALREADY_PAID)
      // Hold expired, invoice cancelled, subscription closed, the month paid by another invoice: no debit at all.
      if (!(await this.payable(tx, payment))) return this.reply(form, CLICK.CANCELLED)
      if (payment.amountMinor !== amount) return this.reply(form, CLICK.WRONG_AMOUNT)
      // Security review 10.11 №6: another attempt already runs on the invoice — a second Click tab, or Payme. Refused, so
      // the card is not debited twice for one invoice.
      if (await this.payments.inProgress(tx, payment.id)) return this.reply(form, CLICK.CANCELLED)
      const created = await tx.paymentTransaction.create({
        data: {
          tenantId: payment.tenantId, paymentId: payment.id, provider: 'CLICK', providerTransactionId: clickTransId, providerState: CLICK_STATE.PREPARED, state: 'CREATED',
          amountMinor: amount, currency: payment.currency, providerTime: BigInt(Date.now()),
        },
      })
      await tx.paymentTransaction.update({ where: { id: created.id }, data: { merchantPrepareId: String(created.seq) } })
      return this.reply(form, CLICK.OK, { merchant_prepare_id: created.seq })
    })
  }

  async complete(form: ClickForm): Promise<ClickResponse> {
    if (this.malformed(form, 1)) return this.reply(form, CLICK.BAD_REQUEST)
    if (!this.verifySign(form, 1)) return this.reply(form, CLICK.SIGN_FAILED)
    const amount = this.amountOf(form)
    if (amount === null) return this.reply(form, CLICK.WRONG_AMOUNT)
    const rawError = (form.error ?? '0').trim() || '0'
    if (!/^-?\d{1,9}$/.test(rawError)) return this.reply(form, CLICK.BAD_REQUEST)
    const clickError = Number(rawError)
    return this.prisma.tx(async (tx) => {
      const found = await tx.paymentTransaction.findUnique({ where: { provider_providerTransactionId: { provider: 'CLICK', providerTransactionId: form.click_trans_id! } } })
      if (!found || String(found.seq) !== form.merchant_prepare_id || found.paymentId !== form.merchant_trans_id) return this.reply(form, CLICK.TX_NOT_FOUND)
      const payment = await this.payments.lockPayment(tx, found.paymentId)
      const row = (await tx.paymentTransaction.findFirst({ where: { id: found.id } }))!
      if (row.amountMinor !== amount) return this.reply(form, CLICK.WRONG_AMOUNT)
      // A repeated Complete of a performed attempt: «already paid», as Click's rules say — no second booking.
      if (row.state === 'PERFORMED') return this.reply(form, CLICK.ALREADY_PAID, { merchant_confirm_id: row.seq })
      if (row.state !== 'CREATED') {
        // The attempt was closed here (abandoned after CLICK_PENDING_MINUTES, its hold expired, or Click failed it
        // earlier). «Cancelled» is the answer Click's rules allow; if Click says it debited the card, the row is marked so
        // the reconciliation asks finance to make sure in the Click cabinet that the money went back.
        if (clickError >= 0 && row.providerState !== CLICK_STATE.COMPLETED) await tx.paymentTransaction.update({ where: { id: row.id }, data: { providerState: CLICK_STATE.COMPLETED } })
        return this.reply(form, CLICK.CANCELLED)
      }
      if (clickError < 0) {
        // Click failed the payment on its side (declined card, not enough money): nothing was taken. Only this attempt
        // closes; the invoice stays open inside its hold, so the student can try again or pay with Payme.
        await tx.paymentTransaction.update({ where: { id: row.id }, data: { state: 'CANCELLED', providerState: clickError, cancelReason: clickError, cancelledAt: new Date() } })
        return this.reply(form, CLICK.CANCELLED)
      }
      const performedAt = new Date()
      const blocker = payment ? await this.payments.settleBlocker(tx, payment) : 'payment_not_pending'
      if (blocker) {
        // Click has already debited the card, but the invoice can no longer be fulfilled (its subscription closed, the
        // month paid by another invoice). Click's rules: answer success and return the money (cabinet or payment/reversal).
        // The row stays performed without settling, so the reconciliation shows «refund_required» (security review №6).
        await tx.paymentTransaction.update({ where: { id: row.id }, data: { state: 'PERFORMED', providerState: CLICK_STATE.COMPLETED, performedAt } })
        await tx.outboxEvent.upsert({
          where: { dedupeKey: `click-refund:${row.id}` },
          create: { tenantId: row.tenantId, type: 'payment.refund_required', dedupeKey: `click-refund:${row.id}`, payload: { paymentId: row.paymentId, provider: 'CLICK', clickTransId: row.providerTransactionId, reason: blocker, paymentState: payment?.state ?? null } },
          update: {},
        })
        return this.reply(form, CLICK.OK, { merchant_confirm_id: row.seq })
      }
      await this.payments.settle(tx, { paymentId: row.paymentId, provider: 'CLICK', providerTransactionId: row.providerTransactionId, performedAt })
      await tx.paymentTransaction.update({ where: { id: row.id }, data: { state: 'PERFORMED', providerState: CLICK_STATE.COMPLETED, performedAt } })
      return this.reply(form, CLICK.OK, { merchant_confirm_id: row.seq })
    })
  }
}
