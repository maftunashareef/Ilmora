import type { Publishable, Viewer } from './types.js'

export type Owned = Publishable & { teacherId: string }

export type AccessResult =
  | { allowed: true; reason: 'public' | 'owner' | 'admin' | 'assigned-student' | 'assigned-group' }
  | { allowed: false; reason: 'draft' | 'archived' | 'private' }

/**
 * Central access rule. Kept pure so a future server can run the same logic.
 * Demo roles are not security — see the access note in the UI.
 */
export function checkAccess(item: Owned, viewer: Viewer): AccessResult {
  if (viewer.role === 'admin') return { allowed: true, reason: 'admin' }
  if (viewer.role === 'teacher' && viewer.teacherId === item.teacherId) return { allowed: true, reason: 'owner' }
  if (item.status === 'draft') return { allowed: false, reason: 'draft' }
  if (item.status === 'archived') return { allowed: false, reason: 'archived' }
  if (item.visibility === 'public') return { allowed: true, reason: 'public' }
  if (viewer.role === 'student' && viewer.studentId) {
    if (item.audience.studentIds.includes(viewer.studentId)) return { allowed: true, reason: 'assigned-student' }
    if (viewer.groupIds.some((g) => item.audience.groupIds.includes(g))) return { allowed: true, reason: 'assigned-group' }
  }
  return { allowed: false, reason: 'private' }
}

export const canAccess = (item: Owned, viewer: Viewer) => checkAccess(item, viewer).allowed

/** Public listing rule: appears in search, catalog, channels for everyone. */
export const isPublicListed = (item: Pick<Publishable, 'status' | 'visibility'>) => item.status === 'published' && item.visibility === 'public'

/** Items a viewer sees in channel/listing contexts: public + assigned private (published). Owners/admins see everything. */
export function visibleFor<T extends Owned>(items: T[], viewer: Viewer): T[] {
  return items.filter((i) => checkAccess(i, viewer).allowed)
}
