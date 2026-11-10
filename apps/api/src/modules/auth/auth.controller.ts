import { Body, Controller, Get, Headers, Inject, Patch, Post, Req, Res } from '@nestjs/common'
import type { Request, Response } from 'express'
import { AllowWithIssuedPassword, AuthThrottle, ClientInfo, type ClientInfoValue, CurrentActor, CurrentTenantId, Public } from '../../common/decorators'
import { AppError } from '../../common/errors'
import { ENV, type Env } from '../../config/env'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AccountService } from './account.service'
import { ChangePasswordDto, ConsentDto, ResetPasswordDto, GoogleAuthDto, MfaChallengeBody, MfaCodeBody, PasswordLoginDto, RegisterDto, RequestOtpDto, UpdateProfileDto, VerifyOtpDto } from './auth.dto'
import { AuthService, type LoginResult } from './auth.service'
import { REFRESH_COOKIE, SESSION_FLAG, TokenService } from './token.service'

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly accounts: AccountService, private readonly tokens: TokenService, @Inject(ENV) private readonly env: Env) {}

  /** Student/Teacher self-registration with a login and password; opens a session on success. */
  @Public()
  @AuthThrottle(10)
  @Post('register')
  async register(@Req() req: Request, @CurrentTenantId() tenantId: string, @Body() dto: RegisterDto, @ClientInfo() ci: ClientInfoValue, @Headers('x-requested-with') requestedWith: string | undefined, @Res({ passthrough: true }) res: Response) {
    this.assertSameSite(req, requestedWith)
    const result = await this.accounts.register(tenantId, dto, { ip: ci.ip, userAgent: ci.userAgent })
    return this.respond(res, result)
  }

  /** Login + password. Wrong login and wrong password produce the same error; repeated failures lock the login. */
  @Public()
  @AuthThrottle(10)
  @Post('login')
  async login(@Req() req: Request, @CurrentTenantId() tenantId: string, @Body() dto: PasswordLoginDto, @ClientInfo() ci: ClientInfoValue, @Headers('x-requested-with') requestedWith: string | undefined, @Res({ passthrough: true }) res: Response) {
    this.assertSameSite(req, requestedWith)
    const result = await this.accounts.loginWithPassword(tenantId, dto, { ip: ci.ip, userAgent: ci.userAgent })
    // The ministry and the Super Admins: no session yet — the pass for the authenticator step (no cookies).
    if ('mfaRequired' in result) return result
    return this.respond(res, result)
  }

  /** Second factor, first sign-in: the secret of the authenticator app (QR code). */
  @Public()
  @AuthThrottle(10)
  @Post('mfa/setup')
  mfaSetup(@Req() req: Request, @Body() dto: MfaChallengeBody, @Headers('x-requested-with') requestedWith: string | undefined) {
    this.assertSameSite(req, requestedWith)
    return this.auth.mfaSetup(dto.challenge)
  }

  /** Second factor, first sign-in: the first code links the app and opens the session; answers the recovery codes once. */
  @Public()
  @AuthThrottle(10)
  @Post('mfa/confirm')
  async mfaConfirm(@Req() req: Request, @Body() dto: MfaCodeBody, @ClientInfo() ci: ClientInfoValue, @Headers('x-requested-with') requestedWith: string | undefined, @Res({ passthrough: true }) res: Response) {
    this.assertSameSite(req, requestedWith)
    const result = await this.auth.mfaConfirm(dto.challenge, dto.code, { ip: ci.ip, userAgent: ci.userAgent })
    return { ...this.respond(res, result), recoveryCodes: result.recoveryCodes }
  }

  /** Second factor: a code from the app or a recovery code opens the session. */
  @Public()
  @AuthThrottle(10)
  @Post('mfa/verify')
  async mfaVerify(@Req() req: Request, @Body() dto: MfaCodeBody, @ClientInfo() ci: ClientInfoValue, @Headers('x-requested-with') requestedWith: string | undefined, @Res({ passthrough: true }) res: Response) {
    this.assertSameSite(req, requestedWith)
    return this.respond(res, await this.auth.mfaVerify(dto.challenge, dto.code, { ip: ci.ip, userAgent: ci.userAgent }))
  }

  /** Google Sign-In with ID token or authorization code; opens a session on success. */
  @Public()
  @AuthThrottle(10)
  @Post('google')
  async google(@Req() req: Request, @CurrentTenantId() tenantId: string, @Body() dto: GoogleAuthDto, @ClientInfo() ci: ClientInfoValue, @Headers('x-requested-with') requestedWith: string | undefined, @Res({ passthrough: true }) res: Response) {
    this.assertSameSite(req, requestedWith)
    const result = await this.auth.authenticateGoogle(tenantId, dto, { ip: ci.ip, userAgent: ci.userAgent })
    return this.respond(res, result)
  }

  @Public()
  @AuthThrottle(6)
  @Post('otp/request')
  requestOtp(@Req() req: Request, @CurrentTenantId() tenantId: string, @Body() dto: RequestOtpDto, @ClientInfo() ci: ClientInfoValue, @Headers('x-requested-with') requestedWith: string | undefined) {
    this.assertSameSite(req, requestedWith)
    return this.auth.requestOtp(tenantId, dto.phone, dto.lang ?? 'uz', { ip: ci.ip })
  }

  @Public()
  @AuthThrottle(10)
  @Post('otp/verify')
  async verifyOtp(@Req() req: Request, @CurrentTenantId() tenantId: string, @Body() dto: VerifyOtpDto, @ClientInfo() ci: ClientInfoValue, @Headers('x-requested-with') requestedWith: string | undefined, @Res({ passthrough: true }) res: Response) {
    this.assertSameSite(req, requestedWith)
    const result = await this.auth.verifyOtp(tenantId, dto, { ip: ci.ip, userAgent: ci.userAgent })
    return this.respond(res, result)
  }

  /**
   * «Забыл пароль»: first POST /auth/otp/request to the account's phone, then this with the code and the new
   * password. Answers like a sign-in. Not for the ministry, the Super Admins and the finance admins (403).
   */
  @Public()
  @AuthThrottle(5)
  @Post('password/reset')
  async resetPassword(@Req() req: Request, @CurrentTenantId() tenantId: string, @Body() dto: ResetPasswordDto, @ClientInfo() ci: ClientInfoValue, @Headers('x-requested-with') requestedWith: string | undefined, @Res({ passthrough: true }) res: Response) {
    this.assertSameSite(req, requestedWith)
    return this.respond(res, await this.auth.resetPasswordBySms(tenantId, dto, { ip: ci.ip, userAgent: ci.userAgent }))
  }

  /** Cookie-based: requires the custom header (browsers only add it from same-origin JavaScript) and an allowed Origin. */
  @Public()
  @AuthThrottle(30)
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
  @AllowWithIssuedPassword()
  me(@CurrentActor() actor: RequestActor) {
    return this.auth.me(actor.id)
  }

  /** Accept the current offer edition and give personal-data consent (existing accounts). */
  @Post('consent')
  consent(@CurrentActor() actor: RequestActor, @Body() dto: ConsentDto) {
    void dto
    return this.accounts.giveConsent(actor.id)
  }

  /**
   * «Сменить пароль» (any signed-in account with a password; the ministry right after the first sign-in, when
   * `passwordChangeRequired`). Ends every session of the account and answers like a sign-in: a fresh session here.
   */
  @Post('password')
  @AllowWithIssuedPassword()
  @AuthThrottle(5)
  async changePassword(@CurrentActor() actor: RequestActor, @CurrentTenantId() tenantId: string, @ClientInfo() ci: ClientInfoValue, @Body() dto: ChangePasswordDto, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.accounts.changePassword({ id: actor.id, tenantId }, dto, { ip: ci.ip, userAgent: ci.userAgent }))
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
