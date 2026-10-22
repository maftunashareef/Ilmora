import { Body, Controller, Get, Headers, Inject, Patch, Post, Req, Res } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import type { Request, Response } from 'express'
import { ClientInfo, type ClientInfoValue, CurrentActor, CurrentTenantId, Public } from '../../common/decorators'
import { AppError } from '../../common/errors'
import { ENV, type Env } from '../../config/env'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AccountService } from './account.service'
import { ConsentDto, PasswordLoginDto, RegisterDto, RequestOtpDto, UpdateProfileDto, VerifyOtpDto } from './auth.dto'
import { AuthService, type LoginResult } from './auth.service'
import { REFRESH_COOKIE, SESSION_FLAG, TokenService } from './token.service'

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly accounts: AccountService, private readonly tokens: TokenService, @Inject(ENV) private readonly env: Env) {}

  /** Student/Teacher self-registration with a login and password; opens a session on success. */
  @Public()
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @Post('register')
  async register(@CurrentTenantId() tenantId: string, @Body() dto: RegisterDto, @ClientInfo() ci: ClientInfoValue, @Res({ passthrough: true }) res: Response) {
    const result = await this.accounts.register(tenantId, dto, { ip: ci.ip, userAgent: ci.userAgent })
    return this.respond(res, result)
  }

  /** Login + password. Wrong login and wrong password produce the same error; repeated failures lock the login. */
  @Public()
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @Post('login')
  async login(@CurrentTenantId() tenantId: string, @Body() dto: PasswordLoginDto, @ClientInfo() ci: ClientInfoValue, @Res({ passthrough: true }) res: Response) {
    const result = await this.accounts.loginWithPassword(tenantId, dto, { ip: ci.ip, userAgent: ci.userAgent })
    return this.respond(res, result)
  }

  @Public()
  @Throttle({ auth: { limit: 6, ttl: 60_000 } })
  @Post('otp/request')
  requestOtp(@CurrentTenantId() tenantId: string, @Body() dto: RequestOtpDto, @ClientInfo() ci: ClientInfoValue) {
    return this.auth.requestOtp(tenantId, dto.phone, dto.lang ?? 'uz', { ip: ci.ip })
  }

  @Public()
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @Post('otp/verify')
  async verifyOtp(@CurrentTenantId() tenantId: string, @Body() dto: VerifyOtpDto, @ClientInfo() ci: ClientInfoValue, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.verifyOtp(tenantId, dto, { ip: ci.ip, userAgent: ci.userAgent })
    return this.respond(res, result)
  }

  /** Cookie-based: requires the custom header (browsers only add it from same-origin JavaScript) and an allowed Origin. */
  @Public()
  @Throttle({ auth: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Headers('x-requested-with') requestedWith: string | undefined, @ClientInfo() ci: ClientInfoValue) {
    this.assertSameSite(req, requestedWith)
    const raw = (req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE]
    if (!raw) throw AppError.unauthorized('No refresh session', 'invalid_refresh')
    try {
      const result = await this.auth.refresh(raw, { ip: ci.ip, userAgent: ci.userAgent })
      return this.respond(res, result)
    } catch (err) {
      res.clearCookie(REFRESH_COOKIE, this.tokens.cookieOptions())
      res.clearCookie(SESSION_FLAG, this.tokens.flagCookieOptions())
      throw err
    }
  }

  @Public()
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response, @Headers('x-requested-with') requestedWith: string | undefined) {
    this.assertSameSite(req, requestedWith)
    await this.auth.logout((req.cookies as Record<string, string> | undefined)?.[REFRESH_COOKIE])
    res.clearCookie(REFRESH_COOKIE, this.tokens.cookieOptions())
    res.clearCookie(SESSION_FLAG, this.tokens.flagCookieOptions())
    return { ok: true }
  }

  @Get('me')
  me(@CurrentActor() actor: RequestActor) {
    return this.auth.me(actor.id)
  }

  /** Accept the current offer edition and give personal-data consent (existing accounts). */
  @Post('consent')
  consent(@CurrentActor() actor: RequestActor, @Body() dto: ConsentDto) {
    return this.accounts.giveConsent(actor.id, { marketing: dto.marketing })
  }

  @Patch('me')
  updateMe(@CurrentActor() actor: RequestActor, @Body() dto: UpdateProfileDto) {
    return this.auth.updateProfile(actor.id, dto)
  }

  private respond(res: Response, result: LoginResult) {
    res.cookie(REFRESH_COOKIE, result.refresh.raw, this.tokens.cookieOptions(result.refresh.expiresAt))
    res.cookie(SESSION_FLAG, '1', this.tokens.flagCookieOptions(result.refresh.expiresAt))
    return { accessToken: result.accessToken, expiresInSeconds: result.expiresInSeconds, user: result.user }
  }

  private assertSameSite(req: Request, requestedWith: string | undefined) {
    if (requestedWith !== 'ilmora') throw AppError.forbidden('Missing X-Requested-With header', { code: 'csrf' })
    const origin = req.headers.origin ?? (req.headers.referer ? new URL(req.headers.referer).origin : undefined)
    if (origin && this.env.CORS_ORIGINS.length && !this.env.CORS_ORIGINS.includes(origin)) throw AppError.forbidden('Origin not allowed', { code: 'csrf' })
  }
}
