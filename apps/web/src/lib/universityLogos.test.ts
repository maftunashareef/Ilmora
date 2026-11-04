import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { isPreparationTrack, isSafeExternalUrl, UNIVERSITIES } from '@ilmora/shared'
import { describe, expect, it } from 'vitest'

const PUBLIC_DIR = join(__dirname, '..', '..', 'public')

describe('official university logos', () => {
  it('point at a file shipped with the site that exists (or at an https upload)', () => {
    for (const u of UNIVERSITIES.filter((x) => x.logoUrl)) {
      if (isSafeExternalUrl(u.logoUrl!)) continue
      expect(u.logoUrl, u.id).toMatch(/^\/universities\/[a-z0-9-]+\.(svg|png|webp)$/)
      expect(existsSync(join(PUBLIC_DIR, u.logoUrl!)), u.logoUrl).toBe(true)
    }
  })

  it('exist for every university the site shows (preparation tracks show an icon instead)', () => {
    const shown = UNIVERSITIES.filter((u) => u.published && !isPreparationTrack(u))
    expect(shown.filter((u) => !u.logoUrl).map((u) => u.id)).toEqual([])
  })
})
