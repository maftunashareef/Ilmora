import { describe, expect, it } from 'vitest'
import { ZodValidationPipe } from '../src/common/zod.pipe'
import { TeacherPatch } from '../src/modules/manage/manage.schemas'

/**
 * PATCH /manage/profile for a teacher who registered on their own: the profile starts with `centerId: null` and
 * `{}` for title, bio and tagline (see AccountService.register). The web sends the shape checked here.
 */
describe('Self-registered teacher saves the channel', () => {
  const pipe = new ZodValidationPipe(TeacherPatch)
  const empty = { uz: '', ru: '', en: '' }

  it('accepts the profile payload the web sends for a brand-new profile (no center, empty texts, no photo)', () => {
    const body = {
      name: 'Yangi Ustoz', title: empty, bio: empty, tagline: { uz: 'Ilm nuri', ru: '', en: '' }, expertise: [],
      avatarSeed: 1, bannerTone: '#163C35', avatarUrl: null, bannerUrl: null, channelActive: true, featured: null,
    }
    expect(() => pipe.transform(body)).not.toThrow()
    expect(pipe.transform(body)).toMatchObject({ name: 'Yangi Ustoz', tagline: { uz: 'Ilm nuri', ru: '', en: '' } })
  })

  it('still refuses what the old payload carried: a null center, texts without every language and browser-only previews', () => {
    expect(() => pipe.transform({ centerId: null })).toThrow()
    expect(() => pipe.transform({ title: {} })).toThrow()
    expect(() => pipe.transform({ tagline: { uz: 'Ilm nuri' } })).toThrow()
    expect(() => pipe.transform({ avatarUrl: 'blob:http://localhost:3000/photo' })).toThrow()
  })
})
