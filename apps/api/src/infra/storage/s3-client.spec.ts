import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { describe, expect, it } from 'vitest'
import type { Env } from '../../config/env'
import { presignPut, s3ClientConfig } from './s3-client'

const env = {
  S3_ENDPOINT: 'https://s3.uzcstorage.uz',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'ilmora-media',
  S3_ACCESS_KEY_ID: 'test-key',
  S3_SECRET_ACCESS_KEY: 'test-secret',
  S3_FORCE_PATH_STYLE: true,
} as Env

describe('S3 client settings', () => {
  it('signs upload addresses without a checksum and binds the content type and size', async () => {
    const url = new URL(
      await presignPut(new S3Client(s3ClientConfig(env)), new PutObjectCommand({ Bucket: 'ilmora-media', Key: 'a/b.png', ContentType: 'image/png', ContentLength: 1234 }), 900),
    )
    const params = [...url.searchParams.keys()].map((k) => k.toLowerCase())
    expect(params.filter((k) => k.includes('checksum'))).toEqual([])
    // Path style on the UzCloud endpoint; a file of another type or size does not match the signature.
    expect(url.origin + url.pathname).toBe('https://s3.uzcstorage.uz/ilmora-media/a/b.png')
    expect(url.searchParams.get('X-Amz-SignedHeaders')?.split(';')).toEqual(expect.arrayContaining(['content-type', 'content-length']))
  })
})
