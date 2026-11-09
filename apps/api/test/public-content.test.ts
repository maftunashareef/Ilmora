import { describe, expect, it, vi } from 'vitest'
import type { PrismaService } from '../src/infra/prisma/prisma.service'
import type { RequestActor } from '../src/infra/tenancy/tenant-context'
import { CatalogService } from '../src/modules/catalog/catalog.service'

const L = (s: string) => ({ uz: s, ru: s, en: s })
const when = new Date('2026-11-06T10:00:00Z')

type Row = Record<string, unknown> & { id: string; teacherId: string; status: string; visibility: string; audienceStudentIds: string[]; audienceGroupIds: string[]; listed: boolean }
const video = (id: string, over: Partial<Row> = {}): Row => ({
  id, tenantId: 't', teacherId: 'tp-1', courseId: null, title: L(id), description: L(''), sourceKind: 'LINK', sourceUrl: 'https://youtu.be/x', storageKey: null, durationSec: 60, thumbnailUrl: null, coverSeed: 1,
  status: 'PUBLISHED', visibility: 'PUBLIC', audienceStudentIds: [], audienceGroupIds: [], featured: false, reviewRequested: false, updatedAt: when, listed: true, ...over,
})
const playlist = (id: string, over: Partial<Row> = {}): Row => ({ ...video(id, over), items: [{ videoId: 'v-public' }] })
const resource = (id: string, over: Partial<Row> = {}): Row => ({ ...video(id, over), kind: 'PDF', fileName: 'a.pdf', fileSize: 10, fileMime: 'application/pdf', url: 'https://cdn.ilmora.uz/resources/t/a.pdf', pages: 3 })

/**
 * Stand-in for the three content tables: applies the `where` the service builds (status, public + listed teacher,
 * or shared by student id / group id) the way Postgres would, so the test checks the query and the access rule together.
 */
function matches(row: Row, where: { status: string; OR: Record<string, unknown>[] }): boolean {
  if (row.status !== where.status) return false
  return where.OR.some((clause) => {
    if ('visibility' in clause) return row.visibility === clause.visibility && row.listed
    if ('audienceStudentIds' in clause) return row.audienceStudentIds.includes((clause.audienceStudentIds as { has: string }).has)
    if ('audienceGroupIds' in clause) return (clause.audienceGroupIds as { hasSome: string[] }).hasSome.some((g) => row.audienceGroupIds.includes(g))
    return false
  })
}

function setup(rows: { videos: Row[]; playlists: Row[]; resources: Row[] }, enrolledGroupIds: string[] = []) {
  const table = (list: Row[]) => ({ findMany: vi.fn(async ({ where }: { where: { status: string; OR: Record<string, unknown>[] } }) => list.filter((r) => matches(r, where))) })
  const prisma = {
    client: {
      video: table(rows.videos),
      playlist: table(rows.playlists),
      resource: table(rows.resources),
      enrollment: { findMany: vi.fn(async () => enrolledGroupIds.map((groupId) => ({ groupId }))) },
    },
  }
  return { service: new CatalogService(prisma as unknown as PrismaService), prisma }
}

const rows = {
  videos: [
    video('v-public'),
    video('v-draft', { status: 'DRAFT' }),
    video('v-archived', { status: 'ARCHIVED' }),
    video('v-private', { visibility: 'PRIVATE' }),
    video('v-for-aziz', { visibility: 'PRIVATE', audienceStudentIds: ['u-aziz'] }),
    video('v-for-group', { visibility: 'PRIVATE', audienceGroupIds: ['g-1'] }),
    video('v-unlisted-teacher', { teacherId: 'tp-self-registered', listed: false }),
    video('v-unlisted-shared', { teacherId: 'tp-self-registered', listed: false, visibility: 'PRIVATE', audienceStudentIds: ['u-aziz'] }),
  ],
  playlists: [playlist('p-public'), playlist('p-private', { visibility: 'PRIVATE' }), playlist('p-draft', { status: 'DRAFT' })],
  resources: [resource('r-public'), resource('r-for-group', { visibility: 'PRIVATE', audienceGroupIds: ['g-1'] }), resource('r-draft', { status: 'DRAFT' })],
}

describe('GET /public/content: the lists a viewer may see', () => {
  it('gives a visitor only published public items of listed teachers, in the web shapes', async () => {
    const { service, prisma } = setup(rows)
    const out = await service.publicContent('t')
    expect(out.videos.map((v) => v.id)).toEqual(['v-public'])
    expect(out.playlists.map((p) => p.id)).toEqual(['p-public'])
    expect(out.resources.map((r) => r.id)).toEqual(['r-public'])
    // Same DTOs as the single-item endpoints.
    expect(out.videos[0]).toMatchObject({ status: 'published', visibility: 'public', source: { kind: 'link', url: 'https://youtu.be/x' }, audience: { studentIds: [], groupIds: [] }, updatedAt: when.toISOString() })
    expect(out.playlists[0]).toMatchObject({ videoIds: ['v-public'] })
    expect(out.resources[0]).toMatchObject({ kind: 'pdf', file: { name: 'a.pdf', size: 10, mime: 'application/pdf' }, url: 'https://cdn.ilmora.uz/resources/t/a.pdf', pages: 3 })
    // Anonymous callers never look up enrollments.
    expect(prisma.client.enrollment.findMany).not.toHaveBeenCalled()
  })

  it('adds the private items shared with a signed-in student by name or through an active group, and nothing else', async () => {
    const aziz: RequestActor = { id: 'u-aziz', roles: ['STUDENT'], centerId: null, teacherProfileId: null }
    const { service } = setup(rows, ['g-1'])
    const out = await service.publicContent('t', aziz)
    expect(out.videos.map((v) => v.id).sort()).toEqual(['v-for-aziz', 'v-for-group', 'v-public', 'v-unlisted-shared'])
    expect(out.resources.map((r) => r.id).sort()).toEqual(['r-for-group', 'r-public'])
    expect(out.playlists.map((p) => p.id)).toEqual(['p-public'])
  })

  it('keeps drafts and other students’ private items out even when the caller is signed in without groups', async () => {
    const other: RequestActor = { id: 'u-other', roles: ['STUDENT'], centerId: null, teacherProfileId: null }
    const { service, prisma } = setup(rows, [])
    const out = await service.publicContent('t', other)
    expect(out.videos.map((v) => v.id)).toEqual(['v-public'])
    // No `hasSome` clause is sent when the student has no active groups.
    const where = prisma.client.video.findMany.mock.calls[0][0].where
    expect(where.OR).toHaveLength(2)
    expect(where.OR[1]).toEqual({ audienceStudentIds: { has: 'u-other' } })
  })
})
