import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'
import { ENV, type Env } from '../../config/env'
import { PrismaClient } from '../../generated/prisma/client'
import { tenantAndSoftDeleteExtension } from './prisma-extensions'

function buildClient(env: Env) {
  const adapter = new PrismaPg({ connectionString: env.DATABASE_URL, max: env.DATABASE_POOL_MAX })
  const base = new PrismaClient({
    adapter,
    log: env.NODE_ENV === 'development' ? [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }] : [{ emit: 'event', level: 'error' }],
  })
  return base.$extends(tenantAndSoftDeleteExtension)
}

export type ExtendedPrismaClient = ReturnType<typeof buildClient>
export type TransactionClient = Parameters<Parameters<ExtendedPrismaClient['$transaction']>[0]>[0]

/**
 * Prisma client with tenant isolation + soft delete applied. Inject `PrismaService` and use
 * `prisma.client` for queries, `prisma.tx(fn)` for serializable work.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name)
  readonly client: ExtendedPrismaClient

  constructor(@Inject(ENV) env: Env) {
    this.client = buildClient(env)
  }

  async onModuleInit() {
    await this.client.$connect()
    this.logger.log('Database connected')
  }

  async onModuleDestroy() {
    await this.client.$disconnect()
  }

  /** Interactive transaction with a bounded timeout. Keep network calls (SMS, provider APIs) outside. */
  tx<T>(fn: (tx: TransactionClient) => Promise<T>, opts: { timeoutMs?: number; serializable?: boolean } = {}): Promise<T> {
    return this.client.$transaction(fn, {
      timeout: opts.timeoutMs ?? 10_000,
      maxWait: 5_000,
      ...(opts.serializable ? { isolationLevel: 'Serializable' as const } : {}),
    })
  }

  /** Raw health probe used by readiness checks. */
  async ping(): Promise<boolean> {
    await this.client.$queryRaw`SELECT 1`
    return true
  }
}
