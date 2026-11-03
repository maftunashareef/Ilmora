import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { isSafeExternalUrl, UNIVERSITIES } from '@ilmora/shared'
import { describe, expect, it } from 'vitest'

const PUBLIC_DIR = join(__dirname, '..', '..', 'public')

describe('official university logos', () => {
  it('point at a file shipped with the site that exists (or at an https upload)', () => {
    const withLogo = UNIVERSITIES.filter((u) => u.logoUrl)
    expect(withLogo.map((u) => u.id).sort()).toEqual(['uni-inha', 'uni-kiut', 'uni-mdis', 'uni-tuit', 'uni-wiut'])
    for (const u of withLogo) {
      if (isSafeExternalUrl(u.logoUrl!)) continue
      expect(u.logoUrl, u.id).toMatch(/^\/universities\/[a-z0-9-]+\.(svg|png|webp)$/)
      expect(existsSync(join(PUBLIC_DIR, u.logoUrl!)), u.logoUrl).toBe(true)
    }
  })
})
