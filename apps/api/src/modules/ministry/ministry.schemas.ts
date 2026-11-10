import { hasMarkup } from '@ilmora/shared'
import { z } from 'zod'

const text = (min: number, max: number) =>
  z.string().transform((s) => s.normalize('NFC').trim().replace(/\s+/g, ' ')).pipe(z.string().min(min).max(max).refine((s) => !hasMarkup(s), { message: 'Must not contain < or >' }))
const optionalEmail = z.union([z.literal(''), z.email().max(120)]).transform((s) => s || null)

export const MinistryAccountInput = z
  .object({ login: z.string().min(3).max(32), name: text(2, 120), jobTitle: text(2, 120).optional(), email: optionalEmail.optional() })
  .strict()
export const MinistryAccountPatch = z.object({ name: text(2, 120), jobTitle: text(2, 120).nullable(), email: optionalEmail.nullable() }).partial().strict()

export type MinistryAccountInput = z.infer<typeof MinistryAccountInput>
export type MinistryAccountPatch = z.infer<typeof MinistryAccountPatch>
