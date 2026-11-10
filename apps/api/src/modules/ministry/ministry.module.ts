import { Module } from '@nestjs/common'
import { MinistryAccountsService } from './ministry-accounts.service'
import { MinistryAdminController } from './ministry-admin.controller'
import { MinistryRegistryService } from './ministry-registry.service'
import { MinistryStatsService } from './ministry-stats.service'
import { MinistryController } from './ministry.controller'
import { InstitutionsModule } from '../institutions/institutions.module'

/** The ministry: its workspace — registry view, figures, Excel (ТЗ 7) — and its accounts, created by the Super Admin. */
@Module({
  imports: [InstitutionsModule],
  controllers: [MinistryController, MinistryAdminController],
  providers: [MinistryAccountsService, MinistryStatsService, MinistryRegistryService],
})
export class MinistryModule {}
