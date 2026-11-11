import 'reflect-metadata'
import { Controller, type ExecutionContext, type INestApplication, Module, Post } from '@nestjs/common'
import { APP_GUARD, NestFactory } from '@nestjs/core'
import { ThrottlerModule } from '@nestjs/throttler'
import request from 'supertest'
import { afterEach, describe, expect, it } from 'vitest'
import { AuthThrottle, isRegisterThrottled, Public, RegisterThrottle } from '../src/common/decorators'
import { AppThrottlerGuard } from '../src/common/guards'
import { throttlers } from '../src/common/throttlers'
import { AuthController } from '../src/modules/auth/auth.controller'
import { testEnv } from './helpers'

/**
 * Cybersecurity check 9.4, Н-4: registration had only a minute limit per address. Now also an hour and a day — wide,
 * because a technikum signs a class up from one Wi-Fi (the lesson of №19).
 */
describe('Registration limits per address (Н-4)', () => {
  let app: INestApplication | undefined
  afterEach(async () => { await app?.close(); app = undefined })

  it('the real registration route has them; sign-in does not', () => {
    const route = (name: 'register' | 'login') => ({ getHandler: () => AuthController.prototype[name], getClass: () => AuthController }) as unknown as ExecutionContext
    expect(isRegisterThrottled(route('register'))).toBe(true)
    expect(isRegisterThrottled(route('login'))).toBe(false)
  })

  it('the defaults let a class of 40 sign up from one address in a lesson', () => {
    const env = testEnv({})
    expect(env.RATE_LIMIT_REGISTER_PER_IP_HOUR).toBe(60)
    expect(env.RATE_LIMIT_REGISTER_PER_IP_DAY).toBe(300)
  })

  const start = async (hour: number, day: number) => {
    @Controller('auth')
    class RegisterOnly {
      @Public()
      @AuthThrottle(1000)
      @RegisterThrottle()
      @Post('register')
      register() { return { ok: true } }

      @Public()
      @AuthThrottle(1000)
      @Post('login')
      login() { return { ok: true } }
    }
    @Module({
      imports: [ThrottlerModule.forRoot({ throttlers: throttlers(testEnv({ RATE_LIMIT_AUTH_PER_MINUTE: '1000', RATE_LIMIT_REGISTER_PER_IP_HOUR: String(hour), RATE_LIMIT_REGISTER_PER_IP_DAY: String(day) })) })],
      controllers: [RegisterOnly],
      providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
    })
    class RegisterModule {}
    const created = await NestFactory.create(RegisterModule, { logger: false })
    await created.init()
    app = created
    return created
  }
  const post = (a: INestApplication, path: string) => request(a.getHttpServer()).post(path)

  it('an address over the hourly limit is refused; sign-in from it still works', async () => {
    const a = await start(5, 300)
    for (let i = 0; i < 5; i++) expect((await post(a, '/auth/register')).status).toBe(201)
    expect((await post(a, '/auth/register')).status).toBe(429)
    expect((await post(a, '/auth/login')).status).toBe(201)
  })

  it('the daily limit applies on its own', async () => {
    const a = await start(60, 3)
    for (let i = 0; i < 3; i++) expect((await post(a, '/auth/register')).status).toBe(201)
    expect((await post(a, '/auth/register')).status).toBe(429)
  })
})
