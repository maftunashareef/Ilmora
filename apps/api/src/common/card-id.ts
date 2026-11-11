import type { Env } from '../config/env'
import { hmacSha256 } from './crypto'

/** The key of the ids companies see for students' cards (Н-6): its own secret, else one derived from the sign-in secret. */
const cardKey = (env: Env) => env.CARD_ID_SECRET ?? hmacSha256(env.JWT_ACCESS_SECRET, 'ilmora-graduate-card')

/**
 * A card id a company sees instead of a student's account id (№127): a keyed hash of the company, the place the card is
 * shown (an announcement id, or «students» for the «Студенты» section) and the student. Stable for this company there,
 * unrelated across companies, and it cannot be turned back into the account id.
 */
export const companyCardId = (env: Env, companyId: string, scope: string, userId: string) => hmacSha256(cardKey(env), `${companyId}:${scope}:${userId}`).slice(0, 32)
