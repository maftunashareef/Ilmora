import 'reflect-metadata'
import { describe, expect, it } from 'vitest'
import { ZodValidationPipe } from '../src/common/zod.pipe'
import { DecideInput, ReviewRejectInput } from '../src/modules/institutions/institutions-admin.controller'
import { GraduatesService } from '../src/modules/graduates/graduates.service'
import { testEnv } from './helpers'

/** Cybersecurity check 9.4, the items after the release (Н-6, Н-7); the rest is next to the features it changes. */
describe('Cybersecurity 9.4 after the release', () => {
  it('Н-7: a review decision without the `submittedAt` the reviewer saw is refused', () => {
    const decide = new ZodValidationPipe(DecideInput)
    expect(() => decide.transform({})).toThrow()
    expect(() => decide.transform(undefined)).toThrow()
    expect(decide.transform({ submittedAt: '2026-11-11T10:00:00.000Z' })).toEqual({ submittedAt: '2026-11-11T10:00:00.000Z' })
    const reject = new ZodValidationPipe(ReviewRejectInput)
    expect(() => reject.transform({ reason: 'Hujjat yöq' })).toThrow()
    expect(reject.transform({ reason: 'Hujjat yöq', submittedAt: '2026-11-11T10:00:00Z' })).toMatchObject({ reason: 'Hujjat yöq' })
  })

  it('Н-6: graduate card ids are keyed with their own secret, not the sign-in one', () => {
    const cardId = (env: ReturnType<typeof testEnv>) => {
      const svc = new GraduatesService({} as never, {} as never, {} as never, {} as never, env)
      return (svc as unknown as { cardId: (c: string, a: string, u: string) => string }).cardId('company', 'announcement', 'user')
    }
    const own = testEnv({ CARD_ID_SECRET: 'card-secret-card-secret-card-secret-12345' })
    const other = testEnv({ CARD_ID_SECRET: 'another-card-secret-another-card-secret-1' })
    expect(cardId(own)).toMatch(/^[0-9a-f]{32}$/)
    expect(cardId(own)).toBe(cardId(own))
    expect(cardId(own)).not.toBe(cardId(other))
    // The sign-in secret alone does not give the ids once the card secret is set.
    expect(cardId(own)).not.toBe(cardId(testEnv({ CARD_ID_SECRET: undefined })))
  })
})
