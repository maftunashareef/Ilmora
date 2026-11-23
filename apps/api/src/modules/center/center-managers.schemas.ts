import { hasMarkup } from '@ilmora/shared'
import { z } from 'zod'

const name = z.string().transform((s) => s.normalize('NFC').trim().replace(/\s+/g, ' ')).pipe(z.string().min(2).max(120).refine((s) => !hasMarkup(s), { message: 'Must not contain < or >' }))

/** A new manager account (№15): the login it signs in with and the person's name. The password is generated. */
export const CenterManagerInput = z.object({ login: z.string().min(3).max(32), name }).strict()
export type CenterManagerInput = z.infer<typeof CenterManagerInput>
