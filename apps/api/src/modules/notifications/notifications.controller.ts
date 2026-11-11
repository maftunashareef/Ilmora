import { Body, Controller, Get, Post, Query, Sse, type MessageEvent } from '@nestjs/common'
import { map, type Observable } from 'rxjs'
import { z } from 'zod'
import { CurrentActor } from '../../common/decorators'
import { ZodValidationPipe } from '../../common/zod.pipe'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { NotificationsService } from './notifications.service'

const ReadDto = z.object({ ids: z.array(z.string().min(1).max(80)).max(200).optional(), all: z.boolean().optional() }).strict()

/** The signed-in account's notifications: list, read marks and a live stream. */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentActor() actor: RequestActor, @Query('before') before?: string, @Query('limit') limit?: string) {
    const n = limit ? Number(limit) : undefined
    return this.notifications.list(actor.id, { before, limit: n !== undefined && Number.isFinite(n) ? n : undefined })
  }

  @Post('read')
  read(@CurrentActor() actor: RequestActor, @Body(new ZodValidationPipe(ReadDto)) dto: z.infer<typeof ReadDto>) {
    return this.notifications.markRead(actor.id, dto)
  }

  /** Server-sent events: a ping per new notification (the client then reloads the list). */
  @Sse('stream')
  stream(@CurrentActor() actor: RequestActor): Observable<MessageEvent> {
    return this.notifications.stream(actor.id).pipe(map((event) => ({ data: event, type: event.type }) as MessageEvent))
  }
}
