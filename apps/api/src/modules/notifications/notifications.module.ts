import { Global, Module } from '@nestjs/common'
import { LiveEvents } from './live-events.service'
import { NotificationsController } from './notifications.controller'
import { NotificationsService } from './notifications.service'

/** In-app notifications and the live-event bus; global so every feature module and the worker can publish. */
@Global()
@Module({
  controllers: [NotificationsController],
  providers: [LiveEvents, NotificationsService],
  exports: [LiveEvents, NotificationsService],
})
export class NotificationsModule {}
