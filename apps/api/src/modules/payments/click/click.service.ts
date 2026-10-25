import { Inject, Injectable } from '@nestjs/common'
import { createHash } from 'node:crypto'
import { somToTiyin } from '@ilmora/shared'
import { safeEqual } from '../../../common/crypto'
import { ENV, type Env } from '../../../config/env'
import { PrismaService } from '../../../infra/prisma/prisma.service'
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

/** Click Prepare/Complete handling. merchant_trans_id = our Payment id; merchant_prepare_id = transaction seq. */
@Injectable()
export class ClickService {
  constructor(private readonly prisma: PrismaService, private readonly payments: PaymentsService, @Inject(ENV) private readonly env: Env) {}

  reply(form: ClickForm, error: number, extra: Partial<ClickResponse> = {}): ClickResponse {
    return { click_trans_id: Number(form.click_trans_id ?? 0), merchant_trans_id: form.merchant_trans_id ?? '', error, error_note: NOTE[error] ?? 'Error', ...extra }
  }

  /** Signature uses the raw received string values, concatenated in the documented order (MD5). */
  verifySign(form: ClickForm, action: 0 | 1): boolean {
    const secret = this.env.CLICK_SECRET_KEY ?? ''
    const parts = action === 0
      ? [form.click_trans_id, form.service_id, secret, form.merchant_trans_id, form.amount, form.action, form.sign_time]
      : [form.click_trans_id, form.service_id, secret, form.merchant_trans_id, form.merchant_prepare_id, form.amount, form.action, form.sign_time]
    if (parts.some((p) => p === undefined)) return false
    const expected = md5(parts.join(''))
    return safeEqual(expected, String(form.sign_string ?? '').toLowerCase())
  }

  /** Tenant resolution for the callback log and the data layer. */
  async tenantFor(form: ClickForm): Promise<string | null> {
    if (!form.merchant_trans_id) return null
    const p = await this.prisma.client.payment.findFirst({ where: { id: form.merchant_trans_id }, select: { tenantId: true } })
    return p?.tenantId ?? null
  }

  async prepare(form: ClickForm): Promise<ClickResponse> {
    if (!form.click_trans_id || !form.merchant_trans_id || !form.amount || !form.service_id) return this.reply(form, CLICK.BAD_REQUEST)
    if (form.service_id !== this.env.CLICK_SERVICE_ID) return this.reply(form, CLICK.BAD_REQUEST)
    if (!this.verifySign(form, 0)) return this.reply(form, CLICK.SIGN_FAILED)
    let amount: bigint
    try {
      amount = somToTiyin(form.amount)
    } catch {
      return this.reply(form, CLICK.WRONG_AMOUNT)
    }
    return this.prisma.tx(async (tx) => {
      const payment = await this.payments.lockPayment(tx, form.merchant_trans_id!)
      if (!payment) return this.reply(form, CLICK.ORDER_NOT_FOUND)
      if (payment.state === 'PAID') return this.reply(form, CLICK.ALREADY_PAID)
      if (payment.state !== 'PENDING' || (payment.expiresAt && payment.expiresAt < new Date())) return this.reply(form, CLICK.CANCELLED)
      if (payment.amountMinor !== amount) return this.reply(form, CLICK.WRONG_AMOUNT)
      const existing = await tx.paymentTransaction.findUnique({ where: { provider_providerTransactionId: { provider: 'CLICK', providerTransactionId: form.click_trans_id! } } })
      if (existing) {
        if (existing.state === 'CANCELLED') return this.reply(form, CLICK.CANCELLED)
        return this.reply(form, CLICK.OK, { merchant_prepare_id: existing.seq })
      }
      const created = await tx.paymentTransaction.create({
        data: {
          tenantId: payment.tenantId, paymentId: payment.id, provider: 'CLICK', providerTransactionId: form.click_trans_id!, providerState: 0, state: 'CREATED',
          amountMinor: amount, currency: payment.currency, providerTime: BigInt(Date.now()),
        },
      })
      await tx.paymentTransaction.update({ where: { id: created.id }, data: { merchantPrepareId: String(created.seq) } })
      return this.reply(form, CLICK.OK, { merchant_prepare_id: created.seq })
    })
  }

  async complete(form: ClickForm): Promise<ClickResponse> {
    if (!form.click_trans_id || !form.merchant_trans_id || !form.merchant_prepare_id || !form.amount || !form.service_id) return this.reply(form, CLICK.BAD_REQUEST)
    if (form.service_id !== this.env.CLICK_SERVICE_ID) return this.reply(form, CLICK.BAD_REQUEST)
    if (!this.verifySign(form, 1)) return this.reply(form, CLICK.SIGN_FAILED)
    const providerError = Number(form.error ?? 0)
    return this.prisma.tx(async (tx) => {
      const found = await tx.paymentTransaction.findUnique({ where: { provider_providerTransactionId: { provider: 'CLICK', providerTransactionId: form.click_trans_id! } } })
      if (!found) return this.reply(form, CLICK.TX_NOT_FOUND)
      if (String(found.seq) !== String(form.merchant_prepare_id) || found.paymentId !== form.merchant_trans_id) return this.reply(form, CLICK.TX_NOT_FOUND)
      await this.payments.lockPayment(tx, found.paymentId)
      const row = (await tx.paymentTransaction.findFirst({ where: { id: found.id } }))!
      if (row.state === 'PERFORMED') return this.reply(form, CLICK.ALREADY_PAID, { merchant_confirm_id: row.seq })
      if (row.state === 'CANCELLED') return this.reply(form, CLICK.CANCELLED)
      if (providerError < 0) {
        // Click reports the payment failed/cancelled on its side: void our reservation and answer -9.
        await tx.paymentTransaction.update({ where: { id: row.id }, data: { state: 'CANCELLED', providerState: providerError, cancelReason: providerError, cancelledAt: new Date() } })
        await this.payments.cancelPending(tx, row.paymentId, `click-error:${providerError}`)
        return this.reply(form, CLICK.CANCELLED)
      }
      let amount: bigint
      try {
        amount = somToTiyin(form.amount!)
      } catch {
        return this.reply(form, CLICK.WRONG_AMOUNT)
      }
      if (row.amountMinor !== amount) return this.reply(form, CLICK.WRONG_AMOUNT)
      const performedAt = new Date()
      const payment = await tx.payment.findFirst({ where: { id: row.paymentId } })
      if (payment?.state === 'PAID') {
        await tx.paymentTransaction.update({ where: { id: row.id }, data: { state: 'PERFORMED', providerState: 1, performedAt } })
        return this.reply(form, CLICK.ALREADY_PAID, { merchant_confirm_id: row.seq })
      }
      if (payment?.state !== 'PENDING') {
        // The money was debited but the order can no longer be fulfilled: per Click's rules answer success and refund
        // through the Merchant API (payment/reversal); the outbox event makes the refund visible to finance admins.
        await tx.paymentTransaction.update({ where: { id: row.id }, data: { state: 'PERFORMED', providerState: 1, performedAt } })
        await tx.outboxEvent.upsert({
          where: { dedupeKey: `click-refund:${row.id}` },
          create: { tenantId: row.tenantId, type: 'payment.refund_required', dedupeKey: `click-refund:${row.id}`, payload: { paymentId: row.paymentId, clickTransId: form.click_trans_id, reason: 'payment_not_pending' } },
          update: {},
        })
        return this.reply(form, CLICK.OK, { merchant_confirm_id: row.seq })
      }
      await this.payments.settle(tx, { paymentId: row.paymentId, provider: 'CLICK', providerTransactionId: row.providerTransactionId, performedAt })
      await tx.paymentTransaction.update({ where: { id: row.id }, data: { state: 'PERFORMED', providerState: 1, performedAt } })
      return this.reply(form, CLICK.OK, { merchant_confirm_id: row.seq })
    })
  }

  /** Merchant API GET payment/status for reconciliation. Returns null when Click is not configured. */
  async fetchProviderStatus(clickPaymentId: string): Promise<{ payment_status?: number; error_code?: number; error_note?: string } | null> {
    if (!this.env.CLICK_MERCHANT_USER_ID || !this.env.CLICK_SECRET_KEY || !this.env.CLICK_SERVICE_ID) return null
    const timestamp = Math.floor(Date.now() / 1000)
    const digest = createHash('sha1').update(`${timestamp}${this.env.CLICK_SECRET_KEY}`).digest('hex')
    const res = await fetch(`${this.env.CLICK_API_URL.replace(/\/$/, '')}/payment/status/${this.env.CLICK_SERVICE_ID}/${encodeURIComponent(clickPaymentId)}`, {
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', Auth: `${this.env.CLICK_MERCHANT_USER_ID}:${digest}:${timestamp}` },
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) return { error_code: res.status, error_note: `HTTP ${res.status}` }
    return (await res.json()) as { payment_status?: number; error_code?: number; error_note?: string }
  }
}
