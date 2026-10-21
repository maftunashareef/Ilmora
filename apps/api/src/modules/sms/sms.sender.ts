import { Inject, Injectable, Logger } from '@nestjs/common'
import { translate, type TKey } from '@ilmora/shared'
import { decryptString } from '../../common/crypto'
import { ENV, type Env } from '../../config/env'
import { PrismaService } from '../../infra/prisma/prisma.service'
import type { SmsJobData } from '../../infra/queue/queues'
import { TenantContext } from '../../infra/tenancy/tenant-context'
import { SmsProviderFactory } from './sms.provider'

/** Renders the template in the recipient's language and hands it to the configured gateway. Idempotent per message row. */
@Injectable()
export class SmsSender {
  private readonly logger = new Logger(SmsSender.name)

  constructor(private readonly prisma: PrismaService, private readonly providers: SmsProviderFactory, @Inject(ENV) private readonly env: Env) {}

  async deliver(data: SmsJobData, attempt = 0): Promise<void> {
    await TenantContext.forTenant(data.tenantId, async () => {
      const message = await this.prisma.client.smsMessage.findUnique({ where: { id: data.smsMessageId } })
      if (!message || message.status === 'SENT') return
      const secret = data.encryptedVars ? (JSON.parse(decryptString(data.encryptedVars, this.env.OTP_JOB_ENCRYPTION_KEY)) as Record<string, string>) : {}
      const text = translate(data.lang, data.templateKey as TKey, { ...(data.vars ?? {}), ...secret })
      try {
        const result = await this.providers.provider.send(data.phoneE164, text)
        await this.prisma.client.smsMessage.update({
          where: { id: message.id },
          data: { status: 'SENT', sentAt: new Date(), providerMessageId: result.providerMessageId, attempts: { increment: 1 }, error: null },
        })
      } catch (err) {
        await this.prisma.client.smsMessage.update({
          where: { id: message.id },
          data: { status: 'FAILED', attempts: { increment: 1 }, error: String((err as Error).message).slice(0, 300) },
        })
        this.logger.warn(`SMS ${message.id} failed (attempt ${attempt + 1}): ${(err as Error).message}`)
        throw err
      }
    })
  }
}
