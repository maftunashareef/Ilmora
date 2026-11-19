import type { University } from '../types'

/** The ready-made preparation directions in the order they are shown everywhere: general first, then by field. */
export const TRACK_ORDER = ['prep-general', 'prep-medical', 'prep-law', 'prep-it', 'prep-economics']

/** Where a preparation direction stands in that order; one that is not listed goes last. */
export const trackRank = (u: University): number => (TRACK_ORDER.includes(u.id) ? TRACK_ORDER.indexOf(u.id) : TRACK_ORDER.length)
