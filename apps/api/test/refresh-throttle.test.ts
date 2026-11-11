import 'reflect-metadata'
import { Controller, type ExecutionContext, type INestApplication, Module, Post } from '@nestjs/common'
import { APP_GUARD, NestFactory } from '@nestjs/core'
import { ThrottlerModule } from '@nestjs/throttler'
import cookieParser from 'cookie-parser'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { isAuthThrottled, isSessionThrottled, Public, SessionThrottle } from '../src/common/decorators'
import { AppThrottlerGuard } from '../src/common/guards'
import { throttlers } from '../src/common/throttlers'
import { AuthController } from '../src/modules/auth/auth.controller'
import { REFRESH_COOKIE } from '../src/modules/auth/token.service'
import { testEnv } from './helpers'

/**
 * Security review 10.11 №19: students of one center share one Wi-Fi address. The session refresh used to be limited to
 * 30 a minute per address with a 5-minute block — a class checking in by QR was thrown out to the sign-in page.
 * Now it is counted per session; per address only a wide limit applies.
 */
describe('Session refresh limits (№19)', () => {
  let app: INestApplication | undefined
  afterEach(async () => { await app?.close(); app = undefined })

  it('the real refresh route is counted per session', () => {
    const route = { getHandler: () => AuthController.prototype.refresh, getClass: () => AuthController } as unknown as ExecutionContext
    expect(isSessionThrottled(route)).toBe(true)
    expect(isAuthThrottled(route)).toBe(true)
  })

  const start = async (perIp = 600) => {
    @Controller('auth')
    class RefreshOnly {
      @Public()
      @SessionThrottle(30)
      @Post('refresh')
      refresh() { return { ok: true } }
    }
    @Module({
      imports: [ThrottlerModule.forRoot({ throttlers: throttlers(testEnv({ RATE_LIMIT_REFRESH_PER_IP_MINUTE: String(perIp) })) })],
      controllers: [RefreshOnly],
      providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
    })
    class RefreshModule {}
    const created = await NestFactory.create(RefreshModule, { logger: false })
    created.use(cookieParser())
    await created.init()
    app = created
    return created
  }
  const refresh = (a: INestApplication, session: string) => request(a.getHttpServer()).post('/auth/refresh').set('Cookie', `${REFRESH_COOKIE}=${session}`)

  it('40 students on one address each renew their session — nobody is refused', async () => {
    const a = await start()
    for (let i = 0; i < 40; i++) expect((await refresh(a, `student-${i}`)).status).toBe(201)
  })

  it('one session renewing too often is refused, the others are not', async () => {
    const a = await start()
    for (let i = 0; i < 30; i++) await refresh(a, 'busy')
    expect((await refresh(a, 'busy')).status).toBe(429)
    expect((await refresh(a, 'calm')).status).toBe(201)
  })

  it('an address trying many values hits the wide per-address limit', async () => {
    const a = await start(50)
    for (let i = 0; i < 50; i++) await refresh(a, `guess-${i}`)
    expect((await refresh(a, 'guess-x')).status).toBe(429)
  })
})
