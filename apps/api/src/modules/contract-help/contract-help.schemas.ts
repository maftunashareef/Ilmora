import { CONTRACT_HELP_MOTIVATION_MAX, CONTRACT_HELP_YEARS_MAX, hasMarkup } from '@ilmora/shared'
import { z } from 'zod'
import { id } from '../registry/registry.schemas'

/**
 * ТЗ 5.3 step 2–3: why help is needed, how many years the student is ready to work, where; the tick «send my anonymised
 * card to companies» (consent 2) must be on.
 */
export const ContractHelpInput = z
  .object({
    motivation: z.string().transform((s) => s.normalize('NFC').trim().replace(/[ \t]+/g, ' ')).pipe(
      z.string().min(10).max(CONTRACT_HELP_MOTIVATION_MAX).refine((s) => !hasMarkup(s), { message: 'Must not contain < or >' }),
    ),
    yearsToWork: z.number().int().min(1).max(CONTRACT_HELP_YEARS_MAX),
    workRegion: z.enum(['OWN', 'ANY']),
    consent: z.literal(true),
  })
  .strict()
/** ТЗ 5.3 «Договор заключён»: with which company. */
export const SignedInput = z.object({ companyId: id }).strict()
export const ContractHelpQuery = z.object({ region: z.string().trim().max(64).optional() })

export type ContractHelpInput = z.infer<typeof ContractHelpInput>
export type SignedInput = z.infer<typeof SignedInput>
export type ContractHelpQuery = z.infer<typeof ContractHelpQuery>
