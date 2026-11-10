import { Module } from '@nestjs/common'
import { MinistryAccountsService } from './ministry-accounts.service'
import { MinistryAdminController } from './ministry-admin.controller'

/** The ministry: its accounts (created by the Super Admin). Later — the registry view and the figures (ТЗ 7). */
@Module({
  controllers: [MinistryAdminController],
  providers: [MinistryAccountsService],
})
export class MinistryModule {}
