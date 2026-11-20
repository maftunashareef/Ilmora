import type { TKey } from '../i18n/translations'
import type { University } from '../types'

/**
 * How each ready-made preparation direction looks, in the order they are shown everywhere (general first, then by
 * field): its photo, the icon it shows in place of a logo, and the subjects named on its card (the detail page lists
 * the exact requirements of each route).
 */
export const TRACK_VISUALS: Record<string, { image: string; position?: string; icon: string; subjects: TKey[] }> = {
  'prep-general': { image: '/images/courses/mathematics.jpg', position: '38% 62%', icon: 'cap', subjects: ['uni.subject.native', 'uni.subject.math', 'uni.subject.historyUz', 'uni.subject.english'] },
  'prep-medical': { image: '/images/courses/science-lab.jpg', position: '52% 55%', icon: 'medical', subjects: ['uni.subject.biology', 'uni.subject.chemistry', 'uni.subject.english'] },
  'prep-law': { image: '/images/admission/law-library.jpg', position: '50% 40%', icon: 'scale', subjects: ['uni.subject.law', 'uni.subject.history', 'uni.subject.foreign'] },
  'prep-it': { image: '/images/courses/frontend-dev.jpg', position: '32% 42%', icon: 'cpu', subjects: ['uni.subject.math', 'uni.subject.physics', 'uni.subject.computing'] },
  'prep-economics': { image: '/images/courses/python-data.jpg', position: '40% 62%', icon: 'chart', subjects: ['uni.subject.math', 'uni.subject.foreign'] },
}

const TRACK_ORDER = Object.keys(TRACK_VISUALS)

/** Where a preparation direction stands in that order; one that is not listed goes last. */
export const trackRank = (u: University): number => (TRACK_ORDER.includes(u.id) ? TRACK_ORDER.indexOf(u.id) : TRACK_ORDER.length)
