import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { EventEmitter } from 'node:events'
import { Observable, Subject } from 'rxjs'
import { RedisService } from '../../infra/redis/redis.service'

export type LiveEvent = { type: string } & Record<string, unknown>

/**
 * Fan-out of live events to server-sent-event streams, by channel name (an attendance session, a user's
 * notifications). Events travel through Redis pub/sub so that a change handled by one API replica reaches a
 * stream served by another. With REDIS_MODE=off a process-local bus is used. Delivery is best effort: every
 * stream consumer also reads the current state from the database when it (re)connects.
 */
@Injectable()
export class LiveEvents implements OnModuleDestroy {
  private readonly logger = new Logger(LiveEvents.name)
  private readonly subjects = new Map<string, Subject<LiveEvent>>()
  private subscribed = false
  private readonly local = new EventEmitter()

  constructor(private readonly redis: RedisService) {
    this.local.setMaxListeners(0)
  }

  private redisChannel(channel: string) {
    return `${this.redis.keyPrefix}live:${channel}`
  }

  async publish(channel: string, event: LiveEvent): Promise<void> {
    if (this.redis.off) {
      this.local.emit(channel, event)
      return
    }
    try {
      await this.redis.queue.publish(this.redisChannel(channel), JSON.stringify(event))
    } catch (err) {
      this.logger.warn(`publish ${channel} failed: ${(err as Error).message}`)
    }
  }

  /** Events of one channel plus a heartbeat every 25 s (keeps proxies from closing idle streams). */
  stream(channel: string): Observable<LiveEvent> {
    if (this.redis.off) {
      return new Observable<LiveEvent>((observer) => {
        const handler = (e: LiveEvent) => observer.next(e)
        this.local.on(channel, handler)
        const heartbeat = setInterval(() => observer.next({ type: 'heartbeat', at: new Date().toISOString() }), 25_000)
        return () => { clearInterval(heartbeat); this.local.off(channel, handler) }
      })
    }
    return new Observable<LiveEvent>((observer) => {
      void this.ensureSubscribed()
      let subject = this.subjects.get(channel)
      if (!subject) {
        subject = new Subject<LiveEvent>()
        this.subjects.set(channel, subject)
        void this.redis.subscriber().subscribe(this.redisChannel(channel))
      }
      const sub = subject.subscribe(observer)
      const heartbeat = setInterval(() => observer.next({ type: 'heartbeat', at: new Date().toISOString() }), 25_000)
      return () => {
        clearInterval(heartbeat)
        sub.unsubscribe()
        if (subject && subject.observers.length === 0) {
          this.subjects.delete(channel)
          void this.redis.subscriber().unsubscribe(this.redisChannel(channel))
        }
      }
    })
  }

  private async ensureSubscribed() {
    if (this.subscribed) return
    this.subscribed = true
    const prefix = this.redisChannel('')
    this.redis.subscriber().on('message', (redisChannel: string, message: string) => {
      if (!redisChannel.startsWith(prefix)) return
      const subject = this.subjects.get(redisChannel.slice(prefix.length))
      if (!subject) return
      try {
        subject.next(JSON.parse(message) as LiveEvent)
      } catch {
        /* ignore malformed */
      }
    })
  }

  onModuleDestroy() {
    for (const s of this.subjects.values()) s.complete()
    this.subjects.clear()
  }
}
