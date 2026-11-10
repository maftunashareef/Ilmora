import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { presignPut, s3ClientConfig } from '../../infra/storage/s3-client'
import { randomBytes } from 'node:crypto'
import type { z } from 'zod'
import { AppError } from '../../common/errors'
import { ENV, type Env, s3Configured } from '../../config/env'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { SiteService } from '../site/site.service'
import type { ImageUploadUrlInput, ResourceFileUploadUrlInput } from './manage.schemas'

/** Object key extension for each accepted content type (the browser's file name is never part of the key). */
const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
}

type UploadInput = z.infer<typeof ImageUploadUrlInput> | z.infer<typeof ResourceFileUploadUrlInput>

/**
 * Presigned PUT addresses for the files the studio attaches to its content: course images, video thumbnails, channel
 * banners and resource files. The browser uploads straight to object storage and then saves the returned public URL
 * with the item. Without storage (S3 not configured) every presign answers 503 `storage_unavailable`, so the web can
 * hide its upload controls; teacher avatars keep their own route in ManageService.
 */
@Injectable()
export class UploadsService {
  constructor(private readonly site: SiteService, @Inject(ENV) private readonly env: Env) {}

  /** Whether files can be uploaded in this environment (the web hides its upload controls when not). */
  status() {
    return { configured: s3Configured(this.env) }
  }

  /** A course cover: teachers for their own courses, centers and the Super Admin for the courses they manage. */
  async courseImage(tenantId: string, actor: RequestActor, input: z.infer<typeof ImageUploadUrlInput>) {
    return this.presign(`courses/${tenantId}/${this.owner(actor)}`, input)
  }

  /** A video thumbnail (the video itself stays a YouTube/Vimeo link). */
  async videoThumbnail(tenantId: string, actor: RequestActor, input: z.infer<typeof ImageUploadUrlInput>) {
    this.requireTeacher(actor)
    return this.presign(`thumbnails/${tenantId}/${this.owner(actor)}`, input)
  }

  /** The channel banner; the key carries the profile id like avatars do (`banners/<tenant>/<profile>-<time>.<ext>`). */
  async banner(tenantId: string, actor: RequestActor, input: z.infer<typeof ImageUploadUrlInput>) {
    this.requireTeacher(actor)
    return this.presign(`banners/${tenantId}/${this.owner(actor)}`, input)
  }

  /** A guide or worksheet file; teachers only while the workspace lets them upload resources (the same switch gates saving). */
  async resourceFile(tenantId: string, actor: RequestActor, input: z.infer<typeof ResourceFileUploadUrlInput>) {
    this.requireTeacher(actor)
    if (!actor.roles.includes('PLATFORM_ADMIN')) {
      const site = await this.site.get(tenantId)
      if (!site.permissions?.teacher?.uploadResources) throw AppError.forbidden('Resource uploads are disabled for teachers')
    }
    return this.presign(`resources/${tenantId}/${this.owner(actor)}`, input)
  }

  private owner(actor: RequestActor) {
    return actor.teacherProfileId ?? actor.id
  }

  private requireTeacher(actor: RequestActor) {
    if (!actor.teacherProfileId && !actor.roles.includes('PLATFORM_ADMIN')) throw AppError.forbidden('No teacher profile linked to this account')
  }

  /** A presigned PUT (15 minutes, content type fixed) for one object under `<prefix>-<time>-<nonce>.<ext>` and its public address. */
  private async presign(prefix: string, input: UploadInput) {
    if (!s3Configured(this.env)) {
      throw new AppError('storage_unavailable', 'File storage is not configured in this environment', HttpStatus.SERVICE_UNAVAILABLE)
    }
    const s3 = new S3Client(s3ClientConfig(this.env))
    const ext = EXTENSIONS[input.contentType] ?? 'bin'
    const key = `${prefix}-${Date.now()}-${randomBytes(4).toString('hex')}.${ext}`
    const command = new PutObjectCommand({ Bucket: this.env.S3_BUCKET, Key: key, ContentType: input.contentType, ContentLength: input.fileSize })
    const uploadUrl = await presignPut(s3, command, 900)
    const baseUrl = this.env.S3_PUBLIC_BASE_URL ?? (this.env.S3_ENDPOINT ? `${this.env.S3_ENDPOINT}/${this.env.S3_BUCKET}` : '')
    const publicUrl = baseUrl ? `${baseUrl.replace(/\/+$/, '')}/${key}` : `/${key}`
    return { uploadUrl, publicUrl, key }
  }
}
