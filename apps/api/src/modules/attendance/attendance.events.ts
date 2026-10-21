import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common'
import { EventEmitter } from 'node:events'
import { Observable, Subject } from 'rxjs'
import { RedisService } from '../../infra/redis/redis.service'

export type AttendanceEvent =
  | { type: 'session'; session: unknown }
  | { type: 'record'; record: unknown }
  | { type: 'heartbeat'; at: string }

/**
 * Fan-out of attendance changes to teacher dashboards. Events travel through Redis pub/sub so that a
 * check-in handled by one API replica reaches an SSE stream served by another.
 */
@Injectable()
export class AttendanceEvents implements OnModuleDestroy {
  private readonly logger = new Logger(AttendanceEvents.name)
  private readonly subjects = new Map<string, Subject<AttendanceEvent>>()
  private subscribed = false
  private readonly local = new EventEmitter()

  constructor(private readonly redis: RedisService) {}

  private channel(sessionId: string) {
    return `${this.redis.keyPrefix}attendance:${sessionId}`
  }

  async publish(sessionId: string, event: AttendanceEvent): Promise<void> {
    if (this.redis.off) {
      this.local.emit(sessionId, event)
      return
    }
    try {
      await this.redis.queue.publish(this.channel(sessionId), JSON.stringify(event))
    } catch (err) {
      // Live updates are best-effort; the dashboard also polls.
      this.logger.warn(`publish failed: ${(err as Error).message}`)
    }
  }

  stream(sessionId: string): Observable<AttendanceEvent> {
    if (this.redis.off) {
      return new Observable<AttendanceEvent>((observer) => {
        const handler = (e: AttendanceEvent) => observer.next(e)
        this.local.on(sessionId, handler)
        const heartbeat = setInterval(() => observer.next({ type: 'heartbeat', at: new Date().toISOString() }), 25_000)
        return () => { clearInterval(heartbeat); this.local.off(sessionId, handler) }
      })
    }
    return new Observable<AttendanceEvent>((observer) => {
      void this.ensureSubscribed()
      let subject = this.subjects.get(sessionId)
      if (!subject) {
        subject = new Subject<AttendanceEvent>()
        this.subjects.set(sessionId, subject)
        void this.redis.subscriber().subscribe(this.channel(sessionId))
      }
      const sub = subject.subscribe(observer)
      const heartbeat = setInterval(() => observer.next({ type: 'heartbeat', at: new Date().toISOString() }), 25_000)
      return () => {
        clearInterval(heartbeat)
        sub.unsubscribe()
        if (subject && subject.observers.length === 0) {
          this.subjects.delete(sessionId)
          void this.redis.subscriber().unsubscribe(this.channel(sessionId))
        }
      }
    })
  }

  private async ensureSubscribed() {
    if (this.subscribed) return
    this.subscribed = true
    this.redis.subscriber().on('message', (channel: string, message: string) => {
      const sessionId = channel.slice(`${this.redis.keyPrefix}attendance:`.length)
      const subject = this.subjects.get(sessionId)
      if (!subject) return
      try {
        subject.next(JSON.parse(message) as AttendanceEvent)
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
