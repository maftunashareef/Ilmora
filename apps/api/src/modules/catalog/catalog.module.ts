import { Module } from '@nestjs/common'
import { SiteService } from '../site/site.service'
import { CatalogController } from './catalog.controller'
import { CatalogService } from './catalog.service'

@Module({
  controllers: [CatalogController],
  providers: [CatalogService, SiteService],
  exports: [CatalogService, SiteService],
})
export class CatalogModule {}
