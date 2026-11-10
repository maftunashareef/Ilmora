import type { PutObjectCommand, S3Client, S3ClientConfig } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { Env } from '../../config/env'

/**
 * Settings shared by every S3 client of the API (media uploads, avatars, private documents).
 *
 * `requestChecksumCalculation: 'WHEN_REQUIRED'`: by default the SDK writes the CRC32 of an empty body into every
 * presigned PUT address (`x-amz-checksum-crc32=AAAAAA==`), and the storage then refuses the real file the browser sends
 * (BadDigest), so no upload would ever succeed. Without it the address carries no checksum and the storage accepts the
 * file that matches the signed content type and size. Responses are validated only where the API asks for a checksum.
 */
export const s3ClientConfig = (env: Env): S3ClientConfig => ({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! },
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  requestChecksumCalculation: 'WHEN_REQUIRED',
  responseChecksumValidation: 'WHEN_REQUIRED',
})

/**
 * A presigned PUT that binds the content type as well as the size. By default the SDK signs only `content-length` and
 * `host`, so the browser could store any type (an HTML page under an image key in the public media bucket); with
 * `content-type` signed the storage refuses a file sent with another type than the API allowed.
 */
export const presignPut = (s3: S3Client, command: PutObjectCommand, expiresIn: number) =>
  getSignedUrl(s3, command, { expiresIn, signableHeaders: new Set(['content-type']) })
