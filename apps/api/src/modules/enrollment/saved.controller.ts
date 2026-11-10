import { Body, Controller, Get, Put } from '@nestjs/common'
import { IsBoolean, IsIn, IsString, Length } from 'class-validator'
import { CurrentActor, CurrentTenantId, Roles } from '../../common/decorators'
import { PrismaService } from '../../infra/prisma/prisma.service'
import type { RequestActor } from '../../infra/tenancy/tenant-context'

class SavedDto {
  @IsIn(['course', 'teacher']) kind!: 'course' | 'teacher'
  @IsString() @Length(1, 80) itemId!: string
  @IsBoolean() saved!: boolean
}

/** Bookmarked courses and teachers (per account). */
@Controller('student/saved')
@Roles('STUDENT')
export class SavedController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async list(@CurrentActor() actor: RequestActor) {
    const rows = await this.prisma.client.savedItem.findMany({ where: { userId: actor.id } })
    return { courseIds: rows.filter((r) => r.kind === 'course').map((r) => r.itemId), teacherIds: rows.filter((r) => r.kind === 'teacher').map((r) => r.itemId) }
  }

  @Put()
  async set(@CurrentTenantId() tenantId: string, @CurrentActor() actor: RequestActor, @Body() dto: SavedDto) {
    if (dto.saved) {
      await this.prisma.client.savedItem.upsert({ where: { userId_kind_itemId: { userId: actor.id, kind: dto.kind, itemId: dto.itemId } }, update: {}, create: { tenantId, userId: actor.id, kind: dto.kind, itemId: dto.itemId } })
    } else {
      await this.prisma.client.savedItem.deleteMany({ where: { userId: actor.id, kind: dto.kind, itemId: dto.itemId } })
    }
    return { ok: true }
  }
}
