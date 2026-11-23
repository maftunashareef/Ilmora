import type { Env } from '../../../config/env'

/**
 * Rules shared by the Click adapter, the payment service and the seat-hold expiry. Kept apart from click.service.ts so
 * the enrollment module can use them without importing the adapter.
 */

/** cancelReason of a Click attempt that passed Prepare and never got Complete (as Payme's reason 4, «timeout»). */
export const CLICK_REASON_ABANDONED = 4

/**
 * A Click attempt created before this moment and still without Complete is abandoned: it no longer blocks other attempts
 * on its invoice, nor the expiry of the seat hold (security review 10.11 №6).
 */
export const clickStaleBefore = (env: Pick<Env, 'CLICK_PENDING_MINUTES'>, now = new Date()) => new Date(now.getTime() - env.CLICK_PENDING_MINUTES * 60_000)
