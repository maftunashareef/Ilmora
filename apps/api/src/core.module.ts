import { BullModule } from '@nestjs/bullmq'
import { Module } from '@nestjs/common'
import { ThrottlerModule } from '@nestjs/throttler'
import { randomUUID } from 'node:crypto'
import { LoggerModule } from 'nestjs-pino'
import { isAuthThrottled } from './common/decorators'
import { AppConfigModule } from './config/config.module'
import { ENV, type Env } from './config/env'
import { PrismaModule } from './infra/prisma/prisma.module'
import { RedisModule } from './infra/redis/redis.module'
import { RedisService } from './infra/redis/redis.service'
import { RedisThrottlerStorage } from './infra/redis/throttler-storage'
import { REDIS_OFF } from './infra/queue/queue.module'
import { AuditModule } from './modules/audit/audit.module'
import { TenantsModule } from './modules/tenants/tenants.module'

/** Fields that must never appear in logs. */
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'res.headers["set-cookie"]',
  'req.query.t',
  'req.body.code',
  'req.body.otp',
  'req.body.token',
  'req.body.refreshToken',
  'req.body.password',
  'req.body.params.account',
  'req.body.sign_string',
  'req.body.card',
]

/** Infrastructure shared by the HTTP API and the worker: config, logging, database, Redis, queues, throttling. */
@Module({
  imports: [
    AppConfigModule,
    LoggerModule.forRootAsync({
      inject: [ENV],
      useFactory: (env: Env) => ({
        pinoHttp: {
          level: env.LOG_LEVEL,
          redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
          genReqId: (req, res) => {
            const incoming = req.headers['x-request-id']
            const id = typeof incoming === 'string' && /^[\w.-]{8,64}$/.test(incoming) ? incoming : randomUUID()
            res.setHeader('X-Request-Id', id)
            return id
          },
          autoLogging: { ignore: (req) => (req.url ?? '').startsWith('/health') },
          serializers: {
            req: (req: { id: string; method: string; url: string; remoteAddress?: string }) => ({ id: req.id, method: req.method, url: (req.url ?? '').split('?')[0], ip: req.remoteAddress }),
            res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
          },
          customProps: (req) => {
            const r = req as { tenantId?: string; actor?: { id: string } }
            return { tenantId: r.tenantId, actorId: r.actor?.id }
          },
          transport: env.NODE_ENV === 'development' ? { target: 'pino-pretty', options: { colorize: true, singleLine: true, translateTime: 'HH:MM:ss' } } : undefined,
        },
      }),
    }),
    PrismaModule,
    RedisModule,
    ThrottlerModule.forRootAsync({
      inject: [ENV, RedisThrottlerStorage],
      useFactory: (env: Env, storage: RedisThrottlerStorage) => ({
        storage,
        throttlers: [
          { name: 'default', ttl: 60_000, limit: env.RATE_LIMIT_DEFAULT_PER_MINUTE },
          // Strict limit only for routes marked @AuthThrottle(); without skipIf it would count every request in the API.
          { name: 'auth', ttl: 60_000, limit: env.RATE_LIMIT_AUTH_PER_MINUTE, blockDuration: 5 * 60_000, skipIf: (ctx) => !isAuthThrottled(ctx) },
        ],
        skipIf: (ctx) => (ctx.switchToHttp().getRequest<{ url?: string }>().url ?? '').startsWith('/health'),
      }),
    }),
    ...(REDIS_OFF
      ? []
      : [
          BullModule.forRootAsync({
            inject: [RedisService, ENV],
            useFactory: (redis: RedisService, env: Env) => ({
              connection: redis.bullConnection() as unknown as import('bullmq').ConnectionOptions,
              prefix: `{${env.REDIS_KEY_PREFIX}:bull}`,
              defaultJobOptions: {
                attempts: 5,
                backoff: { type: 'exponential', delay: 2_000 },
                removeOnComplete: { age: 24 * 3600, count: 5_000 },
                removeOnFail: { age: 7 * 24 * 3600 },
              },
            }),
          }),
        ]),
    TenantsModule,
    AuditModule,
  ],
  exports: [AppConfigModule, PrismaModule, RedisModule, ThrottlerModule, TenantsModule, AuditModule],
})
export class CoreModule {}
