import { hasMarkup, TRAINING_COUNT_MAX, TRAINING_YEARS_AHEAD } from '@ilmora/shared'
import { z } from 'zod'
import { id } from '../registry/registry.schemas'

const thisYear = () => new Date().getUTCFullYear()
const year = z.number().int().refine((y) => y >= thisYear() && y <= thisYear() + TRAINING_YEARS_AHEAD, { message: `From this year to ${TRAINING_YEARS_AHEAD} years ahead` })
const count = z.number().int().min(1).max(TRAINING_COUNT_MAX)
const text = (max: number) =>
  z.string().transform((s) => s.normalize('NFC').trim()).pipe(z.string().max(max).refine((s) => !hasMarkup(s), { message: 'Must not contain < or >' })).transform((s) => s || null)

/** ТЗ 5.2 step 1: direction (its industry decides who is notified), how many, by which year, region or any, requirements. */
export const TrainingRequestInput = z
  .object({ directionId: id, count, byYear: year, regionId: id.nullable().optional(), requirements: text(2000).nullable().optional() })
  .strict()
/** While open: the numbers and the requirements. The direction and the region stay — institutions were notified by them. */
export const TrainingRequestPatch = z.object({ count, byYear: year, requirements: text(2000).nullable() }).partial().strict()

/** ТЗ 5.2 step 3: «Подготовим N человек к году Y» + a comment. */
export const TrainingOfferInput = z.object({ count, byYear: year, comment: text(1000).nullable().optional() }).strict()

export const IncomingQuery = z.object({ industryId: id.optional() })

export type TrainingRequestInput = z.infer<typeof TrainingRequestInput>
export type TrainingRequestPatch = z.infer<typeof TrainingRequestPatch>
export type TrainingOfferInput = z.infer<typeof TrainingOfferInput>
export type IncomingQuery = z.infer<typeof IncomingQuery>
