import { Module } from '@nestjs/common'
import { QueueModule } from '../../infra/queue/queue.module'
import { CatalogModule } from '../catalog/catalog.module'
import { SessionsModule } from '../sessions/sessions.module'
import { ManageController } from './manage.controller'
import { ManageService } from './manage.service'
import { UploadsController } from './uploads.controller'
import { UploadsService } from './uploads.service'

@Module({
  imports: [CatalogModule, SessionsModule, QueueModule.forFeature()],
  controllers: [ManageController, UploadsController],
  providers: [ManageService, UploadsService],
  exports: [ManageService],
})
export class ManageModule {}
