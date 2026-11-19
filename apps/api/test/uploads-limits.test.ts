/**
 * File uploads against the ТЗ requirements: limits, names with `../`, executable files, expiry and rights of temporary
 * links, and «no file above the limit by skipping the browser's check». No database: the services are built directly.
 *
 * What is proven here: the API signs the content type and the exact size (plus method, key and expiry) into every
 * presigned PUT, and refuses out-of-limit sizes, executable/active types and odd file names before signing. What is NOT
 * proven: that the S3-compatible provider (UzCloud) actually enforces the signed headers on the real PUT — that is the
 * provider's SigV4 behaviour and is not exercised by these tests. Executable files are refused by the declared content
 * type only; for public uploads (media bucket) the bytes are not inspected after upload (private documents are, by
 * `PrivateDocsService.verifyUpload`).
 *
 * ZIP archives: the API accepts a ZIP only as a teacher resource file (POST /manage/uploads/resource-file/upload-url)
 * and never unpacks it — the browser PUTs the bytes straight into object storage and students download them as is.
 * The «no unpacking» test below checks that no archive library is a dependency and no decompression call is in src, so
 * zip-bomb and «file inside the archive» checks do not apply to the current route; the archive as a whole is bound by
 * the 50 MB signed size. If a server-side unpack ever appears, it needs its own limits (total uncompressed size, entry
 * count, ratio, entry names without `..`/absolute paths) — and this test will fail first.
 */
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ZodValidationPipe } from '../src/common/zod.pipe'
import { DOC_LINK_SECONDS, PrivateDocsService } from '../src/infra/storage/private-docs.service'
import { presignPut, s3ClientConfig } from '../src/infra/storage/s3-client'
import type { RequestActor } from '../src/infra/tenancy/tenant-context'
import { AvatarUploadUrlInput, IMAGE_UPLOAD_MAX_BYTES, ImageUploadUrlInput, RESOURCE_FILE_UPLOAD_MAX_BYTES, ResourceFileUploadUrlInput } from '../src/modules/manage/manage.schemas'
import { ManageService } from '../src/modules/manage/manage.service'
import { UploadsService } from '../src/modules/manage/uploads.service'
import type { SiteService } from '../src/modules/site/site.service'
import { testEnv } from './helpers'

// testEnv spreads process.env: everything these tests rely on being unset is set to undefined explicitly.
const S3 = {
  S3_ENDPOINT: 'https://s3.uzcstorage.uz', S3_REGION: 'us-east-1', S3_BUCKET: 'ilmora-media', S3_ACCESS_KEY_ID: 'test-key', S3_SECRET_ACCESS_KEY: 'test-secret',
  S3_FORCE_PATH_STYLE: 'true', S3_PUBLIC_BASE_URL: undefined, S3_DOCS_BUCKET: undefined,
}
const env = testEnv(S3)
const docsEnv = testEnv({ ...S3, S3_DOCS_BUCKET: 'ilmora-docs' })
const AVATAR_MAX_BYTES = 2 * 1024 * 1024

const siteWith = (perms: Record<string, boolean>) => ({ get: async () => ({ permissions: { teacher: perms } }) }) as unknown as SiteService
const uploads = (uploadResources = true) => new UploadsService(siteWith({ uploadResources }), env)
/** ManageService with stubs: the avatar/logo presign touches only the site settings and the env. */
const manage = (customizeChannel = true) => new ManageService({} as never, {} as never, {} as never, siteWith({ customizeChannel }), {} as never, env)

const TENANT = 'tenant-a'
const teacher: RequestActor = { id: 'user-1', roles: ['TEACHER', 'STUDENT'], teacherProfileId: 'prof-1' }
const admin: RequestActor = { id: 'admin-1', roles: ['PLATFORM_ADMIN'] }
const zipInput = { fileName: 'homework-secretname.zip', contentType: 'application/zip' as const, fileSize: 1234 }
const avatarInput = { fileName: 'me.png', contentType: 'image/png' as const, fileSize: 4096 }

const lowerParams = (url: URL) => new Map([...url.searchParams].map(([k, v]) => [k.toLowerCase(), v]))
const signature = (url: string) => new URL(url).searchParams.get('X-Amz-Signature')
const newS3 = (e = env) => new S3Client(s3ClientConfig(e))
/** The PUT signature our own code should have produced for this key/type/size/expiry. */
const expectedPut = async (Bucket: string, Key: string, ContentType: string, ContentLength: number, expiresIn: number, e = env) =>
  signature(await presignPut(newS3(e), new PutObjectCommand({ Bucket, Key, ContentType, ContentLength }), expiresIn))

/** Same second for the service's link and the recomputed one (only Date is faked, so the SDK's async work runs normally). */
const freezeClock = () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-19T10:00:00Z'))
}

afterEach(() => {
  vi.useRealTimers()
})

describe('Resource file presign (POST /manage/uploads/resource-file/upload-url)', () => {
  it('a PUT under the bucket, key from tenant/profile/time/nonce only, 15 minutes, type and size signed', async () => {
    const { uploadUrl, key, publicUrl } = await uploads().resourceFile(TENANT, teacher, zipInput)
    const url = new URL(uploadUrl)
    const q = lowerParams(url)

    // Path-style address inside the media bucket; the key is ours, never the browser's file name.
    expect(url.origin).toBe('https://s3.uzcstorage.uz')
    expect(url.pathname).toBe(`/ilmora-media/${key}`)
    expect(key.startsWith(`resources/${TENANT}/prof-1-`)).toBe(true)
    expect(key).toMatch(/^resources\/tenant-a\/prof-1-\d+-[0-9a-f]{8}\.zip$/)
    expect(key).not.toContain('homework')
    expect(key).not.toContain('secretname')
    expect(key).not.toContain('..')
    expect(publicUrl).toBe(`https://s3.uzcstorage.uz/ilmora-media/${key}`)

    // Expiry of the temporary link: 900 s.
    expect(q.get('x-amz-expires')).toBe('900')
    // content-type and content-length are part of the signed headers.
    expect(q.get('x-amz-signedheaders')?.split(';')).toEqual(expect.arrayContaining(['content-type', 'content-length', 'host']))
    // No checksum of an empty body (see s3-client.ts), which would otherwise break every real upload.
    expect([...q.keys()].filter((k) => k.includes('checksum'))).toEqual([])
  })

  it('the service signs exactly PUT + the declared type + the exact size + 900 s (signature recomputed and equal)', async () => {
    freezeClock()
    const { uploadUrl, key } = await uploads().resourceFile(TENANT, teacher, zipInput)
    const actual = signature(uploadUrl)
    expect(actual).toMatch(/^[0-9a-f]{64}$/)
    // Equal: the service's link is a PUT for this key, type, size and expiry — nothing else.
    expect(await expectedPut('ilmora-media', key, 'application/zip', zipInput.fileSize, 900)).toBe(actual)
    // Secondary: any other size, type, expiry or method gives another signature, so the provider would refuse it.
    expect(await expectedPut('ilmora-media', key, 'application/zip', zipInput.fileSize + 1, 900)).not.toBe(actual)
    expect(await expectedPut('ilmora-media', key, 'application/zip', 1024 * 1024 * 1024, 900)).not.toBe(actual)
    expect(await expectedPut('ilmora-media', key, 'text/html', zipInput.fileSize, 900)).not.toBe(actual)
    expect(await expectedPut('ilmora-media', key, 'application/zip', zipInput.fileSize, 604800)).not.toBe(actual)
    // SigV4 signs the HTTP method (first line of the canonical request): the same key signed for GET differs.
    expect(signature(await getSignedUrl(newS3(), new GetObjectCommand({ Bucket: 'ilmora-media', Key: key }), { expiresIn: 900 }))).not.toBe(actual)
  })

  it('a link at exactly the 50 MB limit carries that size; one byte more is another signature', async () => {
    freezeClock()
    const input = { ...zipInput, fileSize: RESOURCE_FILE_UPLOAD_MAX_BYTES }
    const { uploadUrl, key } = await uploads().resourceFile(TENANT, teacher, input)
    expect(await expectedPut('ilmora-media', key, 'application/zip', RESOURCE_FILE_UPLOAD_MAX_BYTES, 900)).toBe(signature(uploadUrl))
    expect(await expectedPut('ilmora-media', key, 'application/zip', RESOURCE_FILE_UPLOAD_MAX_BYTES + 1, 900)).not.toBe(signature(uploadUrl))
  })

  it('every accepted type maps to a fixed extension; nothing executable can appear in the key', async () => {
    const cases = [
      ['application/pdf', 'pdf'],
      ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
      ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'pptx'],
      ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx'],
      ['application/zip', 'zip'],
      ['application/x-zip-compressed', 'zip'],
    ] as const
    for (const [contentType, ext] of cases) {
      const { key } = await uploads().resourceFile(TENANT, teacher, { fileName: 'run.exe', contentType, fileSize: 10 })
      expect(key.endsWith(`.${ext}`)).toBe(true)
      expect(key).not.toContain('exe')
    }
  })
})

describe('Upload input schemas: names, types, sizes', () => {
  const resource = new ZodValidationPipe(ResourceFileUploadUrlInput)
  const image = new ZodValidationPipe(ImageUploadUrlInput)
  const avatar = new ZodValidationPipe(AvatarUploadUrlInput)
  const okResource = { fileName: 'Урок 1 — задания.zip', contentType: 'application/zip', fileSize: 1024 }
  const okImage = { fileName: 'cover.png', contentType: 'image/png', fileSize: 1024 }

  const badNames = ['../evil.zip', '..\\evil.zip', '/etc/passwd', 'a/b.zip', 'C:evil.zip', 'a\u0000b.zip', 'a\nb.zip', 'a\rb.zip', 'a\tb.zip', 'a\u001fb.zip', '']
  const activeTypes = ['application/x-msdownload', 'application/x-sh', 'application/x-executable', 'application/octet-stream', 'text/html', 'image/svg+xml', 'application/javascript', 'text/javascript', 'application/x-msdos-program', 'APPLICATION/ZIP']

  it('accepts normal input (positive control)', () => {
    expect(resource.transform(okResource)).toEqual(okResource)
    expect(resource.transform({ ...okResource, fileSize: RESOURCE_FILE_UPLOAD_MAX_BYTES })).toMatchObject({ fileSize: RESOURCE_FILE_UPLOAD_MAX_BYTES })
    expect(image.transform(okImage)).toEqual(okImage)
    expect(image.transform({ ...okImage, fileSize: IMAGE_UPLOAD_MAX_BYTES })).toMatchObject({ fileSize: IMAGE_UPLOAD_MAX_BYTES })
    expect(avatar.transform(okImage)).toEqual(okImage)
    expect(avatar.transform({ ...okImage, fileSize: AVATAR_MAX_BYTES })).toMatchObject({ fileSize: AVATAR_MAX_BYTES })
  })

  it('limits are 50 MB for resource files and 8 MB for images', () => {
    expect(RESOURCE_FILE_UPLOAD_MAX_BYTES).toBe(50 * 1024 * 1024)
    expect(IMAGE_UPLOAD_MAX_BYTES).toBe(8 * 1024 * 1024)
  })

  for (const [label, pipe, ok, max, maxName] of [
    ['ResourceFileUploadUrlInput', resource, okResource, RESOURCE_FILE_UPLOAD_MAX_BYTES, 160],
    ['ImageUploadUrlInput', image, okImage, IMAGE_UPLOAD_MAX_BYTES, 160],
    // Avatars (POST /manage/profile/avatar/upload-url) and university logos (POST /admin/site/university-logo/upload-url): 2 MB.
    ['AvatarUploadUrlInput', avatar, okImage, AVATAR_MAX_BYTES, 120],
  ] as const) {
    describe(label, () => {
      it.each([...badNames, 'x'.repeat(maxName + 1)])('refuses file name %j (path separators, drive colon, control characters, empty, too long)', (fileName) => {
        expect(() => pipe.transform({ ...ok, fileName })).toThrow()
      })

      it.each(activeTypes)('refuses executable / active content type %s', (contentType) => {
        expect(() => pipe.transform({ ...ok, contentType })).toThrow()
      })

      it.each([0, -1, max + 1, 1024 * 1024 * 1024 + 1, 1.5, Number.MAX_SAFE_INTEGER, Number.POSITIVE_INFINITY, Number.NaN])('refuses fileSize %s', (fileSize) => {
        expect(() => pipe.transform({ ...ok, fileSize })).toThrow()
      })

      it('refuses a size sent as a string and a missing size', () => {
        expect(() => pipe.transform({ ...ok, fileSize: String(ok.fileSize) })).toThrow()
        const { fileSize: _omit, ...noSize } = ok
        expect(() => pipe.transform(noSize)).toThrow()
      })

      it('refuses extra fields (strict): the browser cannot choose the key, bucket or expiry', () => {
        for (const extra of [{ key: '../../other/x.zip' }, { bucket: 'ilmora-docs' }, { expiresIn: 604800 }, { contentLength: 1 }]) {
          expect(() => pipe.transform({ ...ok, ...extra })).toThrow()
        }
      })
    })
  }

  it('images and avatars: a resource type (zip/pdf) is not an image', () => {
    for (const pipe of [image, avatar]) {
      expect(() => pipe.transform({ ...okImage, contentType: 'application/zip' })).toThrow()
      expect(() => pipe.transform({ ...okImage, contentType: 'application/pdf' })).toThrow()
    }
  })
})

describe('Avatar and university logo presign (ManageService)', () => {
  // Known and reported: avatar/logo keys are `<prefix>-<Date.now()>.<ext>` with no random part
  // (manage.service.ts:813), so two links for the same profile in the same millisecond share a key.
  it('avatar: PUT under avatars/<tenant>/<profile>-<time>.png, 900 s, type and exact size signed (recomputed, equal)', async () => {
    freezeClock()
    const { uploadUrl, key, publicUrl } = await manage().generateAvatarUploadUrl(TENANT, teacher, avatarInput)
    const url = new URL(uploadUrl)
    const q = lowerParams(url)
    expect(key).toMatch(/^avatars\/tenant-a\/prof-1-\d+\.png$/)
    expect(key).not.toContain('me')
    expect(url.origin + url.pathname).toBe(`https://s3.uzcstorage.uz/ilmora-media/${key}`)
    expect(publicUrl).toBe(`https://s3.uzcstorage.uz/ilmora-media/${key}`)
    expect(q.get('x-amz-expires')).toBe('900')
    expect(q.get('x-amz-signedheaders')?.split(';')).toEqual(expect.arrayContaining(['content-type', 'content-length']))
    expect(await expectedPut('ilmora-media', key, 'image/png', avatarInput.fileSize, 900)).toBe(signature(uploadUrl))
    expect(await expectedPut('ilmora-media', key, 'image/png', avatarInput.fileSize + 1, 900)).not.toBe(signature(uploadUrl))
  })

  it('avatar: refuses an actor without a teacher profile and a teacher when customizeChannel is off (403)', async () => {
    await expect(manage().generateAvatarUploadUrl(TENANT, { id: 'u-student', roles: ['STUDENT'] }, avatarInput)).rejects.toMatchObject({ status: 403, code: 'forbidden' })
    await expect(manage(false).generateAvatarUploadUrl(TENANT, teacher, avatarInput)).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  })

  it('university logo: PUT under universities/<tenant>/logo-<time>.<ext>, 900 s, type and size signed', async () => {
    freezeClock()
    const input = { fileName: 'logo.webp', contentType: 'image/webp' as const, fileSize: 2048 }
    const { uploadUrl, key } = await manage().generateUniversityLogoUploadUrl(TENANT, input)
    expect(key).toMatch(/^universities\/tenant-a\/logo-\d+\.webp$/)
    expect(lowerParams(new URL(uploadUrl)).get('x-amz-expires')).toBe('900')
    expect(await expectedPut('ilmora-media', key, 'image/webp', 2048, 900)).toBe(signature(uploadUrl))
  })
})

describe('Private documents (PrivateDocsService, bucket ilmora-docs)', () => {
  const docs = new PrivateDocsService(docsEnv)

  it('upload link: PUT into the private bucket, 600 s, type and exact size signed (recomputed, equal)', async () => {
    freezeClock()
    const key = docs.newKey('company-certs/tenant-a/c1/', 'application/pdf')
    expect(key).toMatch(/^incoming\/company-certs\/tenant-a\/c1\/\d+-[0-9a-f]{16}\.pdf$/)
    const uploadUrl = await docs.uploadUrl(key, 'application/pdf', 4096)
    const url = new URL(uploadUrl)
    const q = lowerParams(url)
    expect(url.origin + url.pathname).toBe(`https://s3.uzcstorage.uz/ilmora-docs/${key}`)
    expect(q.get('x-amz-expires')).toBe('600')
    expect(q.get('x-amz-signedheaders')?.split(';')).toEqual(expect.arrayContaining(['content-type', 'content-length']))
    expect(await expectedPut('ilmora-docs', key, 'application/pdf', 4096, 600, docsEnv)).toBe(signature(uploadUrl))
    expect(await expectedPut('ilmora-docs', key, 'application/pdf', 4097, 600, docsEnv)).not.toBe(signature(uploadUrl))
    expect(await expectedPut('ilmora-docs', key, 'text/html', 4096, 600, docsEnv)).not.toBe(signature(uploadUrl))
  })

  it('download link: a GET that lives 300 s (5 minutes) and saves the file as an attachment', async () => {
    expect(DOC_LINK_SECONDS).toBe(300)
    const url = new URL(await docs.downloadUrl('company-certs/tenant-a/c1/1-abc.pdf'))
    const q = lowerParams(url)
    expect(url.pathname).toBe('/ilmora-docs/company-certs/tenant-a/c1/1-abc.pdf')
    expect(q.get('x-amz-expires')).toBe('300')
    expect(q.get('response-content-disposition')).toBe('attachment; filename="1-abc.pdf"')
  })

  it('without the private bucket configured every link answers 503 storage_unavailable', async () => {
    const off = new PrivateDocsService(env)
    await expect(off.uploadUrl('incoming/x.pdf', 'application/pdf', 1)).rejects.toMatchObject({ code: 'storage_unavailable', status: 503 })
    await expect(off.downloadUrl('x.pdf')).rejects.toMatchObject({ code: 'storage_unavailable', status: 503 })
  })

  it('verifyUpload refuses keys outside the owner prefix or with ../ before touching storage', async () => {
    for (const key of ['incoming/company-certs/tenant-b/c1/1.pdf', 'incoming/company-certs/tenant-a/c1/../../tenant-b/1.pdf', 'company-certs/tenant-a/c1/1.pdf']) {
      await expect(docs.verifyUpload(key, 'company-certs/tenant-a/c1/')).rejects.toMatchObject({ code: 'invalid_file' })
    }
  })
})

describe('Who may get a resource-file upload link', () => {
  it('refuses an actor without a teacher profile (403), before reading site settings', async () => {
    const get = vi.fn(async () => ({ permissions: { teacher: { uploadResources: true } } }))
    const svc = new UploadsService({ get } as unknown as SiteService, env)
    for (const actor of [
      { id: 'u-student', roles: ['STUDENT'] },
      { id: 'u-center', roles: ['CENTER_ADMIN'], centerId: 'c1' },
      { id: 'u-teacher-no-profile', roles: ['TEACHER'], teacherProfileId: null },
    ] as RequestActor[]) {
      await expect(svc.resourceFile(TENANT, actor, zipInput)).rejects.toMatchObject({ status: 403, code: 'forbidden' })
    }
    expect(get).not.toHaveBeenCalled()
  })

  it('refuses a teacher when the workspace switch uploadResources is off (403)', async () => {
    await expect(uploads(false).resourceFile(TENANT, teacher, zipInput)).rejects.toMatchObject({ status: 403, code: 'forbidden' })
  })

  it('the Super Admin is not bound by the switch; the key carries their user id', async () => {
    const { key } = await uploads(false).resourceFile(TENANT, admin, zipInput)
    expect(key.startsWith(`resources/${TENANT}/admin-1-`)).toBe(true)
  })

  it('without storage configured the link is 503 storage_unavailable (no unsigned fallback)', async () => {
    const svc = new UploadsService(siteWith({ uploadResources: true }), { ...env, S3_ENDPOINT: undefined, S3_BUCKET: undefined })
    await expect(svc.resourceFile(TENANT, teacher, zipInput)).rejects.toMatchObject({ code: 'storage_unavailable', status: 503 })
  })
})

describe('Archives are never unpacked on the server', () => {
  const apiRoot = join(__dirname, '..')
  let sources: { file: string; text: string }[] = []

  beforeEach(() => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) return name === 'generated' || name === 'node_modules' ? [] : walk(full)
        return full.endsWith('.ts') ? [full] : []
      })
    sources = walk(join(apiRoot, 'src')).map((file) => ({ file, text: readFileSync(file, 'utf8') }))
  })

  it('no archive library among the dependencies', () => {
    const pkg = JSON.parse(readFileSync(join(apiRoot, 'package.json'), 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
    expect(deps.length).toBeGreaterThan(0)
    const archiveLibs = ['yauzl', 'adm-zip', 'jszip', 'unzipper', 'extract-zip', 'decompress', 'node-stream-zip']
    expect(deps.filter((d) => archiveLibs.includes(d))).toEqual([])
  })

  it('no decompression call in apps/api/src', () => {
    expect(sources.length).toBeGreaterThan(10)
    const hits = sources.filter((s) => /createGunzip|createInflate|inflateSync|unzip/i.test(s.text)).map((s) => s.file)
    expect(hits).toEqual([])
  })
})
