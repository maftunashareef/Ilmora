import { All, Controller, Headers, HttpCode, Inject, Logger, Req, Res } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import type { Request, Response } from 'express'
import { Public } from '../../../common/decorators'
import { ENV, type Env } from '../../../config/env'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { TenantContext } from '../../../infra/tenancy/tenant-context'
import { CallbackLogBudget } from '../callback-log-budget'
import { PAYME, PaymeError, PaymeService } from './payme.service'

/**
 * JSON-RPC endpoint called by Payme Business (POST /payments/payme, outside the API prefix).
 * Always answers HTTP 200 with either `result` or `error` and echoes the request id.
 */
@Controller('payments/payme')
@Public()
@SkipThrottle()
export class PaymeController {
  private readonly logger = new Logger(PaymeController.name)
  private readonly budget = new CallbackLogBudget()

  constructor(private readonly payme: PaymeService, private readonly prisma: PrismaService, @Inject(ENV) private readonly env: Env) {}

  @All()
  @HttpCode(200)
  async rpc(@Req() req: Request, @Res() res: Response, @Headers('authorization') authorization?: string) {
    const started = Date.now()
    const body = (req.body ?? {}) as { method?: unknown; params?: unknown; id?: unknown }
    const id = typeof body.id === 'number' || typeof body.id === 'string' ? body.id : null
    let outcome = 'ok'
    let code: number | undefined
    let payload: unknown
    let proven = false

    try {
      if (req.method !== 'POST') throw new PaymeError(PAYME.NOT_POST, { ru: 'Метод запроса должен быть POST', uz: 'So‘rov POST bo‘lishi kerak', en: 'Request method must be POST' })
      if (this.env.PAYME_ALLOWED_IPS.length && !this.env.PAYME_ALLOWED_IPS.includes(req.ip ?? '')) {
        throw new PaymeError(PAYME.UNAUTHORIZED, { ru: 'Недостаточно привилегий', uz: 'Huquq yetarli emas', en: 'Insufficient privileges' })
      }
      const { sandbox } = this.payme.authenticate(authorization)
      proven = true
      if (typeof body.method !== 'string' || (body.params !== undefined && (typeof body.params !== 'object' || body.params === null))) {
        throw new PaymeError(PAYME.INVALID_REQUEST, { ru: 'Неверный запрос', uz: 'Noto‘g‘ri so‘rov', en: 'Invalid request' })
      }
      const params = (body.params ?? {}) as Record<string, unknown>
      // Provider callbacks are not bound to a user session: resolve the tenant from the payment they reference.
      const tenantId = await this.tenantFor(params)
      const result = await TenantContext.system(() => this.payme.handle(body.method as string, params, sandbox), { tenantId })
      payload = { result, id }
      await this.log(tenantId, body.method as string, params, 'ok', 0, req.ip, started)
    } catch (err) {
      const e = err instanceof PaymeError ? err : new PaymeError(PAYME.INTERNAL, { ru: 'Внутренняя ошибка', uz: 'Ichki xatolik', en: 'Internal error' })
      if (!(err instanceof PaymeError)) this.logger.error({ err }, 'Payme handler failed')
      code = e.code
      outcome = `error:${e.code}`
      payload = { error: { code: e.code, message: e.messages, data: e.data }, id }
      // Not from Payme (no valid password): the method, the address and the code only, and not more than the budget allows.
      if (proven) await this.log(await this.tenantFor((body.params ?? {}) as Record<string, unknown>).catch(() => null), String(body.method ?? ''), (body.params ?? {}) as Record<string, unknown>, outcome, code, req.ip, started)
      else if (this.budget.allow(req.ip)) await this.log(null, typeof body.method === 'string' ? body.method : '', {}, outcome, code, req.ip, started)
    }
    res.status(200).type('application/json').send(JSON.stringify(payload))
  }

  private async tenantFor(params: Record<string, unknown>): Promise<string | null> {
    const account = params.account as { payment_id?: unknown } | undefined
    const paymentId = typeof account?.payment_id === 'string' ? account.payment_id : undefined
    const providerTxId = typeof params.id === 'string' ? params.id : undefined
    return TenantContext.system(async () => {
      if (paymentId) {
        const p = await this.prisma.client.payment.findFirst({ where: { id: paymentId }, select: { tenantId: true } })
        if (p) return p.tenantId
      }
      if (providerTxId) {
        const t = await this.prisma.client.paymentTransaction.findUnique({ where: { provider_providerTransactionId: { provider: 'PAYME', providerTransactionId: providerTxId } }, select: { tenantId: true } })
        if (t) return t.tenantId
      }
      return null
    })
  }

  private async log(tenantId: string | null, method: string, params: Record<string, unknown>, outcome: string, responseCode: number | undefined, ip: string | undefined, started: number) {
    try {
      const { account, ...rest } = params
      await TenantContext.system(() =>
        this.prisma.client.providerCallbackLog.create({
          data: {
            tenantId, provider: 'PAYME', method: method.slice(0, 40), providerTransactionId: typeof params.id === 'string' ? params.id : null,
            paymentId: typeof (account as { payment_id?: unknown } | undefined)?.payment_id === 'string' ? ((account as { payment_id: string }).payment_id) : null,
            payload: { ...rest, account: account ? { payment_id: (account as { payment_id?: unknown }).payment_id } : undefined } as object,
            responseCode: responseCode ?? 0, outcome, ip, processedAt: new Date(), durationMs: Date.now() - started,
          },
        }),
      )
    } catch (err) {
      this.logger.warn(`callback log failed: ${(err as Error).message}`)
    }
  }
}
