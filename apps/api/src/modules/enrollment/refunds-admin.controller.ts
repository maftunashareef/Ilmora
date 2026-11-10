import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common'
import { CurrentActor, CurrentTenantId, Roles } from '../../common/decorators'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { RefundApproveDto, RefundFromLetterDto, RefundListQuery, RefundPaidDto, RefundRejectDto, toRefundInput } from './refunds.dto'
import { RefundsService } from './refunds.service'

/** The finance admins' queue of refund requests (offer 6.6: a decision within 10 days, money within 5 working days). */
@Controller('admin/finance/refunds')
@Roles('FINANCE_ADMIN')
export class RefundsAdminController {
  constructor(private readonly refunds: RefundsService) {}

  @Get()
  list(@CurrentTenantId() tenantId: string, @Query() q: RefundListQuery) {
    return this.refunds.list(tenantId, { status: q.status, overdue: q.overdue === 'true', page: q.page, pageSize: q.pageSize })
  }

  /** A request that came by e-mail (appendix 2), entered for the student. */
  @Post()
  fromLetter(@CurrentTenantId() tenantId: string, @CurrentActor() actor: RequestActor, @Body() dto: RefundFromLetterDto) {
    return this.refunds.fileFromLetter(tenantId, actor.id, dto.studentId, toRefundInput(dto))
  }

  @Post(':id/approve')
  approve(@CurrentTenantId() tenantId: string, @CurrentActor() actor: RequestActor, @Param('id') id: string, @Body() dto: RefundApproveDto) {
    return this.refunds.approve(tenantId, actor.id, id, BigInt(dto.approvedMinor), dto.note)
  }

  @Post(':id/reject')
  reject(@CurrentTenantId() tenantId: string, @CurrentActor() actor: RequestActor, @Param('id') id: string, @Body() dto: RefundRejectDto) {
    return this.refunds.reject(tenantId, actor.id, id, dto.note)
  }

  @Post(':id/paid')
  paid(@CurrentTenantId() tenantId: string, @CurrentActor() actor: RequestActor, @Param('id') id: string, @Body() dto: RefundPaidDto) {
    return this.refunds.markPaid(tenantId, actor.id, id, dto.providerRef)
  }
}
