import { readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ZodType } from 'zod'
import { ZodValidationPipe } from '../src/common/zod.pipe'
import * as companiesSchemas from '../src/modules/companies/companies.schemas'
import * as contractHelpSchemas from '../src/modules/contract-help/contract-help.schemas'
import * as graduatesSchemas from '../src/modules/graduates/graduates.schemas'
import * as institutionsSchemas from '../src/modules/institutions/institutions.schemas'
import * as manageSchemas from '../src/modules/manage/manage.schemas'
import * as ministrySchemas from '../src/modules/ministry/ministry.schemas'
import * as registryAdminSchemas from '../src/modules/registry/registry-admin.schemas'
import * as registrySchemas from '../src/modules/registry/registry.schemas'
import { SiteConfigSchema } from '../src/modules/site/site.service'
import * as certificatesSchemas from '../src/modules/students/certificates.schemas'
import * as studentsSchemas from '../src/modules/students/students.schemas'
import * as trainingSchemas from '../src/modules/training/training.schemas'
import * as vacanciesSchemas from '../src/modules/vacancies/vacancies.schemas'

const {
  CenterTeacherInput, CenterTeacherPatch, CourseInput, CoursePatch, ResourceInput, ResourcePatch, TeacherInput, TeacherPatch, VideoInput, VideoPatch,
} = manageSchemas

/**
 * Security check 19.11, finding №3: a teacher or a center saves links that the site later renders
 * (material and video links, course cover, video thumbnail, avatar, banner). Rules:
 * - `link`: a plain https link to a named host (`isSafeExternalUrl`);
 * - `image`: a storage key, a root-relative path (`/<key>`, `/images/...`: uploads without a public
 *   storage base and existing data use them) or a plain https link to a named host.
 * Only the schema is checked: a later check in a service (e.g. ManageService.onlineColumns) does not count.
 */

const BAD = {
  'javascript:': 'javascript:alert(1)',
  'JavaScript: (case)': 'JavaScript:alert(1)',
  'leading space': ' javascript:alert(1)',
  'java<TAB>script:': 'java\tscript:alert(1)',
  'java<LF>script:': 'java\nscript:alert(1)',
  'control char': '\u0001javascript:alert(1)',
  'vbscript:': 'vbscript:msgbox(1)',
  'data:': 'data:text/html,<script>alert(1)</script>',
  '//host': '//evil.example/x',
  '\\\\host': '\\\\evil.example/x',
  '/\\host': '/\\evil.example/x',
  '/<TAB>/host': '/\t/evil.example/x',
  '/<LF>/host': '/\n/evil.example/x',
  'http:': 'http://evil.example/x',
  'userinfo': 'https://ilmora.uz@evil.example/x',
  'https:host': 'https:evil.example',
  'https:/\\host': 'https:/\\evil.example',
  'IP host': 'https://1.2.3.4/x',
  'localhost': 'https://localhost/x',
  'metadata IP': 'https://169.254.169.254/latest/meta-data/',
  'key traversal': 'avatars/../../x',
} as const
type Bad = keyof typeof BAD
const ALL = Object.keys(BAD) as Bad[]

const PUBLIC_BASE = 'https://media.ilmora.uz'
const L = { uz: 'x', ru: 'x', en: 'x' }

interface Field {
  /** `Schema.path` as the shape scan below prints it. */
  name: string
  kind: 'link' | 'image'
  schema: ZodType
  body: (value: string) => Record<string, unknown>
  /** Values the field must accept; checked first, so a broken body never passes for a refused link. */
  good: string[]
}

const link = (...extra: string[]) => ['https://www.freecodecamp.org/learn/', 'HTTPS://CS50.HARVARD.EDU/python/', ...extra]
/** A real key of the upload prefix, its public https address and its root-relative form. */
const image = (prefix: string, ...extra: string[]) => {
  const key = `${prefix}/tenant-1/profile-1-1700000000000-ab12cd34.webp`
  return [key, `${PUBLIC_BASE}/${key}`, `/${key}`, 'HTTPS://CDN.EXAMPLE.UZ/a.jpg', ...extra]
}

const courseBase = { title: L, categoryId: 'cat-1', summary: L, description: L, curriculum: [], level: 'beginner', durationMonths: 3, price: 0 }
const videoKey = 'videos/tenant-1/v.mp4'
const videoBase = { title: L, description: L, source: { kind: 'upload', key: videoKey } }
const resourceBase = { title: L, description: L, kind: 'link' }
const teacherBase = { name: 'T', title: L, bio: L, expertise: [], centerId: 'c-1', tagline: L }
// A material link may also be the public address of an uploaded resource file.
const resourceGood = link(`${PUBLIC_BASE}/resources/tenant-1/profile-1-1700000000000-ab12cd34.pdf`)
const avatarGood = image('avatars', '/images/teachers/dilnoza-karimova.jpg')

const FIELDS: Field[] = [
  { name: 'CourseInput.externalUrl', kind: 'link', schema: CourseInput, good: link(), body: (v) => ({ ...courseBase, learningFormat: 'ONLINE', externalUrl: v }) },
  { name: 'CoursePatch.externalUrl', kind: 'link', schema: CoursePatch, good: link(), body: (v) => ({ externalUrl: v }) },
  { name: 'CourseInput.imageUrl', kind: 'image', schema: CourseInput, good: image('courses'), body: (v) => ({ ...courseBase, imageUrl: v }) },
  { name: 'CoursePatch.imageUrl', kind: 'image', schema: CoursePatch, good: image('courses'), body: (v) => ({ imageUrl: v }) },
  { name: 'VideoInput.source[kind=link].url', kind: 'link', schema: VideoInput, good: link(), body: (v) => ({ ...videoBase, source: { kind: 'link', url: v } }) },
  { name: 'VideoPatch.source[kind=link].url', kind: 'link', schema: VideoPatch, good: link(), body: (v) => ({ source: { kind: 'link', url: v } }) },
  // The public address of an uploaded video: a storage address, so the image rule.
  { name: 'VideoInput.source[kind=upload].url', kind: 'image', schema: VideoInput, good: image('videos'), body: (v) => ({ ...videoBase, source: { kind: 'upload', key: videoKey, url: v } }) },
  { name: 'VideoPatch.source[kind=upload].url', kind: 'image', schema: VideoPatch, good: image('videos'), body: (v) => ({ source: { kind: 'upload', key: videoKey, url: v } }) },
  { name: 'VideoInput.thumbnailUrl', kind: 'image', schema: VideoInput, good: image('thumbnails'), body: (v) => ({ ...videoBase, thumbnailUrl: v }) },
  { name: 'VideoPatch.thumbnailUrl', kind: 'image', schema: VideoPatch, good: image('thumbnails'), body: (v) => ({ thumbnailUrl: v }) },
  { name: 'ResourceInput.url', kind: 'link', schema: ResourceInput, good: resourceGood, body: (v) => ({ ...resourceBase, url: v }) },
  { name: 'ResourcePatch.url', kind: 'link', schema: ResourcePatch, good: resourceGood, body: (v) => ({ url: v }) },
  { name: 'CenterTeacherInput.avatarUrl', kind: 'image', schema: CenterTeacherInput, good: avatarGood, body: (v) => ({ name: 'T', avatarUrl: v }) },
  { name: 'CenterTeacherPatch.avatarUrl', kind: 'image', schema: CenterTeacherPatch, good: avatarGood, body: (v) => ({ avatarUrl: v }) },
  { name: 'TeacherInput.avatarUrl', kind: 'image', schema: TeacherInput, good: avatarGood, body: (v) => ({ ...teacherBase, avatarUrl: v }) },
  { name: 'TeacherPatch.avatarUrl', kind: 'image', schema: TeacherPatch, good: avatarGood, body: (v) => ({ avatarUrl: v }) },
  { name: 'TeacherInput.bannerUrl', kind: 'image', schema: TeacherInput, good: image('banners'), body: (v) => ({ ...teacherBase, bannerUrl: v }) },
  { name: 'TeacherPatch.bannerUrl', kind: 'image', schema: TeacherPatch, good: image('banners'), body: (v) => ({ bannerUrl: v }) },
]

/**
 * Finding №3 is open: the bad values each field still accepts today. When a schema is fixed, its entry
 * fails the test below; delete it (the field is then held to the rule strictly).
 */
const ANY_STRING = ALL
/** `z.string().url()`: needs a scheme and a host, but any scheme and any host. */
const ZOD_URL: Bad[] = ['javascript:', 'JavaScript: (case)', 'leading space', 'java<TAB>script:', 'java<LF>script:', 'control char', 'vbscript:', 'data:', 'http:', 'userinfo', 'https:host', 'https:/\\host', 'IP host', 'localhost', 'metadata IP']
/** `SafeMediaUrl`: anything starting with `/`, `http(s)://`, `avatars/` or `banners/`. */
const SAFE_MEDIA_URL: Bad[] = ['//host', '/\\host', '/<TAB>/host', '/<LF>/host', 'http:', 'userinfo', 'IP host', 'localhost', 'metadata IP', 'key traversal']
const KNOWN_GAPS_N3: Record<string, readonly Bad[]> = {
  'CourseInput.imageUrl': ANY_STRING,
  'CoursePatch.imageUrl': ANY_STRING,
  'VideoInput.source[kind=link].url': ZOD_URL,
  'VideoPatch.source[kind=link].url': ZOD_URL,
  'VideoInput.source[kind=upload].url': ANY_STRING,
  'VideoPatch.source[kind=upload].url': ANY_STRING,
  'VideoInput.thumbnailUrl': ANY_STRING,
  'VideoPatch.thumbnailUrl': ANY_STRING,
  'ResourceInput.url': ANY_STRING,
  'ResourcePatch.url': ANY_STRING,
  'CenterTeacherInput.avatarUrl': ANY_STRING,
  'CenterTeacherPatch.avatarUrl': ANY_STRING,
  'TeacherInput.avatarUrl': SAFE_MEDIA_URL,
  'TeacherPatch.avatarUrl': SAFE_MEDIA_URL,
  'TeacherInput.bannerUrl': SAFE_MEDIA_URL,
  'TeacherPatch.bannerUrl': SAFE_MEDIA_URL,
}

const accepts = (f: Field, value: string) => {
  try {
    new ZodValidationPipe(f.schema).transform(f.body(value))
    return true
  } catch {
    return false
  }
}

describe('Finding №3: course, material, video and avatar schemas refuse unsafe links', () => {
  for (const f of FIELDS) {
    it(`${f.name} (${f.kind}) takes normal values and refuses javascript:, data:, // and the rest`, () => {
      for (const v of f.good) expect(accepts(f, v), `${f.name} refuses the normal value ${JSON.stringify(v)}`).toBe(true)
      const gaps = KNOWN_GAPS_N3[f.name] ?? []
      for (const bad of ALL) {
        const ok = accepts(f, BAD[bad])
        if (gaps.includes(bad)) expect(ok, `${f.name} now refuses ${bad}: №3 closed here, drop it from KNOWN_GAPS_N3`).toBe(true)
        else expect(ok, `${f.name} accepts ${bad}`).toBe(false)
      }
    })
  }

  it('the known-gap list names only checked fields and bad values', () => {
    for (const [name, bads] of Object.entries(KNOWN_GAPS_N3)) {
      expect(FIELDS.map((f) => f.name), name).toContain(name)
      for (const b of bads) expect(ALL, `${name}: ${b}`).toContain(b)
    }
  })
})

// ---- Shape scan: every URL-ish field of the API's input schemas is checked above or set aside with a reason.

const URLISH = /url|href|link|avatar|cover|image|img|video|thumbnail|banner|logo|photo|picture|poster|icon|website|src|media|file/i
/** Keys that match the pattern but hold no address. */
const NOT_URLS = new Set(['coverSeed', 'avatarSeed', 'videoIds', 'bannerTone', 'fileName', 'fileSize', 'logoOnDark'])

/** Whole exports that are not scanned, with the reason. */
const SKIPPED_SCHEMAS: Record<string, string> = {
  'manage.SafeMediaUrl': 'a field type, scanned through TeacherInput.avatarUrl and bannerUrl',
}

/** URL-ish fields outside finding №3, with the reason. */
const SUPER_ADMIN = 'site content, edited by the Super Admin only'
const OUT_OF_SCOPE: Record<string, string> = {
  'CompanyPatch.website': 'organization profile, not №3; allows http:// (regex)',
  'InstitutionPatch.website': 'organization profile, not №3; allows http:// (regex)',
  'SiteConfigSchema.pages.home[].imageUrl': `${SUPER_ADMIN}; any string`,
  'SiteConfigSchema.pages.howItWorks[].imageUrl': `${SUPER_ADMIN}; any string`,
  'SiteConfigSchema.pages.centers[].imageUrl': `${SUPER_ADMIN}; any string`,
  'SiteConfigSchema.presets[].admission.url': `${SUPER_ADMIN}; isSafeExternalUrl`,
  'SiteConfigSchema.universities[].website': `${SUPER_ADMIN}; isSafeExternalUrl`,
  'SiteConfigSchema.universities[].logoUrl': `${SUPER_ADMIN}; https or a /universities/ file`,
  'SiteConfigSchema.media.heroVideoUrl': `${SUPER_ADMIN}; any string`,
  'SiteConfigSchema.media.heroPosterUrl': `${SUPER_ADMIN}; any string`,
  'SiteConfigSchema.media.furnitureVideoUrl': `${SUPER_ADMIN}; any string`,
  'SiteConfigSchema.media.furniturePosterUrl': `${SUPER_ADMIN}; any string`,
}

const MODULES: Record<string, Record<string, unknown>> = {
  companies: companiesSchemas, 'contract-help': contractHelpSchemas, graduates: graduatesSchemas, institutions: institutionsSchemas, manage: manageSchemas,
  ministry: ministrySchemas, 'registry-admin': registryAdminSchemas, registry: registrySchemas, certificates: certificatesSchemas, students: studentsSchemas,
  training: trainingSchemas, vacancies: vacanciesSchemas, site: { SiteConfigSchema },
}
/** The schema files on disk, so a new `*.schemas.ts` must be imported above. */
const SCHEMA_FILES = ['companies', 'contract-help', 'graduates', 'institutions', 'manage', 'ministry', 'registry-admin', 'registry', 'certificates', 'students', 'training', 'vacancies']

type Def = Record<string, unknown> & { type: string }
const defOf = (s: unknown): Def | undefined => (s as { _zod?: { def?: Def } } | null)?._zod?.def
const LEAVES = new Set(['string', 'number', 'int', 'boolean', 'bigint', 'date', 'enum', 'literal', 'null', 'undefined', 'any', 'unknown', 'never', 'void', 'nan', 'symbol', 'file', 'template_literal', 'custom', 'transform', 'success'])

/** Dotted paths of URL-ish keys; union arms with a literal discriminator are named `[kind=value]`. */
function urlishPaths(schema: unknown, prefix: string, seen = new Set<unknown>()): string[] {
  const def = defOf(schema)
  if (!def) throw new Error(`${prefix}: not a zod schema`)
  if (seen.has(schema)) return []
  const walk = (s: unknown, p: string) => urlishPaths(s, p, new Set([...seen, schema]))
  switch (def.type) {
    case 'object':
      return Object.entries(def.shape as Record<string, unknown>).flatMap(([k, s]) => [
        // A nested object (`ResourceInput.file`, `media`) is not an address itself; its keys are scanned.
        ...(URLISH.test(k) && !NOT_URLS.has(k) && !isObject(s) ? [`${prefix}.${k}`] : []),
        ...walk(s, `${prefix}.${k}`),
      ])
    case 'union':
      return [...new Set((def.options as unknown[]).flatMap((o) => walk(o, `${prefix}${armTag(o)}`)))]
    case 'intersection': return [...new Set([...walk(def.left, prefix), ...walk(def.right, prefix)])]
    case 'pipe': return [...new Set([...walk(def.in, prefix), ...walk(def.out, prefix)])]
    case 'lazy': return walk((def.getter as () => unknown)(), prefix)
    case 'array': case 'set': return walk(def.element ?? def.valueType, `${prefix}[]`)
    case 'record': case 'map': return walk(def.valueType, `${prefix}[*]`)
    case 'tuple': return [...(def.items as unknown[]).flatMap((s, i) => walk(s, `${prefix}[${i}]`)), ...(def.rest ? walk(def.rest, `${prefix}[]`) : [])]
    case 'optional': case 'nullable': case 'default': case 'prefault': case 'catch': case 'readonly': case 'nonoptional': case 'promise':
      return walk(def.innerType, prefix)
    default:
      if (LEAVES.has(def.type)) return []
      throw new Error(`${prefix}: unknown zod type "${def.type}", teach urlishPaths about it`)
  }
}
function isObject(s: unknown): boolean {
  const def = defOf(s)
  if (!def) return false
  if (def.type === 'object') return true
  return 'innerType' in def && isObject(def.innerType)
}
function armTag(option: unknown): string {
  const def = defOf(option)
  if (def?.type !== 'object') return ''
  for (const [k, s] of Object.entries(def.shape as Record<string, unknown>)) {
    const d = defOf(s)
    if (d?.type === 'literal') return `[${k}=${String((d.values as unknown[])[0])}]`
  }
  return ''
}

describe('Finding №3: shape scan of the input schemas', () => {
  const exports = Object.entries(MODULES).flatMap(([m, mod]) => Object.entries(mod).filter(([, v]) => defOf(v)).map(([n, v]) => [`${m}.${n}`, v] as const))

  it('every schema file is imported here', () => {
    const root = join(__dirname, '../src/modules')
    const onDisk = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((f) => f.endsWith('.schemas.ts')).map((f) => basename(f, '.schemas.ts'))
    expect(onDisk.sort()).toEqual([...SCHEMA_FILES].sort())
    expect(Object.keys(MODULES).filter((m) => m !== 'site').sort()).toEqual([...SCHEMA_FILES].sort())
  })

  it('a URL-ish field is checked above or set aside with a reason', () => {
    const found = exports.filter(([n]) => !(n in SKIPPED_SCHEMAS)).flatMap(([n, s]) => urlishPaths(s, n.replace(/^[^.]+\./, '')))
    const checked = FIELDS.map((f) => f.name)
    const unclassified = found.filter((p) => !checked.includes(p) && !(p in OUT_OF_SCOPE))
    expect(unclassified, 'new URL-ish fields: add a check to FIELDS or a reason to OUT_OF_SCOPE').toEqual([])
    expect(checked.filter((p) => !found.includes(p)), 'checked fields the scan no longer finds').toEqual([])
    expect(Object.keys(OUT_OF_SCOPE).filter((p) => !found.includes(p)), 'stale OUT_OF_SCOPE entries').toEqual([])
    expect(Object.keys(SKIPPED_SCHEMAS).filter((n) => !exports.some(([e]) => e === n)), 'stale SKIPPED_SCHEMAS entries').toEqual([])
  })
})
