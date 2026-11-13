import { OFFER_VERSION } from '@ilmora/shared'
import type { AuthUser } from '@/store/useStore'

/** The offer and personal-data consent marks (section 9.1 of the offer keeps them separate). */
export interface ConsentState {
  acceptOffer: boolean
  consentPersonalData: boolean
}
export const EMPTY_CONSENT: ConsentState = { acceptOffer: false, consentPersonalData: false }
export const consentComplete = (c: ConsentState) => c.acceptOffer && c.consentPersonalData

/** An account must have accepted the current offer edition and given personal-data consent before using a workspace. */
export const needsConsent = (u: AuthUser | null | undefined) => !!u && (!u.offerAcceptedAt || u.offerVersion !== OFFER_VERSION || !u.consentAt)
