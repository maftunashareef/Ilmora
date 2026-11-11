import { MAX_CART_COURSES } from '@ilmora/shared'
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator'
import { Type } from 'class-transformer'
import type { RefundReason, RefundRequestStatus } from '../../generated/prisma/enums'
import type { RefundInput } from './refunds.service'

export const REFUND_REASONS: RefundReason[] = ['REFUSAL', 'SCHEDULE_CHANGED', 'GROUP_CLOSED', 'LESSONS_NOT_HELD', 'NOT_AS_DESCRIBED', 'PLATFORM_FAULT', 'OTHER']
export const REFUND_STATUSES: RefundRequestStatus[] = ['PENDING', 'APPROVED', 'REJECTED', 'PAID', 'WITHDRAWN']

/** Appendix 2 of the offer: the courses, the reason, «to another account». */
export class RefundDto {
  /** The refused courses (enrollment ids); all of the subscription when absent. */
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_CART_COURSES) @IsString({ each: true }) @Length(1, 64, { each: true }) enrollmentIds?: string[]
  @IsIn(REFUND_REASONS) reason!: RefundReason
  @IsOptional() @IsString() @Length(0, 1000) reasonText?: string
  @IsOptional() @IsBoolean() toOtherAccount?: boolean
}

export class RefundFromLetterDto extends RefundDto {
  @IsString() @Length(1, 64) studentId!: string
}

export const toRefundInput = (d: RefundDto): RefundInput => ({ enrollmentIds: d.enrollmentIds, reason: d.reason, reasonText: d.reasonText, toOtherAccount: d.toOtherAccount })

/** Tiyin as a string of digits (a bigint does not survive JSON). */
export class RefundApproveDto {
  @IsString() @Matches(/^\d{1,15}$/) approvedMinor!: string
  @IsOptional() @IsString() @Length(0, 1000) note?: string
}
export class RefundRejectDto {
  @IsString() @Length(3, 1000) note!: string
}
export class RefundPaidDto {
  /** The bank transfer's number or Payme's reference. */
  @IsString() @Length(3, 200) providerRef!: string
}
export class RefundListQuery {
  @IsOptional() @IsIn(REFUND_STATUSES) status?: RefundRequestStatus
  @IsOptional() @IsIn(['true', 'false']) overdue?: 'true' | 'false'
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number
  @IsOptional() @Type(() => Number) @IsInt() @Min(10) @Max(100) pageSize?: number
}

export class RefundStudentQuery {
  @IsString() @Length(2, 60) q!: string
}
