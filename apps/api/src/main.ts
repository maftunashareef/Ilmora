import './instrument'
import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { Logger } from 'nestjs-pino'
import { AppModule } from './app.module'
import { configureBodyParsing } from './body-parsing'
import { ENV, type Env } from './config/env'

// BigInt (tiyin amounts, provider timestamps) serialises as a decimal string to stay exact in JSON.
;(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function toJSON(this: bigint) {
  return this.toString()
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true, rawBody: true })
  const logger = app.get(Logger)
  app.useLogger(logger)
  const env = app.get<Env>(ENV)

  // Correct client IPs (rate limits, audit, provider allow-lists) depend on the proxy hop count.
  app.set('trust proxy', /^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY)
  app.disable('x-powered-by')

  app.use(
    helmet({
      contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: env.NODE_ENV === 'production' ? { maxAge: 15552000, includeSubDomains: true } : false,
    }),
  )
  app.use(cookieParser())
  // JSON up to 1 MB, also as text/json (Payme): see body-parsing.ts.
  configureBodyParsing(app)
  app.enableCors({
    origin: env.CORS_ORIGINS.length ? env.CORS_ORIGINS : env.NODE_ENV === 'production' ? false : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-Tenant', 'X-Request-Id', 'Accept-Language', 'If-None-Match'],
    exposedHeaders: ['X-Request-Id', 'Retry-After', 'ETag'],
    maxAge: 600,
  })
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      validationError: { target: false, value: false },
    }),
  )
  app.setGlobalPrefix(env.API_GLOBAL_PREFIX, {
    exclude: ['health', 'health/live', 'health/ready', 'payments/payme'],
  })
  app.enableShutdownHooks()

  await app.listen(env.PORT, '0.0.0.0')
  logger.log(`ILMORA API listening on :${env.PORT} (${env.NODE_ENV}, role=${env.APP_ROLE})`)
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error', err)
  process.exit(1)
})
