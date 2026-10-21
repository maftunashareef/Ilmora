import { Inject, Injectable, Logger } from '@nestjs/common'
import * as argon2 from 'argon2'
import { encryptString, randomDigits } from '../../common/crypto'
import { AppError } from '../../common/errors'
import { ENV, type Env } from '../../config/env'
import { normalizeUzPhone, maskPhone } from '@ilmora/shared'
import { PrismaService } from '../../infra/prisma/prisma.service'
import { RedisService } from '../../infra/redis/redis.service'
import { SmsService } from '../sms/sms.service'

export interface OtpRequestResult {
  expiresInSeconds: number
  /** Present only in development with the console SMS provider. */
  devCode?: string
}

const ARGON = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const

/** One-time login codes: hashed at rest, limited per phone and per attempt, delivered through the SMS queue. */
@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name)
  private readonly memoryWindow = new Map<string, { count: number; expires: number }>()

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly sms: SmsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  normalize(phone: string): string {
    const parsed = normalizeUzPhone(phone)
    if (!parsed.ok) throw AppError.invalid('invalid_phone', 'Enter a valid Uzbek phone number (+998 XX XXX XX XX)')
    return parsed.e164
  }

  async request(tenantId: string, phoneInput: string, lang: 'uz' | 'ru' | 'en', meta: { ip?: string }): Promise<OtpRequestResult> {
    const phone = this.normalize(phoneInput)
    await this.enforcePhoneWindow(tenantId, phone)

    const code = randomDigits(this.env.OTP_LENGTH)
    const codeHash = await argon2.hash(code, ARGON)
    const expiresAt = new Date(Date.now() + this.env.OTP_TTL_SECONDS * 1000)
    await this.prisma.client.otpCode.create({
      data: { tenantId, phoneE164: phone, codeHash, expiresAt, maxAttempts: this.env.OTP_MAX_ATTEMPTS, ip: meta.ip },
    })
    await this.sms.enqueue({
      tenantId,
      phoneE164: phone,
      templateKey: 'sms.otp',
      lang,
      secretVars: { code },
      vars: { minutes: String(Math.round(this.env.OTP_TTL_SECONDS / 60)) },
    })
    this.logger.log(`OTP issued for ${maskPhone(phone)}`)
    const echo = this.env.SMS_PROVIDER === 'console' && this.env.NODE_ENV !== 'production' && this.env.OTP_DEV_ECHO
    return { expiresInSeconds: this.env.OTP_TTL_SECONDS, ...(echo ? { devCode: code } : {}) }
  }

  /** Verifies the newest unexpired code for the phone. Attempts are counted atomically; the code is single-use. */
  async verify(tenantId: string, phoneInput: string, code: string): Promise<{ phoneE164: string }> {
    const phone = this.normalize(phoneInput)
    const otp = await this.prisma.client.otpCode.findFirst({
      where: { tenantId, phoneE164: phone, purpose: 'LOGIN', consumedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    })
    if (!otp) throw AppError.invalid('invalid_code', 'The code is invalid or has expired')
    const counted = await this.prisma.client.otpCode.updateMany({ where: { id: otp.id, attempts: { lt: otp.maxAttempts } }, data: { attempts: { increment: 1 } } })
    if (counted.count !== 1) throw AppError.tooMany('Too many attempts; request a new code')
    const ok = await argon2.verify(otp.codeHash, code)
    if (!ok) throw AppError.invalid('invalid_code', 'The code is invalid or has expired')
    const consumed = await this.prisma.client.otpCode.updateMany({ where: { id: otp.id, consumedAt: null }, data: { consumedAt: new Date() } })
    if (consumed.count !== 1) throw AppError.invalid('invalid_code', 'The code was already used')
    return { phoneE164: phone }
  }

  /** Sliding window per phone number, shared across replicas. Redis failure blocks issuing (fail closed). */
  private async enforcePhoneWindow(tenantId: string, phone: string): Promise<void> {
    const key = `otp:${tenantId}:${phone}`
    if (this.redis.off) {
      const now = Date.now()
      const rec = this.memoryWindow.get(key)
      const cur = rec && rec.expires > now ? rec : { count: 0, expires: now + this.env.OTP_PHONE_WINDOW_SECONDS * 1000 }
      cur.count++
      this.memoryWindow.set(key, cur)
      if (cur.count > this.env.OTP_PHONE_LIMIT) throw AppError.tooMany('Too many codes requested for this number', Math.ceil((cur.expires - now) / 1000))
      return
    }
    try {
      const count = await this.redis.cache.incr(key)
      if (count === 1) await this.redis.cache.expire(key, this.env.OTP_PHONE_WINDOW_SECONDS)
      if (count > this.env.OTP_PHONE_LIMIT) {
        const ttl = await this.redis.cache.ttl(key)
        throw AppError.tooMany('Too many codes requested for this number', ttl > 0 ? ttl : this.env.OTP_PHONE_WINDOW_SECONDS)
      }
    } catch (err) {
      if (err instanceof AppError) throw err
      this.logger.error(`OTP rate limiter unavailable: ${(err as Error).message}`)
      throw AppError.unavailable('Sign-in is temporarily unavailable, please try again shortly')
    }
  }

  /** Used by the SMS producer to keep the code out of plain job payloads. */
  protect(value: string): string {
    return encryptString(value, this.env.OTP_JOB_ENCRYPTION_KEY)
  }
}
