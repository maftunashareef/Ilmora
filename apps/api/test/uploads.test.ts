import { describe, expect, it } from 'vitest'
import { ZodValidationPipe } from '../src/common/zod.pipe'
import type { Env } from '../src/config/env'
import type { RequestActor } from '../src/infra/tenancy/tenant-context'
import { IMAGE_UPLOAD_MAX_BYTES, ImageUploadUrlInput, RESOURCE_FILE_UPLOAD_MAX_BYTES, ResourceFileUploadUrlInput } from '../src/modules/manage/manage.schemas'
import { UploadsService } from '../src/modules/manage/uploads.service'
import type { SiteService } from '../src/modules/site/site.service'

const configured: Partial<Env> = {
  S3_ENDPOINT: 'https://s3.tashkent.ilmora.uz', S3_BUCKET: 'ilmora-assets', S3_ACCESS_KEY_ID: 'test-access-key', S3_SECRET_ACCESS_KEY: 'test-secret-key',
  S3_REGION: 'us-east-1', S3_FORCE_PATH_STYLE: true, S3_PUBLIC_BASE_URL: 'https://cdn.ilmora.uz',
}
const unconfigured: Partial<Env> = { S3_ENDPOINT: undefined, S3_BUCKET: undefined, S3_ACCESS_KEY_ID: undefined, S3_SECRET_ACCESS_KEY: undefined }

const site = (uploadResources: boolean) => ({ get: async () => ({ permissions: { teacher: { uploadResources } } }) }) as unknown as SiteService
const make = (env: Partial<Env>, uploadResources = true) => new UploadsService(site(uploadResources), env as Env)

const teacher: RequestActor = { id: 'u-1', roles: ['TEACHER'], centerId: 'c-1', teacherProfileId: 'tp-1' }
const centerAdmin: RequestActor = { id: 'u-center', roles: ['CENTER_ADMIN'], centerId: 'c-1', teacherProfileId: null }
const owner: RequestActor = { id: 'u-owner', roles: ['PLATFORM_ADMIN'], centerId: null, teacherProfileId: null }

const png = { fileName: 'cover.png', contentType: 'image/png' as const, fileSize: 1024 * 300 }
const pdf = { fileName: 'Algebra 1.pdf', contentType: 'application/pdf' as const, fileSize: 1024 * 1024 * 3 }

describe('Studio uploads (presigned PUT)', () => {
  it('reports whether storage exists and answers 503 storage_unavailable for every presign without it', async () => {
    const s = make(unconfigured)
    expect(s.status()).toEqual({ configured: false })
    for (const call of [() => s.courseImage('t', teacher, png), () => s.videoThumbnail('t', teacher, png), () => s.banner('t', teacher, png), () => s.resourceFile('t', teacher, pdf)]) {
      await expect(call()).rejects.toMatchObject({ code: 'storage_unavailable' })
      await expect(call()).rejects.toSatisfy((e: { getStatus: () => number }) => e.getStatus() === 503)
    }
    expect(make(configured).status()).toEqual({ configured: true })
  })

  it('signs each kind under its own prefix with the owner in the key and the public address of the object', async () => {
    const s = make(configured)
    const image = await s.courseImage('t', teacher, png)
    expect(image.key).toMatch(/^courses\/t\/tp-1-\d+-[0-9a-f]{8}\.png$/)
    expect(image.publicUrl).toBe(`https://cdn.ilmora.uz/${image.key}`)
    expect(image.uploadUrl).toMatch(/^https:\/\/s3\.tashkent\.ilmora\.uz\/ilmora-assets\/courses\/t\/tp-1-.*X-Amz-Signature=/)
    expect((await s.videoThumbnail('t', teacher, { ...png, contentType: 'image/webp' })).key).toMatch(/^thumbnails\/t\/tp-1-\d+-[0-9a-f]{8}\.webp$/)
    expect((await s.banner('t', teacher, { ...png, contentType: 'image/jpeg' })).key).toMatch(/^banners\/t\/tp-1-\d+-[0-9a-f]{8}\.jpg$/)
    expect((await s.resourceFile('t', teacher, pdf)).key).toMatch(/^resources\/t\/tp-1-\d+-[0-9a-f]{8}\.pdf$/)
    // The browser's file name never reaches the key; the extension follows the content type.
    expect((await s.resourceFile('t', owner, { ...pdf, fileName: '../x.html', contentType: 'application/x-zip-compressed' })).key).toMatch(/^resources\/t\/u-owner-\d+-[0-9a-f]{8}\.zip$/)
  })

  it('lets centers upload course images but keeps thumbnails, banners and resource files to teachers and the Super Admin', async () => {
    const s = make(configured)
    expect((await s.courseImage('t', centerAdmin, png)).key).toMatch(/^courses\/t\/u-center-/)
    await expect(s.videoThumbnail('t', centerAdmin, png)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(s.banner('t', centerAdmin, png)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(s.resourceFile('t', centerAdmin, pdf)).rejects.toMatchObject({ code: 'forbidden' })
    expect((await s.videoThumbnail('t', owner, png)).key).toMatch(/^thumbnails\/t\/u-owner-/)
  })

  it('refuses resource files while the workspace switch "uploadResources" is off (the Super Admin is not bound by it)', async () => {
    const s = make(configured, false)
    await expect(s.resourceFile('t', teacher, pdf)).rejects.toMatchObject({ code: 'forbidden' })
    expect((await s.resourceFile('t', owner, pdf)).key).toMatch(/^resources\/t\/u-owner-/)
  })

  it('accepts only safe types and sizes', () => {
    const image = new ZodValidationPipe(ImageUploadUrlInput)
    const file = new ZodValidationPipe(ResourceFileUploadUrlInput)
    expect(() => image.transform({ ...png, fileSize: IMAGE_UPLOAD_MAX_BYTES })).not.toThrow()
    expect(() => image.transform({ ...png, fileSize: IMAGE_UPLOAD_MAX_BYTES + 1 })).toThrow()
    expect(() => image.transform({ ...png, contentType: 'image/svg+xml' })).toThrow()
    expect(() => image.transform({ ...png, contentType: 'image/gif' })).toThrow()
    for (const contentType of ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip']) {
      expect(() => file.transform({ ...pdf, contentType })).not.toThrow()
    }
    for (const contentType of ['text/html', 'image/svg+xml', 'application/javascript', 'text/javascript', 'application/x-sh', 'application/octet-stream']) {
      expect(() => file.transform({ ...pdf, contentType })).toThrow()
    }
    expect(() => file.transform({ ...pdf, fileSize: RESOURCE_FILE_UPLOAD_MAX_BYTES + 1 })).toThrow()
    expect(() => file.transform({ ...pdf, fileSize: 0 })).toThrow()
    expect(() => file.transform({ ...pdf, fileName: 'a/b.pdf' })).toThrow()
    expect(() => file.transform({ ...pdf, fileName: 'a\u0000.pdf' })).toThrow()
  })
})
