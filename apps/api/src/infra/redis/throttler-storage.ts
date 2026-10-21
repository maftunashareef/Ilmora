import { Injectable, Logger } from '@nestjs/common'
import type { ThrottlerStorage } from '@nestjs/throttler'
import type { ThrottlerStorageRecord } from '@nestjs/throttler/dist/throttler-storage-record.interface'
import { RedisService } from './redis.service'

/**
 * Redis-backed storage for @nestjs/throttler so limits are shared by every API replica.
 *
 * One atomic Lua script per hit: INCR the window counter, set its TTL on first hit, and when the
 * limit is exceeded set a block key for `blockDuration`. Keys are namespaced per throttler name.
 *
 * Redis outage policy (fail-open vs fail-closed):
 *  - throttlers named "auth" fail CLOSED (treated as blocked) because OTP delivery depends on Redis anyway;
 *  - every other throttler fails OPEN so an unreachable cache cannot take the whole API down.
 * Application throttling is one defensive layer only — it is not DDoS protection; that belongs at the edge.
 */
@Injectable()
export class RedisThrottlerStorage implements ThrottlerStorage {
  private readonly logger = new Logger(RedisThrottlerStorage.name)
  private static readonly SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
if hits == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('PTTL', KEYS[1])
local blocked = redis.call('PTTL', KEYS[2])
if hits > tonumber(ARGV[2]) and blocked <= 0 then
  redis.call('SET', KEYS[2], '1', 'PX', ARGV[3])
  blocked = tonumber(ARGV[3])
end
return { hits, ttl, blocked }
`
  private sha?: string
  private readonly memory = new Map<string, { hits: number; expires: number; blockedUntil: number }>()

  constructor(private readonly redis: RedisService) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<ThrottlerStorageRecord> {
    const hitKey = `throttle:${throttlerName}:${key}`
    const blockKey = `throttle:${throttlerName}:${key}:blocked`
    const block = blockDuration > 0 ? blockDuration : ttl
    if (this.redis.off) return this.incrementInMemory(hitKey, ttl, limit, block)
    try {
      const res = (await this.runScript(hitKey, blockKey, ttl, limit, block)) as [number, number, number]
      const [totalHits, timeToExpireMs, blockedMs] = res
      return {
        totalHits,
        timeToExpire: Math.max(0, Math.ceil(timeToExpireMs / 1000)),
        isBlocked: blockedMs > 0,
        timeToBlockExpire: Math.max(0, Math.ceil(blockedMs / 1000)),
      }
    } catch (err) {
      const failClosed = throttlerName === 'auth'
      this.logger.error(`Throttler storage unavailable (${(err as Error).message}); failing ${failClosed ? 'closed' : 'open'} for "${throttlerName}"`)
      return failClosed
        ? { totalHits: limit + 1, timeToExpire: Math.ceil(ttl / 1000), isBlocked: true, timeToBlockExpire: Math.ceil(block / 1000) }
        : { totalHits: 0, timeToExpire: Math.ceil(ttl / 1000), isBlocked: false, timeToBlockExpire: 0 }
    }
  }

  /** Single-process fallback (REDIS_MODE=off, development only). */
  private incrementInMemory(key: string, ttl: number, limit: number, block: number): ThrottlerStorageRecord {
    const now = Date.now()
    let rec = this.memory.get(key)
    if (!rec || rec.expires <= now) rec = { hits: 0, expires: now + ttl, blockedUntil: 0 }
    rec.hits++
    if (rec.hits > limit && rec.blockedUntil <= now) rec.blockedUntil = now + block
    this.memory.set(key, rec)
    if (this.memory.size > 50_000) for (const [k, v] of this.memory) if (v.expires <= now) this.memory.delete(k)
    return { totalHits: rec.hits, timeToExpire: Math.ceil((rec.expires - now) / 1000), isBlocked: rec.blockedUntil > now, timeToBlockExpire: Math.max(0, Math.ceil((rec.blockedUntil - now) / 1000)) }
  }

  // Runs the fixed Lua script above on the Redis server (EVALSHA); no dynamic code is evaluated in Node.
  private async runScript(hitKey: string, blockKey: string, ttl: number, limit: number, block: number) {
    const client = this.redis.cache
    if (!this.sha) this.sha = (await client.script('LOAD', RedisThrottlerStorage.SCRIPT)) as string
    try {
      return await client.evalsha(this.sha, 2, hitKey, blockKey, String(ttl), String(limit), String(block))
    } catch (err) {
      if (String((err as Error).message).includes('NOSCRIPT')) {
        this.sha = (await client.script('LOAD', RedisThrottlerStorage.SCRIPT)) as string
        return client.evalsha(this.sha, 2, hitKey, blockKey, String(ttl), String(limit), String(block))
      }
      throw err
    }
  }
}
