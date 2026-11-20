import { describe, expect, it } from 'vitest'
import type { ZodType } from 'zod'
import { ZodValidationPipe } from '../src/common/zod.pipe'
import {
  CenterTeacherInput, CenterTeacherPatch, CourseInput, CoursePatch, ResourceInput, ResourcePatch, TeacherInput, TeacherPatch, VideoInput, VideoPatch,
} from '../src/modules/manage/manage.schemas'

/**
 * Security check 19.11, finding №3: a teacher or a center saves links that the site later renders
 * (material and video links, course cover, video thumbnail, avatar, banner). Rules:
 * - `link`: a plain https link to a named host (`isSafeExternalUrl`);
 * - `image`: a storage key or a plain https link; never `javascript:`, `data:`, `//host` or `http:`.
 */

const ATTACKS = {
  'javascript:': 'javascript:alert(1)',
  'JavaScript: (case)': 'JavaScript:alert(1)',
  'leading space': ' javascript:alert(1)',
  'data:': 'data:text/html,<script>alert(1)</script>',
  '//host': '//evil.example/x',
  '\\\\host': '\\\\evil.example/x',
  '/\\host': '/\\evil.example/x',
  'http:': 'http://evil.example/x',
} as const
type Attack = keyof typeof ATTACKS

const L = { uz: 'x', ru: 'x', en: 'x' }
const HTTPS = 'https://cdn.example.com/media/a.png'
const STORAGE_KEY = 'avatars/tenant-1/profile-1-1700000000000.webp'

interface Field {
  /** `Schema.path` as the shape scan below prints it. */
  name: string
  kind: 'link' | 'image'
  schema: ZodType
  body: (value: string) => Record<string, unknown>
}

const courseBase = {
  title: L, categoryId: 'cat-1', summary: L, description: L, curriculum: [], level: 'beginner', durationMonths: 3, price: 0,
}
const videoBase = { title: L, description: L, source: { kind: 'upload', key: 'videos/t/v.mp4' } }
const resourceBase = { title: L, description: L, kind: 'link' }
const teacherBase = { name: 'T', title: L, bio: L, expertise: [], centerId: 'c-1', tagline: L }

const FIELDS: Field[] = [
  { name: 'CourseInput.externalUrl', kind: 'link', schema: CourseInput, body: (v) => ({ ...courseBase, learningFormat: 'ONLINE', externalUrl: v }) },
  { name: 'CoursePatch.externalUrl', kind: 'link', schema: CoursePatch, body: (v) => ({ externalUrl: v }) },
  { name: 'CourseInput.imageUrl', kind: 'image', schema: CourseInput, body: (v) => ({ ...courseBase, imageUrl: v }) },
  { name: 'CoursePatch.imageUrl', kind: 'image', schema: CoursePatch, body: (v) => ({ imageUrl: v }) },
  { name: 'VideoInput.source.url', kind: 'link', schema: VideoInput, body: (v) => ({ ...videoBase, source: { kind: 'link', url: v } }) },
  { name: 'VideoPatch.source.url', kind: 'link', schema: VideoPatch, body: (v) => ({ source: { kind: 'link', url: v } }) },
  // An uploaded video's public address: the storage key's URL, so the image rule.
  { name: 'VideoInput.source(upload).url', kind: 'image', schema: VideoInput, body: (v) => ({ ...videoBase, source: { kind: 'upload', key: 'videos/t/v.mp4', url: v } }) },
  { name: 'VideoPatch.source(upload).url', kind: 'image', schema: VideoPatch, body: (v) => ({ source: { kind: 'upload', key: 'videos/t/v.mp4', url: v } }) },
  { name: 'VideoInput.thumbnailUrl', kind: 'image', schema: VideoInput, body: (v) => ({ ...videoBase, thumbnailUrl: v }) },
  { name: 'VideoPatch.thumbnailUrl', kind: 'image', schema: VideoPatch, body: (v) => ({ thumbnailUrl: v }) },
  { name: 'ResourceInput.url', kind: 'link', schema: ResourceInput, body: (v) => ({ ...resourceBase, url: v }) },
  { name: 'ResourcePatch.url', kind: 'link', schema: ResourcePatch, body: (v) => ({ url: v }) },
  { name: 'CenterTeacherInput.avatarUrl', kind: 'image', schema: CenterTeacherInput, body: (v) => ({ name: 'T', avatarUrl: v }) },
  { name: 'CenterTeacherPatch.avatarUrl', kind: 'image', schema: CenterTeacherPatch, body: (v) => ({ avatarUrl: v }) },
  { name: 'TeacherInput.avatarUrl', kind: 'image', schema: TeacherInput, body: (v) => ({ ...teacherBase, avatarUrl: v }) },
  { name: 'TeacherPatch.avatarUrl', kind: 'image', schema: TeacherPatch, body: (v) => ({ avatarUrl: v }) },
  { name: 'TeacherInput.bannerUrl', kind: 'image', schema: TeacherInput, body: (v) => ({ ...teacherBase, bannerUrl: v }) },
  { name: 'TeacherPatch.bannerUrl', kind: 'image', schema: TeacherPatch, body: (v) => ({ bannerUrl: v }) },
]

/**
 * Finding №3 is open: the values each field still accepts today. When a schema is fixed, its entry
 * fails the test below; delete it (the field is then held to the rule strictly).
 */
const ALL = Object.keys(ATTACKS) as Attack[]
/** `z.string().url()` refuses scheme-relative values but takes any scheme. */
const ANY_SCHEME: Attack[] = ['javascript:', 'JavaScript: (case)', 'leading space', 'data:', 'http:']
/** `SafeMediaUrl` takes anything starting with `/` (so `//host`, `/\host`) and http. */
const SAFE_MEDIA_URL: Attack[] = ['//host', '/\\host', 'http:']
const KNOWN_GAPS_N3: Record<string, readonly Attack[]> = {
  'CourseInput.imageUrl': ALL,
  'CoursePatch.imageUrl': ALL,
  'VideoInput.source.url': ANY_SCHEME,
  'VideoPatch.source.url': ANY_SCHEME,
  'VideoInput.source(upload).url': ALL,
  'VideoPatch.source(upload).url': ALL,
  'VideoInput.thumbnailUrl': ALL,
  'VideoPatch.thumbnailUrl': ALL,
  'ResourceInput.url': ALL,
  'ResourcePatch.url': ALL,
  'CenterTeacherInput.avatarUrl': ALL,
  'CenterTeacherPatch.avatarUrl': ALL,
  'TeacherInput.avatarUrl': SAFE_MEDIA_URL,
  'TeacherPatch.avatarUrl': SAFE_MEDIA_URL,
  'TeacherInput.bannerUrl': SAFE_MEDIA_URL,
  'TeacherPatch.bannerUrl': SAFE_MEDIA_URL,
}

/** Keys that look like URLs but are not links (numbers, ids, a colour). */
const NOT_URLS = ['coverSeed', 'avatarSeed', 'videoIds', 'bannerTone']
const URLISH = /url|href|link|avatar|cover|image|video|thumbnail|banner|logo|photo/i
const SCHEMAS: Record<string, ZodType> = { CourseInput, CoursePatch, VideoInput, VideoPatch, ResourceInput, ResourcePatch, CenterTeacherInput, CenterTeacherPatch, TeacherInput, TeacherPatch }

const accepts = (f: Field, value: string) => {
  try {
    new ZodValidationPipe(f.schema).transform(f.body(value))
    return true
  } catch {
    return false
  }
}

/** Dotted paths of URL-ish keys in a schema, through optional/nullable/default wrappers and unions. */
function urlishPaths(schema: ZodType, prefix: string): string[] {
  const def = (schema as unknown as { _zod: { def: Record<string, unknown> & { type: string } } })._zod.def
  if (def.type === 'object') {
    return Object.entries(def.shape as Record<string, ZodType>).flatMap(([k, s]) => [
      ...(URLISH.test(k) && !NOT_URLS.includes(k) ? [`${prefix}.${k}`] : []),
      ...urlishPaths(s, `${prefix}.${k}`),
    ])
  }
  if (def.type === 'union') return [...new Set((def.options as ZodType[]).flatMap((o) => urlishPaths(o, prefix)))]
  if (def.innerType) return urlishPaths(def.innerType as ZodType, prefix)
  if (def.type === 'array') return urlishPaths(def.element as ZodType, `${prefix}[]`)
  return []
}

describe('Finding №3: course, material, video and avatar schemas refuse unsafe links', () => {
  it('every field accepts a normal value (the bodies are valid, so a refusal means the URL check)', () => {
    for (const f of FIELDS) {
      expect(accepts(f, HTTPS), `${f.name}: https link`).toBe(true)
      if (f.kind === 'image') expect(accepts(f, STORAGE_KEY), `${f.name}: storage key`).toBe(true)
    }
  })

  for (const f of FIELDS) {
    it(`${f.name} (${f.kind}) refuses javascript:, data:, // and http:`, () => {
      const gaps = KNOWN_GAPS_N3[f.name] ?? []
      for (const attack of ALL) {
        const ok = accepts(f, ATTACKS[attack])
        if (gaps.includes(attack)) expect(ok, `${f.name} now refuses ${attack}: №3 closed here, drop it from KNOWN_GAPS_N3`).toBe(true)
        else expect(ok, `${f.name} accepts ${attack}`).toBe(false)
      }
    })
  }

  it('the known-gap list names only checked fields and attacks', () => {
    for (const [name, attacks] of Object.entries(KNOWN_GAPS_N3)) {
      expect(FIELDS.map((f) => f.name), name).toContain(name)
      for (const a of attacks) expect(Object.keys(ATTACKS), `${name}: ${a}`).toContain(a)
    }
  })

  it('a new URL-ish field in these schemas gets a check here', () => {
    const found = Object.entries(SCHEMAS).flatMap(([n, s]) => urlishPaths(s, n)).sort()
    // Both arms of the video source union are named `url`; one scan path covers both checks.
    const checked = [...new Set(FIELDS.map((f) => f.name.replace('source(upload)', 'source')))].sort()
    expect(found).toEqual(checked)
  })
})
