import { Module } from '@nestjs/common'
import { SiteService } from '../site/site.service'
import { CatalogController } from './catalog.controller'
import { CatalogService } from './catalog.service'
import { MyPermissionsController } from './my-permissions.controller'

@Module({
  controllers: [CatalogController, MyPermissionsController],
  providers: [CatalogService, SiteService],
  exports: [CatalogService, SiteService],
})
export class CatalogModule {}
