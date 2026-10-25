import { describe, expect, it, vi } from 'vitest'
import { ZodValidationPipe } from '../src/common/zod.pipe'
import type { Env } from '../src/config/env'
import type { PrismaService } from '../src/infra/prisma/prisma.service'
import type { RequestActor } from '../src/infra/tenancy/tenant-context'
import type { AuditService } from '../src/modules/audit/audit.service'
import { AvatarUploadUrlInput, TeacherPatch } from '../src/modules/manage/manage.schemas'
import { ManageService } from '../src/modules/manage/manage.service'
import type { SessionsService } from '../src/modules/sessions/sessions.service'
import type { SiteService } from '../src/modules/site/site.service'

describe('Teacher Profile Self-Service and Image Uploads', () => {
  const avatarPipe = new ZodValidationPipe(AvatarUploadUrlInput)
  const teacherPatchPipe = new ZodValidationPipe(TeacherPatch)

  type MockTeacher = {
    id: string
    tenantId: string
    slug: string
    name: string
    title?: unknown
    bio?: unknown
    expertise?: string[]
    centerId?: string | null
    avatarSeed?: number
    bannerTone?: string
    avatarUrl?: string | null
    bannerUrl?: string | null
    tagline?: unknown
    channelActive?: boolean
    featuredType?: string | null
    featuredId?: string | null
    userId?: string | null
  }

  type MockCourse = { id: string; tenantId: string; teacherId: string }
  type MockPlaylist = { id: string; tenantId: string; teacherId: string }

  const makeMockPrisma = (initialTeacher: Partial<MockTeacher>, extra?: { course?: MockCourse; playlist?: MockPlaylist }) => ({
    client: {
      teacherProfile: {
        findFirst: vi.fn().mockImplementation(async ({ where }: { where: { id: string; tenantId?: string } }) => {
          if (where.id === initialTeacher.id && (!where.tenantId || where.tenantId === initialTeacher.tenantId)) {
            return initialTeacher
          }
          return null
        }),
        update: vi.fn().mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
          ...initialTeacher,
          ...data,
          id: where.id,
        })),
        create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
          ...data,
          id: 'tp-new',
        })),
      },
      user: {
        update: vi.fn().mockResolvedValue({}),
        upsert: vi.fn().mockResolvedValue({ id: 'user-new', roles: ['TEACHER'] }),
      },
      course: {
        findFirst: vi.fn().mockImplementation(async ({ where }: { where: { id: string; teacherId?: string } }) => {
          if (extra?.course && where.id === extra.course.id && (!where.teacherId || where.teacherId === extra.course.teacherId)) {
            return extra.course
          }
          return null
        }),
      },
      playlist: {
        findFirst: vi.fn().mockImplementation(async ({ where }: { where: { id: string; teacherId?: string } }) => {
          if (extra?.playlist && where.id === extra.playlist.id && (!where.teacherId || where.teacherId === extra.playlist.teacherId)) {
            return extra.playlist
          }
          return null
        }),
      },
    },
  })

  const makeService = (
    prismaMock: ReturnType<typeof makeMockPrisma>,
    envMock: Partial<Env> = {},
    siteMock?: Partial<SiteService>,
  ) => {
    return new ManageService(
      prismaMock as unknown as PrismaService,
      {} as unknown as AuditService,
      {} as unknown as SessionsService,
      (siteMock ?? {}) as unknown as SiteService,
      envMock as unknown as Env,
    )
  }

  it('allows teacher to update their own profile with biography, specializations, languages, and avatarUrl', async () => {
    const existing: MockTeacher = {
      id: 'tp-101',
      tenantId: 'tenant-1',
      slug: 'alisher-odilov',
      name: 'Alisher Odilov',
      title: { uz: 'Matematika ustozi', ru: 'Учитель математики', en: 'Math Teacher' },
      bio: { uz: '10 yil tajriba', ru: '10 лет опыта', en: '10 years experience' },
      expertise: ['Matematika', 'Algebra'],
      centerId: 'c-1',
      avatarSeed: 3,
      bannerTone: '#163C35',
      avatarUrl: null,
      bannerUrl: null,
      tagline: { uz: 'Ilm nuri', ru: 'Свет знаний', en: 'Light of knowledge' },
      channelActive: true,
      featuredType: null,
      featuredId: null,
      userId: 'user-101',
    }

    const mockPrisma = makeMockPrisma(existing)
    const service = makeService(mockPrisma, { S3_ENDPOINT: undefined, S3_BUCKET: undefined })

    const actor: RequestActor = {
      id: 'user-101',
      roles: ['TEACHER'],
      teacherProfileId: 'tp-101',
      centerId: 'c-1',
    }

    const patch = teacherPatchPipe.transform({
      name: 'Alisher O. Odilov',
      bio: { uz: 'Yangilangan tarjimai hol', ru: 'Обновленная биография', en: 'Updated biography' },
      expertise: ['Matematika', 'Algebra', 'Oliy toifa', 'O‘zbek tili', 'Rus tili', '5+ yil tajriba'],
      avatarUrl: 'https://cdn.example.uz/avatars/alisher.jpg',
      bannerTone: '#202725',
    })

    const updated = await service.updateOwnTeacherProfile('tenant-1', actor, patch)

    expect(updated.name).toBe('Alisher O. Odilov')
    expect(updated.avatarUrl).toBe('https://cdn.example.uz/avatars/alisher.jpg')
    expect(updated.expertise).toEqual(['Matematika', 'Algebra', 'Oliy toifa', 'O‘zbek tili', 'Rus tili', '5+ yil tajriba'])
    expect(mockPrisma.client.teacherProfile.update).toHaveBeenCalled()
    expect(mockPrisma.client.user.update).toHaveBeenCalledWith({
      where: { id: 'user-101' },
      data: { displayName: 'Alisher O. Odilov' },
    })
  })

  it('strictly forbids a teacher from modifying another teacher’s profile', async () => {
    const existing: MockTeacher = {
      id: 'tp-999',
      tenantId: 'tenant-1',
      slug: 'other-teacher',
      name: 'Other Teacher',
      userId: 'user-999',
    }

    const mockPrisma = makeMockPrisma(existing)
    const service = makeService(mockPrisma)

    const maliciousTeacher: RequestActor = {
      id: 'user-101',
      roles: ['TEACHER'],
      teacherProfileId: 'tp-101', // different teacher profile
      centerId: 'c-1',
    }

    await expect(
      service.updateTeacherScoped('tenant-1', maliciousTeacher, 'tp-999', {
        name: 'Hacked Name',
      }),
    ).rejects.toMatchObject({
      code: 'forbidden',
      message: 'Cannot edit another teacher profile',
    })

    expect(mockPrisma.client.teacherProfile.update).not.toHaveBeenCalled()
  })

  it('strictly forbids a teacher from changing centerId', async () => {
    const existing: MockTeacher = {
      id: 'tp-101',
      tenantId: 'tenant-1',
      slug: 'alisher-odilov',
      name: 'Alisher Odilov',
      centerId: 'c-1',
      userId: 'user-101',
    }

    const mockPrisma = makeMockPrisma(existing)
    const service = makeService(mockPrisma)

    const actor: RequestActor = {
      id: 'user-101',
      roles: ['TEACHER'],
      teacherProfileId: 'tp-101',
      centerId: 'c-1',
    }

    await expect(
      service.updateOwnTeacherProfile('tenant-1', actor, {
        centerId: 'c-other-center',
      }),
    ).rejects.toMatchObject({
      code: 'forbidden',
      message: 'Only administrators can change center affiliation',
    })

    expect(mockPrisma.client.teacherProfile.update).not.toHaveBeenCalled()
  })

  it('strictly forbids a teacher from changing account phone link', async () => {
    const existing: MockTeacher = {
      id: 'tp-101',
      tenantId: 'tenant-1',
      slug: 'alisher-odilov',
      name: 'Alisher Odilov',
      centerId: 'c-1',
      userId: 'user-101',
    }

    const mockPrisma = makeMockPrisma(existing)
    const service = makeService(mockPrisma)

    const actor: RequestActor = {
      id: 'user-101',
      roles: ['TEACHER'],
      teacherProfileId: 'tp-101',
      centerId: 'c-1',
    }

    await expect(
      service.updateOwnTeacherProfile('tenant-1', actor, {
        phone: '+998901234567',
      }),
    ).rejects.toMatchObject({
      code: 'forbidden',
      message: 'Only administrators can change account links',
    })

    expect(mockPrisma.client.teacherProfile.update).not.toHaveBeenCalled()
  })

  it('strictly forbids a teacher from referencing another teacher’s storage avatar', async () => {
    const existing: MockTeacher = {
      id: 'tp-101',
      tenantId: 'tenant-1',
      slug: 'alisher-odilov',
      name: 'Alisher Odilov',
      centerId: 'c-1',
      userId: 'user-101',
    }

    const mockPrisma = makeMockPrisma(existing)
    const service = makeService(mockPrisma)

    const actor: RequestActor = {
      id: 'user-101',
      roles: ['TEACHER'],
      teacherProfileId: 'tp-101',
      centerId: 'c-1',
    }

    await expect(
      service.updateOwnTeacherProfile('tenant-1', actor, {
        avatarUrl: '/avatars/tenant-1/tp-other-1729676000000.jpg',
      }),
    ).rejects.toMatchObject({
      code: 'forbidden',
      message: 'Cannot use an avatar image belonging to another teacher',
    })

    expect(mockPrisma.client.teacherProfile.update).not.toHaveBeenCalled()
  })

  it('strictly forbids a teacher from featuring a course that belongs to another teacher', async () => {
    const existing: MockTeacher = {
      id: 'tp-101',
      tenantId: 'tenant-1',
      slug: 'alisher-odilov',
      name: 'Alisher Odilov',
      centerId: 'c-1',
      userId: 'user-101',
    }

    const otherCourse: MockCourse = {
      id: 'c-other-teacher',
      tenantId: 'tenant-1',
      teacherId: 'tp-someone-else',
    }

    const mockPrisma = makeMockPrisma(existing, { course: otherCourse })
    const service = makeService(mockPrisma)

    const actor: RequestActor = {
      id: 'user-101',
      roles: ['TEACHER'],
      teacherProfileId: 'tp-101',
      centerId: 'c-1',
    }

    await expect(
      service.updateOwnTeacherProfile('tenant-1', actor, {
        featured: { type: 'course', id: 'c-other-teacher' },
      }),
    ).rejects.toMatchObject({
      code: 'invalid_featured',
      message: 'Featured course must belong to your profile',
    })

    expect(mockPrisma.client.teacherProfile.update).not.toHaveBeenCalled()
  })

  it('rejects updates if customizeChannel permission is disabled in workspace', async () => {
    const existing: MockTeacher = {
      id: 'tp-101',
      tenantId: 'tenant-1',
      slug: 'alisher-odilov',
      name: 'Alisher Odilov',
      centerId: 'c-1',
      userId: 'user-101',
    }

    const mockPrisma = makeMockPrisma(existing)
    const mockSite = {
      get: vi.fn().mockResolvedValue({
        permissions: {
          teacher: {
            customizeChannel: false,
          },
        },
      }),
    }
    const service = makeService(mockPrisma, {}, mockSite as unknown as Partial<SiteService>)

    const actor: RequestActor = {
      id: 'user-101',
      roles: ['TEACHER'],
      teacherProfileId: 'tp-101',
      centerId: 'c-1',
    }

    await expect(
      service.updateOwnTeacherProfile('tenant-1', actor, {
        name: 'New Name',
      }),
    ).rejects.toMatchObject({
      code: 'forbidden',
      message: 'Teacher profile customization is disabled in this workspace',
    })

    await expect(
      service.generateAvatarUploadUrl('tenant-1', actor, {
        fileName: 'photo.jpg',
        contentType: 'image/jpeg',
        fileSize: 1024 * 100,
      }),
    ).rejects.toMatchObject({
      code: 'forbidden',
      message: 'Teacher profile customization is disabled in this workspace',
    })
  })

  it('allows PLATFORM_ADMIN to manage any teacher profile in tenant, including center and phone', async () => {
    const existing: MockTeacher = {
      id: 'tp-999',
      tenantId: 'tenant-1',
      slug: 'teacher-x',
      name: 'Teacher X',
      centerId: 'c-1',
      title: {},
      bio: {},
      expertise: [],
      tagline: {},
      channelActive: true,
      userId: 'user-999',
    }

    const mockPrisma = makeMockPrisma(existing)
    const service = makeService(mockPrisma)

    const admin: RequestActor = {
      id: 'user-admin',
      roles: ['PLATFORM_ADMIN'],
      teacherProfileId: null,
      centerId: null,
    }

    const result = await service.updateTeacherScoped('tenant-1', admin, 'tp-999', {
      name: 'Admin Verified Teacher',
      centerId: 'c-2',
    })

    expect(result.name).toBe('Admin Verified Teacher')
    expect(mockPrisma.client.teacherProfile.update).toHaveBeenCalled()
  })

  it('validates safe image upload MIME types and rejects unsafe or unsupported files', () => {
    // Valid jpeg, png, webp
    expect(() =>
      avatarPipe.transform({
        fileName: 'profile.jpg',
        contentType: 'image/jpeg',
        fileSize: 1024 * 500, // 500 KB
      }),
    ).not.toThrow()

    expect(() =>
      avatarPipe.transform({
        fileName: 'profile.png',
        contentType: 'image/png',
        fileSize: 1024 * 1024, // 1 MB
      }),
    ).not.toThrow()

    expect(() =>
      avatarPipe.transform({
        fileName: 'profile.webp',
        contentType: 'image/webp',
        fileSize: 1024 * 200, // 200 KB
      }),
    ).not.toThrow()

    // Rejects unsafe SVG (script injection risk)
    expect(() =>
      avatarPipe.transform({
        fileName: 'malicious.svg',
        contentType: 'image/svg+xml',
        fileSize: 1024,
      }),
    ).toThrow()

    // Rejects GIF
    expect(() =>
      avatarPipe.transform({
        fileName: 'animation.gif',
        contentType: 'image/gif',
        fileSize: 1024,
      }),
    ).toThrow()

    // Rejects PDF or text
    expect(() =>
      avatarPipe.transform({
        fileName: 'document.pdf',
        contentType: 'application/pdf',
        fileSize: 1024,
      }),
    ).toThrow()

    // Rejects executables or scripts
    expect(() =>
      avatarPipe.transform({
        fileName: 'script.sh',
        contentType: 'application/x-sh',
        fileSize: 1024,
      }),
    ).toThrow()
  })

  it('enforces file size limits on upload presigning', () => {
    // Exact 2MB limit (2,097,152 bytes) is allowed
    expect(() =>
      avatarPipe.transform({
        fileName: 'photo.jpg',
        contentType: 'image/jpeg',
        fileSize: 2 * 1024 * 1024,
      }),
    ).not.toThrow()

    // 1 byte is allowed
    expect(() =>
      avatarPipe.transform({
        fileName: 'tiny.jpg',
        contentType: 'image/jpeg',
        fileSize: 1,
      }),
    ).not.toThrow()

    // 0 bytes rejected
    expect(() =>
      avatarPipe.transform({
        fileName: 'empty.jpg',
        contentType: 'image/jpeg',
        fileSize: 0,
      }),
    ).toThrow()

    // Negative size rejected
    expect(() =>
      avatarPipe.transform({
        fileName: 'neg.jpg',
        contentType: 'image/jpeg',
        fileSize: -100,
      }),
    ).toThrow()

    // 2MB + 1 byte rejected
    expect(() =>
      avatarPipe.transform({
        fileName: 'huge.jpg',
        contentType: 'image/jpeg',
        fileSize: 2 * 1024 * 1024 + 1,
      }),
    ).toThrow()
  })

  it('rejects unsafe filenames containing path traversal or null bytes', () => {
    expect(() =>
      avatarPipe.transform({
        fileName: '../../etc/passwd',
        contentType: 'image/jpeg',
        fileSize: 1024,
      }),
    ).toThrow()

    expect(() =>
      avatarPipe.transform({
        fileName: 'image/test.jpg',
        contentType: 'image/jpeg',
        fileSize: 1024,
      }),
    ).toThrow()

    expect(() =>
      avatarPipe.transform({
        fileName: 'test\x00.jpg',
        contentType: 'image/jpeg',
        fileSize: 1024,
      }),
    ).toThrow()
  })

  it('validates safe image URL schemes and rejects XSS vectors in profile fields', () => {
    // Valid HTTPS, HTTP, relative path, or storage key
    expect(() =>
      teacherPatchPipe.transform({
        avatarUrl: 'https://cdn.example.uz/photo.jpg',
      }),
    ).not.toThrow()

    expect(() =>
      teacherPatchPipe.transform({
        avatarUrl: '/images/teachers/dilnoza-karimova.jpg',
      }),
    ).not.toThrow()

    expect(() =>
      teacherPatchPipe.transform({
        avatarUrl: 'avatars/tenant-1/photo.webp',
      }),
    ).not.toThrow()

    expect(() =>
      teacherPatchPipe.transform({
        avatarUrl: null,
      }),
    ).not.toThrow()

    // Rejects javascript: URI scheme
    expect(() =>
      teacherPatchPipe.transform({
        avatarUrl: 'javascript:alert(1)',
      }),
    ).toThrow()

    // Rejects data: URI scheme
    expect(() =>
      teacherPatchPipe.transform({
        avatarUrl: 'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
      }),
    ).toThrow()

    // Rejects malformed hex bannerTone
    expect(() =>
      teacherPatchPipe.transform({
        bannerTone: 'darkgreen',
      }),
    ).toThrow()

    // Rejects empty name
    expect(() =>
      teacherPatchPipe.transform({
        name: '',
      }),
    ).toThrow()
  })

  it('returns storage_not_configured error when S3 environment credentials are not configured', async () => {
    const mockPrisma = makeMockPrisma({})
    const service = makeService(mockPrisma, {
      S3_ENDPOINT: undefined,
      S3_BUCKET: undefined,
      S3_ACCESS_KEY_ID: undefined,
      S3_SECRET_ACCESS_KEY: undefined,
    })

    const actor: RequestActor = {
      id: 'user-101',
      roles: ['TEACHER'],
      teacherProfileId: 'tp-101',
      centerId: null,
    }

    await expect(
      service.generateAvatarUploadUrl('tenant-1', actor, {
        fileName: 'photo.jpg',
        contentType: 'image/jpeg',
        fileSize: 1024 * 200,
      }),
    ).rejects.toMatchObject({
      code: 'storage_not_configured',
      message: 'Object storage (S3) is not configured in this environment.',
    })
  })

  it('generates presigned upload URL and public URL with teacher-scoped key when storage is configured', async () => {
    const mockPrisma = makeMockPrisma({})
    const service = makeService(mockPrisma, {
      S3_ENDPOINT: 'https://s3.tashkent.ilmora.uz',
      S3_BUCKET: 'ilmora-assets',
      S3_ACCESS_KEY_ID: 'test-access-key',
      S3_SECRET_ACCESS_KEY: 'test-secret-key',
      S3_REGION: 'us-east-1',
      S3_FORCE_PATH_STYLE: true,
      S3_PUBLIC_BASE_URL: 'https://cdn.ilmora.uz',
    })

    const actor: RequestActor = {
      id: 'user-101',
      roles: ['TEACHER'],
      teacherProfileId: 'tp-101',
      centerId: 'c-1',
    }

    const result = await service.generateAvatarUploadUrl('tenant-1', actor, {
      fileName: 'avatar.webp',
      contentType: 'image/webp',
      fileSize: 1024 * 150,
    })

    expect(result.uploadUrl).toBeDefined()
    expect(result.key).toMatch(/^avatars\/tenant-1\/tp-101-\d+\.webp$/)
    expect(result.publicUrl).toMatch(/^https:\/\/cdn\.ilmora\.uz\/avatars\/tenant-1\/tp-101-\d+\.webp$/)
  })
})
