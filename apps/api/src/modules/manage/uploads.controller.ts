import { Body, Controller, Get, Post } from '@nestjs/common'
import type { z } from 'zod'
import { CurrentActor, CurrentTenantId, Roles } from '../../common/decorators'
import { ZodValidationPipe } from '../../common/zod.pipe'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { ImageUploadUrlInput, ResourceFileUploadUrlInput } from './manage.schemas'
import { UploadsService } from './uploads.service'

const body = <T>(schema: z.ZodType<T>) => new ZodValidationPipe(schema)

/** Upload addresses for studio files (presigned PUT to object storage); see UploadsService. */
@Controller('manage/uploads')
@Roles('TEACHER', 'PLATFORM_ADMIN')
export class UploadsController {
  constructor(private readonly uploads: UploadsService) {}

  /** Whether this environment stores files at all; centers ask too, since they edit course images. */
  @Roles('TEACHER', 'PLATFORM_ADMIN', 'CENTER_ADMIN') @Get('status') status() { return this.uploads.status() }
  @Roles('TEACHER', 'PLATFORM_ADMIN', 'CENTER_ADMIN') @Post('course-image/upload-url') courseImage(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Body(body(ImageUploadUrlInput)) dto: z.infer<typeof ImageUploadUrlInput>) { return this.uploads.courseImage(t, a, dto) }
  @Post('video-thumbnail/upload-url') videoThumbnail(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Body(body(ImageUploadUrlInput)) dto: z.infer<typeof ImageUploadUrlInput>) { return this.uploads.videoThumbnail(t, a, dto) }
  @Post('banner/upload-url') banner(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Body(body(ImageUploadUrlInput)) dto: z.infer<typeof ImageUploadUrlInput>) { return this.uploads.banner(t, a, dto) }
  @Post('resource-file/upload-url') resourceFile(@CurrentTenantId() t: string, @CurrentActor() a: RequestActor, @Body(body(ResourceFileUploadUrlInput)) dto: z.infer<typeof ResourceFileUploadUrlInput>) { return this.uploads.resourceFile(t, a, dto) }
}
