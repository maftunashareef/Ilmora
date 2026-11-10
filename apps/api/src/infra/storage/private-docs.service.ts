import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { HttpStatus, Inject, Injectable } from '@nestjs/common'
import { AppError } from '../../common/errors'
import { ENV, type Env } from '../../config/env'

/** Document types accepted for certificates (ТЗ 4.3, 5.5): PDF, JPEG, PNG — recognised by their first bytes, not the name. */
export const DOC_TYPES = {
  'application/pdf': { ext: 'pdf', magic: [Buffer.from('%PDF-')] },
  'image/jpeg': { ext: 'jpg', magic: [Buffer.from([0xff, 0xd8, 0xff])] },
  'image/png': { ext: 'png', magic: [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])] },
} as const
export type DocContentType = keyof typeof DOC_TYPES
export const DOC_MAX_BYTES = 10 * 1024 * 1024
/** Download links live 5 minutes (ТЗ 9.2). */
export const DOC_LINK_SECONDS = 300

/** The type the first bytes show, or null — whatever the browser claimed. */
export function sniffDocType(head: Buffer): DocContentType | null {
  for (const [type, spec] of Object.entries(DOC_TYPES) as [DocContentType, (typeof DOC_TYPES)[DocContentType]][]) {
    if (spec.magic.some((m) => head.length >= m.length && head.subarray(0, m.length).equals(m))) return type
  }
  return null
}

/**
 * The private bucket for documents (`ilmora-docs`: company certificates, student certificates). Unlike the media
 * bucket nothing here has a public address: the browser uploads with a presigned PUT and every read is a presigned GET
 * that lives 5 minutes. Without S3_DOCS_BUCKET (or the S3 credentials) every call answers 503 `storage_unavailable`.
 */
@Injectable()
export class PrivateDocsService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  get configured(): boolean {
    return !!(this.env.S3_ENDPOINT && this.env.S3_DOCS_BUCKET && this.env.S3_ACCESS_KEY_ID && this.env.S3_SECRET_ACCESS_KEY)
  }

  /** A presigned PUT (10 minutes) with the content type and size fixed: the storage refuses anything else. */
  async uploadUrl(key: string, contentType: DocContentType, size: number): Promise<string> {
    return getSignedUrl(this.s3(), new PutObjectCommand({ Bucket: this.bucket(), Key: key, ContentType: contentType, ContentLength: size }), { expiresIn: 600 })
  }

  /** A presigned GET that lives DOC_LINK_SECONDS. */
  async downloadUrl(key: string): Promise<string> {
    return getSignedUrl(this.s3(), new GetObjectCommand({ Bucket: this.bucket(), Key: key }), { expiresIn: DOC_LINK_SECONDS })
  }

  /** Size and first 16 bytes of an uploaded object, or null when there is none. */
  async inspect(key: string): Promise<{ size: number; head: Buffer } | null> {
    const s3 = this.s3()
    try {
      const meta = await s3.send(new HeadObjectCommand({ Bucket: this.bucket(), Key: key }))
      const part = await s3.send(new GetObjectCommand({ Bucket: this.bucket(), Key: key, Range: 'bytes=0-15' }))
      const head = Buffer.from(await part.Body!.transformToByteArray())
      return { size: meta.ContentLength ?? 0, head }
    } catch (err) {
      const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode
      if (status === 404 || (err as { name?: string }).name === 'NotFound' || (err as { name?: string }).name === 'NoSuchKey') return null
      throw err
    }
  }

  async remove(key: string): Promise<void> {
    await this.s3().send(new DeleteObjectCommand({ Bucket: this.bucket(), Key: key }))
  }

  private bucket(): string {
    if (!this.configured) throw new AppError('storage_unavailable', 'Document storage is not configured in this environment', HttpStatus.SERVICE_UNAVAILABLE)
    return this.env.S3_DOCS_BUCKET!
  }

  private s3(): S3Client {
    this.bucket()
    return new S3Client({
      endpoint: this.env.S3_ENDPOINT,
      region: this.env.S3_REGION,
      credentials: { accessKeyId: this.env.S3_ACCESS_KEY_ID!, secretAccessKey: this.env.S3_SECRET_ACCESS_KEY! },
      forcePathStyle: this.env.S3_FORCE_PATH_STYLE,
    })
  }
}
