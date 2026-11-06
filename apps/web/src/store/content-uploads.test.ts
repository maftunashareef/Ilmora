import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sampleData } from '@ilmora/shared'
import type { Resource, Teacher, Video } from '../types'

/** The API client, recorded: every call's path, method and body, with a programmable answer. */
const fake = vi.hoisted(() => ({
  calls: [] as { path: string; method: string; body?: unknown }[],
  respond: ((_path: string, _body?: unknown): unknown => ({})) as (path: string, body?: unknown) => unknown,
}))
vi.mock('../lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/api')>()
  return {
    ...actual,
    api: async (path: string, opts?: { method?: string; body?: unknown }) => {
      fake.calls.push({ path, method: opts?.method ?? 'GET', body: opts?.body })
      return fake.respond(path, opts?.body)
    },
  }
})

import { createIlmoraStore, type InitialData } from './useStore'

const initialMock: InitialData = {
  lang: 'uz',
  site: Object.assign({}, sampleData.site, { version: 1 }) as never,
  catalog: {
    centers: sampleData.centers as never,
    categories: sampleData.categories as never,
    teachers: sampleData.teachers as never,
    subjects: sampleData.subjects as never,
    courses: sampleData.courses as never,
  },
}

const workspace = { teacher: null, courses: [], videos: [], playlists: [], resources: [], subjects: [] }
const publishable = { status: 'published' as const, visibility: 'public' as const, audience: { studentIds: [], groupIds: [] }, featured: false, updatedAt: '2026-11-06T10:00:00.000Z' }
const apiVideo = (id: string) => ({ id, teacherId: 't-dilnoza', title: { uz: id, ru: id, en: id }, description: { uz: '', ru: '', en: '' }, source: { kind: 'link', url: 'https://youtu.be/x' }, durationSec: 60, coverSeed: 1, ...publishable })

/** A brand-new self-registered teacher, exactly as the API returns the profile: empty texts, no center, no photo. */
const fresh = { id: 'tp-new', slug: 'yangi-ustoz', name: 'Yangi Ustoz', title: {}, bio: {}, tagline: {}, expertise: [], centerId: null, avatarSeed: 1, bannerTone: '#163C35', channelActive: true } as unknown as Teacher

beforeEach(() => {
  fake.calls = []
  fake.respond = () => ({})
})

describe('Public content lists', () => {
  it('load for a visitor from /public/content, one request per account, and map videos to the web shape', async () => {
    fake.respond = (path) => (path === '/public/content' ? { videos: [apiVideo('v1')], playlists: [{ id: 'p1', teacherId: 't-dilnoza', title: {}, description: {}, videoIds: ['v1'], coverSeed: 1, ...publishable }], resources: [] } : {})
    const store = createIlmoraStore(initialMock)
    expect(store.getState().contentStatus).toBe('idle')
    await Promise.all([store.getState().loadPublicContent(), store.getState().loadPublicContent()])
    const s = store.getState()
    expect(s.contentStatus).toBe('ready')
    expect(s.videos).toHaveLength(1)
    expect(s.videos[0]).toMatchObject({ id: 'v1', source: { kind: 'link', url: 'https://youtu.be/x' } })
    expect(s.playlists.map((p) => p.id)).toEqual(['p1'])
    expect(fake.calls.filter((c) => c.path === '/public/content')).toHaveLength(1)
  })

  it('end in the ready state even when the request fails, so pages show "not found" instead of waiting forever', async () => {
    fake.respond = (path) => { if (path === '/public/content') throw new Error('offline'); return {} }
    const store = createIlmoraStore(initialMock)
    await store.getState().loadPublicContent()
    expect(store.getState().contentStatus).toBe('ready')
    expect(store.getState().videos).toEqual([])
  })
})

describe('Studio payloads', () => {
  it('let a self-registered teacher save the channel: no centerId, every language present, no browser-only preview', async () => {
    const store = createIlmoraStore(initialMock)
    await store.getState().loginAsDemo('TEACHER', { teacherProfileId: 'tp-new' })
    store.setState({ teachers: [...store.getState().teachers, fresh] })
    fake.respond = (path, body) => (path === '/manage/profile' ? { ...fresh, ...(body as object), title: (body as { title: unknown }).title } : {})

    await store.getState().upsertTeacher({ ...fresh, tagline: { uz: 'Ilm nuri' } as never, avatarUrl: 'blob:http://localhost:3000/photo', bannerUrl: undefined })

    const call = fake.calls.find((c) => c.path === '/manage/profile')
    expect(call?.method).toBe('PATCH')
    expect(call?.body).not.toHaveProperty('centerId')
    expect(call?.body).not.toHaveProperty('phone')
    expect(call?.body).toMatchObject({
      name: 'Yangi Ustoz',
      title: { uz: '', ru: '', en: '' },
      bio: { uz: '', ru: '', en: '' },
      tagline: { uz: 'Ilm nuri', ru: '', en: '' },
      avatarUrl: null,
      bannerUrl: null,
      featured: null,
      channelActive: true,
    })
    expect(store.getState().teachers.find((t) => t.id === 'tp-new')?.title).toEqual({ uz: '', ru: '', en: '' })
  })

  it('send the center only from the Super Admin, and only a real one', async () => {
    const store = createIlmoraStore(initialMock)
    await store.getState().loginAsDemo('TEACHER', { id: 'u-owner', roles: ['PLATFORM_ADMIN'], teacherProfileId: null })
    expect(store.getState().role).toBe('admin')
    store.setState({ teachers: [...store.getState().teachers, fresh] })
    fake.respond = (_path, body) => ({ ...fresh, ...(body as object) })

    await store.getState().upsertTeacher(fresh)
    expect(fake.calls.at(-1)).toMatchObject({ path: '/admin/teachers/tp-new', method: 'PATCH' })
    expect(fake.calls.at(-1)?.body).not.toHaveProperty('centerId')

    await store.getState().upsertTeacher({ ...fresh, centerId: 'c-1' })
    expect(fake.calls.at(-1)?.body).toMatchObject({ centerId: 'c-1' })
  })

  it('never persist blob: addresses for thumbnails, uploaded video files, resource files or course images', async () => {
    const store = createIlmoraStore(initialMock)
    await store.getState().loginAsDemo('TEACHER')
    fake.respond = (path, body) => (path === '/manage/mine' ? workspace : { id: 'x', ...(body as object), source: { kind: 'link', url: 'https://youtu.be/x' } })

    const video: Video = { ...apiVideo('v-new'), source: { kind: 'upload', file: { name: 'lesson.mp4', size: 10, mime: 'video/mp4', previewUrl: 'blob:http://localhost:3000/lesson' } }, thumbnailUrl: 'blob:http://localhost:3000/thumb' } as Video
    await store.getState().upsertVideo(video)
    const videoCall = fake.calls.find((c) => c.path === '/manage/videos')
    expect(videoCall?.body).toMatchObject({ thumbnailUrl: null, source: { kind: 'upload', key: 'lesson.mp4' } })
    expect((videoCall!.body as { source: { url?: string } }).source.url).toBeUndefined()

    const resource: Resource = { id: 'r-new', teacherId: 't-dilnoza', title: { uz: 'A', ru: 'A', en: 'A' }, description: { uz: '', ru: '', en: '' }, kind: 'pdf', file: { name: 'a.pdf', size: 5, mime: 'application/pdf' }, url: 'blob:http://localhost:3000/a', ...publishable }
    await store.getState().upsertResource(resource)
    expect(fake.calls.find((c) => c.path === '/manage/resources')?.body).toMatchObject({ url: null, file: { name: 'a.pdf', size: 5, mime: 'application/pdf' } })

    // A real storage address travels untouched.
    await store.getState().upsertResource({ ...resource, url: 'https://cdn.ilmora.uz/resources/t/a.pdf' })
    expect(fake.calls.at(-1)?.body).toMatchObject({ url: 'https://cdn.ilmora.uz/resources/t/a.pdf' })

    const first = store.getState().courses[0]
    await store.getState().upsertCourse({ ...first, id: 'c-new', groups: [], imageUrl: 'blob:http://localhost:3000/cover' })
    expect(fake.calls.find((c) => c.path === '/manage/courses')?.body).toMatchObject({ imageUrl: null })
  })
})

describe('Storage status', () => {
  it('is asked once and remembered; a failed question keeps the controls usable', async () => {
    fake.respond = (path) => (path === '/manage/uploads/status' ? { configured: false } : {})
    const store = createIlmoraStore(initialMock)
    expect(store.getState().storageConfigured).toBeNull()
    expect(await Promise.all([store.getState().ensureStorageStatus(), store.getState().ensureStorageStatus()])).toEqual([false, false])
    expect(store.getState().storageConfigured).toBe(false)
    expect(fake.calls.filter((c) => c.path === '/manage/uploads/status')).toHaveLength(1)
    store.getState().setStorageConfigured(true)
    expect(await store.getState().ensureStorageStatus()).toBe(true)

    fake.respond = () => { throw new Error('offline') }
    const other = createIlmoraStore(initialMock)
    expect(await other.getState().ensureStorageStatus()).toBe(true)
  })
})
