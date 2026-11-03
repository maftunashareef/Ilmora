import { Injectable } from '@nestjs/common'
import type { Observable } from 'rxjs'
import { LiveEvents } from '../notifications/live-events.service'

export type AttendanceEvent =
  | { type: 'session'; session: unknown }
  | { type: 'record'; record: unknown }
  | { type: 'heartbeat'; at: string }

/** Live attendance changes of one lesson for teacher and center dashboards, on the shared live-event bus (Redis pub/sub). */
@Injectable()
export class AttendanceEvents {
  constructor(private readonly live: LiveEvents) {}

  private channel(sessionId: string) {
    return `attendance:${sessionId}`
  }

  publish(sessionId: string, event: AttendanceEvent): Promise<void> {
    return this.live.publish(this.channel(sessionId), event)
  }

  stream(sessionId: string): Observable<AttendanceEvent> {
    return this.live.stream(this.channel(sessionId)) as Observable<AttendanceEvent>
  }
}
