import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import Redis, { type RedisOptions } from 'ioredis'
import { ENV, type Env } from '../../config/env'

/**
 * Redis connections, separated by purpose:
 *  - `queue`     — BullMQ + pub/sub (REDIS_URL, must use noeviction; BullMQ needs maxRetriesPerRequest = null)
 *  - `cache`     — throttling and disposable caches (REDIS_CACHE_URL or REDIS_URL); losing it never loses jobs
 *  - `subscriber`— dedicated connection for pub/sub subscriptions (a subscribed connection cannot run commands)
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name)
  readonly queue: Redis
  readonly cache: Redis
  private subscriberClient?: Redis
  readonly keyPrefix: string
  /** True in REDIS_MODE=off (development): callers must use their in-memory fallbacks. */
  readonly off: boolean

  constructor(@Inject(ENV) private readonly env: Env) {
    this.keyPrefix = `${env.REDIS_KEY_PREFIX}:`
    this.off = env.REDIS_MODE === 'off'
    if (this.off) {
      this.logger.warn('REDIS_MODE=off: rate limits are per-process, SMS is delivered inline, no background jobs or live fan-out')
      this.queue = undefined as unknown as Redis
      this.cache = undefined as unknown as Redis
      return
    }
    this.queue = this.connect(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true })
    this.cache = env.REDIS_CACHE_URL && env.REDIS_CACHE_URL !== env.REDIS_URL
      ? this.connect(env.REDIS_CACHE_URL, { maxRetriesPerRequest: 1, keyPrefix: this.keyPrefix })
      : this.connect(env.REDIS_URL, { maxRetriesPerRequest: 1, keyPrefix: this.keyPrefix })
  }

  /** Options BullMQ needs to create its own connections (it must not share a subscriber connection). */
  bullConnection(): RedisOptions & { url?: string } {
    return { ...parseRedisUrl(this.env.REDIS_URL), maxRetriesPerRequest: null, enableReadyCheck: true }
  }

  subscriber(): Redis {
    if (!this.subscriberClient) this.subscriberClient = this.connect(this.env.REDIS_URL, { maxRetriesPerRequest: null })
    return this.subscriberClient
  }

  async ping(): Promise<boolean> {
    if (this.off) return true
    const [a, b] = await Promise.all([this.queue.ping(), this.cache.ping()])
    return a === 'PONG' && b === 'PONG'
  }

  private connect(url: string, options: RedisOptions): Redis {
    const client = new Redis(url, {
      lazyConnect: false,
      connectTimeout: 5_000,
      retryStrategy: (times) => Math.min(times * 200, 5_000),
      ...options,
    })
    client.on('error', (err) => this.logger.warn(`Redis error: ${err.message}`))
    client.on('reconnecting', () => this.logger.warn('Redis reconnecting'))
    return client
  }

  async onModuleDestroy() {
    if (this.off) return
    await Promise.allSettled([this.queue.quit(), this.cache.quit(), this.subscriberClient?.quit()])
  }
}

export function parseRedisUrl(url: string): RedisOptions {
  const u = new URL(url)
  const opts: RedisOptions = {
    host: u.hostname,
    port: Number(u.port || 6379),
    db: u.pathname && u.pathname !== '/' ? Number(u.pathname.slice(1)) : 0,
  }
  if (u.username) opts.username = decodeURIComponent(u.username)
  if (u.password) opts.password = decodeURIComponent(u.password)
  if (u.protocol === 'rediss:') opts.tls = {}
  return opts
}
