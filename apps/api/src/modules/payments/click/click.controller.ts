import { Controller, HttpCode, Inject, Logger, Post, Req } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import type { Request } from 'express'
import { Public } from '../../../common/decorators'
import { ENV, type Env } from '../../../config/env'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { TenantContext } from '../../../infra/tenancy/tenant-context'
import { CallbackLogBudget } from '../callback-log-budget'
import { CLICK, type ClickForm, type ClickResponse, ClickService } from './click.service'

/**
 * Click SHOP API callbacks (form-urlencoded in, JSON out): POST /payments/click/prepare and /payments/click/complete,
 * outside the API prefix and the rate limiter. Without the full Click settings nothing reaches the database.
 */
@Controller('payments/click')
@Public()
@SkipThrottle()
export class ClickController {
  private readonly logger = new Logger(ClickController.name)
  private readonly budget = new CallbackLogBudget()

  constructor(private readonly click: ClickService, private readonly prisma: PrismaService, @Inject(ENV) private readonly env: Env) {}

  @Post('prepare')
  @HttpCode(200)
  prepare(@Req() req: Request) {
    return this.run(req, 0)
  }

  @Post('complete')
  @HttpCode(200)
  complete(@Req() req: Request) {
    return this.run(req, 1)
  }

  private async run(req: Request, action: 0 | 1): Promise<ClickResponse> {
    const started = Date.now()
    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {}
    // Only plain values: a repeated or nested field is not a Click request.
    const form = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, typeof v === 'string' || typeof v === 'number' ? String(v).trim() : undefined])) as ClickForm
    let response: ClickResponse
    let tenantId: string | null = null
    try {
      // Security review №5: Click off (or set up partly) answers every call the same, without looking up any invoice.
      if (!this.click.configured()) response = this.click.reply(form, CLICK.BAD_REQUEST)
      else if (this.env.CLICK_ALLOWED_IPS.length && !this.env.CLICK_ALLOWED_IPS.includes(req.ip ?? '')) response = this.click.reply(form, CLICK.SIGN_FAILED)
      else if (form.action !== String(action)) response = this.click.reply(form, CLICK.ACTION_NOT_FOUND)
      else {
        tenantId = await TenantContext.system(() => this.click.tenantFor(form)).catch(() => null)
        response = await TenantContext.system(() => (action === 0 ? this.click.prepare(form) : this.click.complete(form)), { tenantId })
      }
    } catch (err) {
      this.logger.error({ err }, 'Click handler failed')
      response = this.click.reply(form, CLICK.UPDATE_FAILED)
    }
    // Not proven to come from Click (bad signature, unknown invoice, Click off): no body in the log, within the budget only.
    const proven = tenantId !== null && response.error !== CLICK.SIGN_FAILED && response.error !== CLICK.BAD_REQUEST
    if (proven) await this.log(tenantId, action, form, response, req.ip, started)
    else if (this.budget.allow(req.ip)) await this.log(null, action, {}, response, req.ip, started)
    return response
  }

  private async log(tenantId: string | null, action: 0 | 1, form: ClickForm, response: ClickResponse, ip: string | undefined, started: number) {
    try {
      // The fields Click sends are ids, the amount and the time — no personal data; the signature is not kept.
      const { sign_string: _s, ...rest } = form
      void _s
      await TenantContext.system(() =>
        this.prisma.client.providerCallbackLog.create({
          data: {
            tenantId, provider: 'CLICK', method: action === 0 ? 'prepare' : 'complete', providerTransactionId: form.click_trans_id?.slice(0, 64) ?? null, paymentId: form.merchant_trans_id?.slice(0, 64) ?? null,
            payload: rest as object, responseCode: response.error, outcome: response.error === 0 ? 'ok' : `error:${response.error}`, ip, processedAt: new Date(), durationMs: Date.now() - started,
          },
        }),
      )
    } catch (err) {
      this.logger.warn(`callback log failed: ${(err as Error).message}`)
    }
  }
}
