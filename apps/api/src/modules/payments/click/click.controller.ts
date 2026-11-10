import { Controller, HttpCode, Inject, Logger, Post, Req } from '@nestjs/common'
import { SkipThrottle } from '@nestjs/throttler'
import type { Request } from 'express'
import { Public } from '../../../common/decorators'
import { ENV, type Env } from '../../../config/env'
import { PrismaService } from '../../../infra/prisma/prisma.service'
import { TenantContext } from '../../../infra/tenancy/tenant-context'
import { CallbackLogBudget } from '../callback-log-budget'
import { CLICK, type ClickForm, type ClickResponse, ClickService } from './click.service'

/** Click SHOP API callbacks (form-urlencoded in, JSON out). Outside the API prefix and the rate limiter. */
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
    const form = Object.fromEntries(Object.entries((req.body ?? {}) as Record<string, unknown>).map(([k, v]) => [k, v === undefined || v === null ? undefined : String(v)])) as ClickForm
    let response: ClickResponse
    const tenantId = await TenantContext.system(() => this.click.tenantFor(form)).catch(() => null)
    try {
      if (this.env.CLICK_ALLOWED_IPS.length && !this.env.CLICK_ALLOWED_IPS.includes(req.ip ?? '')) response = this.click.reply(form, CLICK.SIGN_FAILED)
      else if (String(form.action) !== String(action)) response = this.click.reply(form, CLICK.ACTION_NOT_FOUND)
      else response = await TenantContext.system(() => (action === 0 ? this.click.prepare(form) : this.click.complete(form)), { tenantId })
    } catch (err) {
      this.logger.error({ err }, 'Click handler failed')
      response = this.click.reply(form, CLICK.UPDATE_FAILED)
    }
    // Not proven to come from Click (bad signature, unknown order): no body in the log, and only within the budget.
    const proven = tenantId !== null && response.error !== CLICK.SIGN_FAILED
    if (proven) await this.log(tenantId, action, form, response, req.ip, started)
    else if (this.budget.allow(req.ip)) await this.log(null, action, {} as ClickForm, response, req.ip, started)
    return response
  }

  private async log(tenantId: string | null, action: 0 | 1, form: ClickForm, response: ClickResponse, ip: string | undefined, started: number) {
    try {
      const { sign_string: _s, ...rest } = form
      void _s
      await TenantContext.system(() =>
        this.prisma.client.providerCallbackLog.create({
          data: {
            tenantId, provider: 'CLICK', method: action === 0 ? 'prepare' : 'complete', providerTransactionId: form.click_trans_id ?? null, paymentId: form.merchant_trans_id ?? null,
            payload: rest as object, responseCode: response.error, outcome: response.error === 0 ? 'ok' : `error:${response.error}`, ip, processedAt: new Date(), durationMs: Date.now() - started,
          },
        }),
      )
    } catch (err) {
      this.logger.warn(`callback log failed: ${(err as Error).message}`)
    }
  }
}
