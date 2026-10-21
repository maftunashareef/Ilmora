import { Inject, Injectable, Logger } from '@nestjs/common'
import { maskPhone } from '@ilmora/shared'
import { ENV, type Env } from '../../config/env'

export interface SmsSendResult { providerMessageId?: string }

export interface SmsProvider {
  readonly name: string
  send(phoneE164: string, text: string): Promise<SmsSendResult>
}

/** Development provider: logs a masked line only; the message text (which may hold a code) is never written to logs. */
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'console'
  private readonly logger = new Logger('SMS')
  async send(phoneE164: string, text: string): Promise<SmsSendResult> {
    this.logger.log(`[console] to ${maskPhone(phoneE164)} (${text.length} chars)`)
    return { providerMessageId: `console-${Date.now()}` }
  }
}

/** Generic JSON gateway: POST { to, text, from } with a bearer token. */
export class HttpSmsProvider implements SmsProvider {
  readonly name = 'http'
  constructor(private readonly url: string, private readonly token: string | undefined, private readonly from: string) {}
  async send(phoneE164: string, text: string): Promise<SmsSendResult> {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(this.token ? { authorization: `Bearer ${this.token}` } : {}) },
      body: JSON.stringify({ to: phoneE164, text, from: this.from }),
      signal: AbortSignal.timeout(10_000),
    })
    if (!res.ok) throw new Error(`SMS gateway responded ${res.status}`)
    const body = (await res.json().catch(() => ({}))) as { id?: string; message_id?: string }
    return { providerMessageId: body.id ?? body.message_id }
  }
}

/**
 * Eskiz (notify.eskiz.uz): token login, then form-encoded send. Token is cached and refreshed on 401.
 * Field names follow Eskiz's public API; verify against the current provider documentation before go-live.
 */
export class EskizSmsProvider implements SmsProvider {
  readonly name = 'eskiz'
  private token?: string
  constructor(private readonly baseUrl: string, private readonly email: string, private readonly password: string, private readonly from: string) {}

  private async login(): Promise<string> {
    const form = new URLSearchParams({ email: this.email, password: this.password })
    const res = await fetch(`${this.baseUrl}/auth/login`, { method: 'POST', body: form, signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`Eskiz login failed: ${res.status}`)
    const body = (await res.json()) as { data?: { token?: string } }
    if (!body.data?.token) throw new Error('Eskiz login returned no token')
    this.token = body.data.token
    return this.token
  }

  async send(phoneE164: string, text: string, retry = true): Promise<SmsSendResult> {
    const token = this.token ?? (await this.login())
    const form = new URLSearchParams({ mobile_phone: phoneE164.replace('+', ''), message: text, from: this.from })
    const res = await fetch(`${this.baseUrl}/message/sms/send`, { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: form, signal: AbortSignal.timeout(10_000) })
    if (res.status === 401 && retry) {
      this.token = undefined
      return this.send(phoneE164, text, false)
    }
    if (!res.ok) throw new Error(`Eskiz send failed: ${res.status}`)
    const body = (await res.json().catch(() => ({}))) as { id?: string; message_id?: string }
    return { providerMessageId: body.id ?? body.message_id }
  }
}

@Injectable()
export class SmsProviderFactory {
  readonly provider: SmsProvider
  constructor(@Inject(ENV) env: Env) {
    if (env.SMS_PROVIDER === 'eskiz') {
      if (!env.ESKIZ_EMAIL || !env.ESKIZ_PASSWORD) throw new Error('SMS_PROVIDER=eskiz requires ESKIZ_EMAIL and ESKIZ_PASSWORD')
      this.provider = new EskizSmsProvider(env.ESKIZ_BASE_URL, env.ESKIZ_EMAIL, env.ESKIZ_PASSWORD, env.SMS_SENDER)
    } else if (env.SMS_PROVIDER === 'http') {
      if (!env.SMS_HTTP_URL) throw new Error('SMS_PROVIDER=http requires SMS_HTTP_URL')
      this.provider = new HttpSmsProvider(env.SMS_HTTP_URL, env.SMS_HTTP_TOKEN, env.SMS_SENDER)
    } else {
      this.provider = new ConsoleSmsProvider()
    }
  }
}
