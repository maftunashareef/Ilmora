import { Module } from '@nestjs/common'
import { QueueModule } from '../../infra/queue/queue.module'
import { CatalogModule } from '../catalog/catalog.module'
import { SessionsModule } from '../sessions/sessions.module'
import { ManageController } from './manage.controller'
import { ManageService } from './manage.service'

@Module({
  imports: [CatalogModule, SessionsModule, QueueModule.forFeature()],
  controllers: [ManageController],
  providers: [ManageService],
  exports: [ManageService],
})
export class ManageModule {}
