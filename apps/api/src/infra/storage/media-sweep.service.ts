import { DeleteObjectsCommand, ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { ENV, type Env, s3Configured } from '../../config/env'
import { PrismaService } from '../prisma/prisma.service'
import { s3ClientConfig } from './s3-client'

/**
 * Abandoned files in the public media bucket (`ilmora-media`; security review 19.11, №10; ТЗ 18.11, 12.3).
 *
 * The studio uploads straight to a final key (uploads.service, manage.service: presignImageUpload) and saves the public
 * address with the course, video, banner, avatar, resource or university logo. A file uploaded and never saved — the
 * form closed, the cover replaced — stays in the public bucket for ever. Unlike `ilmora-docs` there is no `incoming/`
 * area, so a storage lifecycle rule cannot tell such a file from one in use.
 *
 * Once a day the worker lists the upload areas below, takes files older than MEDIA_SWEEP_MIN_AGE_DAYS and looks for
 * their key anywhere in the database (every text, JSON and text-array column of every table — the audit log too, so a
 * file once referenced is kept: the sweep errs on keeping). A file found nowhere is abandoned.
 *
 * Report only by default: the log gets the numbers (files, bytes) — no keys. Deleting is switched on with
 * MEDIA_SWEEP_DELETE=true after the reports have been read for a while (infra/uzcloud/README.md). Even then it refuses
 * when the references look broken: none found at all, or more than half of the old files abandoned.
 */
export const MEDIA_PREFIXES = ['courses/', 'thumbnails/', 'banners/', 'resources/', 'avatars/', 'universities/'] as const

/** A media key as it appears inside a stored address: `<area>/<tenant>/<owner>-<time>[-<nonce>].<ext>`. */
const KEY_IN_TEXT = new RegExp(`(?:${MEDIA_PREFIXES.map((p) => p.slice(0, -1)).join('|')})/[A-Za-z0-9._/-]+`, 'g')

/** Media keys mentioned in a piece of stored text (an address, a JSON document). */
export function keysIn(text: string): string[] {
  // A key at the end of a sentence in prose keeps no trailing dot
  return (text.match(KEY_IN_TEXT) ?? []).map((k) => k.replace(/\.+$/, ''))
}

export type MediaObject = { key: string; size: number; lastModified: Date }
export type SweepPlan = { old: number; abandoned: MediaObject[]; abandonedBytes: number; refuse: string | null }

/** Which old files nobody refers to — and whether deleting them looks safe. */
export function planSweep(objects: MediaObject[], referenced: Set<string>, now: Date, minAgeDays: number): SweepPlan {
  const cutoff = now.getTime() - minAgeDays * 86_400_000
  const old = objects.filter((o) => o.lastModified.getTime() < cutoff)
  const abandoned = old.filter((o) => !referenced.has(o.key))
  const abandonedBytes = abandoned.reduce((sum, o) => sum + o.size, 0)
  let refuse: string | null = null
  if (old.length > 0 && referenced.size === 0) refuse = 'no references found in the database'
  else if (old.length >= 10 && abandoned.length * 2 > old.length) refuse = `${abandoned.length} of ${old.length} old files would go`
  return { old: old.length, abandoned, abandonedBytes, refuse }
}

/** The bucket operations the sweep needs; tests pass their own. */
export interface MediaStore {
  list(prefix: string): Promise<MediaObject[]>
  remove(keys: string[]): Promise<void>
}

class S3MediaStore implements MediaStore {
  private readonly s3: S3Client
  constructor(private readonly bucket: string, env: Env) {
    this.s3 = new S3Client(s3ClientConfig(env))
  }

  async list(prefix: string): Promise<MediaObject[]> {
    const out: MediaObject[] = []
    let token: string | undefined
    do {
      const page = await this.s3.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }))
      for (const o of page.Contents ?? []) if (o.Key && o.LastModified) out.push({ key: o.Key, size: o.Size ?? 0, lastModified: o.LastModified })
      token = page.IsTruncated ? page.NextContinuationToken : undefined
    } while (token)
    return out
  }

  async remove(keys: string[]): Promise<void> {
    for (let i = 0; i < keys.length; i += 1000) {
      await this.s3.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys.slice(i, i + 1000).map((Key) => ({ Key })), Quiet: true } }))
    }
  }
}

export type SweepResult = { mode: 'report' | 'delete'; files: number; old: number; abandoned: number; abandonedBytes: number; deleted: number; refused: string | null }

@Injectable()
export class MediaSweepService {
  private readonly logger = new Logger(MediaSweepService.name)

  constructor(private readonly prisma: PrismaService, @Inject(ENV) private readonly env: Env) {}

  get configured(): boolean {
    return s3Configured(this.env)
  }

  /**
   * Every media key the database mentions. Reads each text-like column of each table in the schema with one query (the
   * rows whose text contains an upload area), so a new table or column that stores an address is covered without a
   * change here.
   */
  async referencedKeys(): Promise<Set<string>> {
    const db = this.prisma.client
    const columns = await db.$queryRawUnsafe<{ table: string; column: string }[]>(
      `SELECT c.table_name AS "table", c.column_name AS "column"
         FROM information_schema.columns c
         JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
        WHERE c.table_schema = current_schema() AND c.table_name <> '_prisma_migrations'
          AND (c.data_type IN ('text', 'character varying', 'json', 'jsonb') OR (c.data_type = 'ARRAY' AND c.udt_name IN ('_text', '_varchar')))`,
    )
    const pattern = `(${MEDIA_PREFIXES.map((p) => p.slice(0, -1)).join('|')})/`
    const found = new Set<string>()
    for (const { table, column } of columns) {
      const quoted = `"${table.replace(/"/g, '""')}"."${column.replace(/"/g, '""')}"`
      const rows = await db.$queryRawUnsafe<{ v: string }[]>(`SELECT ${quoted}::text AS v FROM "${table.replace(/"/g, '""')}" WHERE ${quoted}::text ~ $1`, pattern)
      for (const { v } of rows) for (const key of keysIn(v)) found.add(key)
    }
    return found
  }

  /** One run: list, compare, report; delete only when switched on and the plan looks sane. */
  async run(store: MediaStore | null = null, now = new Date()): Promise<SweepResult> {
    const media = store ?? new S3MediaStore(this.env.S3_BUCKET!, this.env)
    const objects = (await Promise.all(MEDIA_PREFIXES.map((p) => media.list(p)))).flat()
    const plan = planSweep(objects, await this.referencedKeys(), now, this.env.MEDIA_SWEEP_MIN_AGE_DAYS)
    const mode = this.env.MEDIA_SWEEP_DELETE ? 'delete' : 'report'
    let deleted = 0
    if (mode === 'delete' && !plan.refuse && plan.abandoned.length) {
      await media.remove(plan.abandoned.map((o) => o.key))
      deleted = plan.abandoned.length
    }
    const result: SweepResult = { mode, files: objects.length, old: plan.old, abandoned: plan.abandoned.length, abandonedBytes: plan.abandonedBytes, deleted, refused: plan.refuse }
    // Numbers only: keys carry tenant and profile ids.
    const line = `media sweep (${mode}): ${result.files} files, ${result.old} older than ${this.env.MEDIA_SWEEP_MIN_AGE_DAYS} days, ${result.abandoned} abandoned (${Math.round(result.abandonedBytes / 1_048_576)} MB), ${deleted} deleted`
    if (plan.refuse) this.logger.warn(`${line}; deletion refused: ${plan.refuse}`)
    else this.logger.log(line)
    return result
  }
}
