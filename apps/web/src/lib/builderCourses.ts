import { isOnlineCourse, isPublicListed } from '@ilmora/shared'
import type { Course } from '../types'

/**
 * The courses «Свой набор» offers for a subscription: public, offline (groups with seats and a schedule — an online
 * course opens on the provider's site) and with at least one group. A center may publish a course before it has a group;
 * it stays in the catalog but cannot be put in a subscription — there is no seat to take. Such a course used to take the
 * whole cart page down: its first group's schedule was read from a group that does not exist.
 */
export const subscribableCourses = (courses: Course[]): Course[] => courses.filter((c) => isPublicListed(c) && !isOnlineCourse(c) && c.groups.length > 0)
