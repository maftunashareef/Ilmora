import { Module } from '@nestjs/common'
import { CompaniesAdminController } from './companies-admin.controller'
import { CompaniesController } from './companies.controller'
import { CompaniesService } from './companies.service'
import { CompanyReviewService } from './company-review.service'

/** Registry: the company's own profile (ТЗ 4.3) and its review by the Super Admin. */
@Module({
  controllers: [CompaniesController, CompaniesAdminController],
  providers: [CompaniesService, CompanyReviewService],
  exports: [CompaniesService],
})
export class CompaniesModule {}
