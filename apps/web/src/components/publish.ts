import type { TKey } from '../i18n/translations'
import type { Audience, Permissions, Status, Visibility } from '../types'
import type { PublishDraft, PublishMode } from './PublishFields'

export type FinalizeResult =
  | { ok: false; error: TKey }
  | { ok: true; patch: { status: Status; visibility: Visibility; audience: Audience; reviewRequested: boolean; updatedAt: string }; note?: TKey }

/** Enforce: publishing requires a visibility choice; teachers without publish rights get a review request instead. */
export function finalizePublish(draft: PublishDraft, mode: PublishMode, perms: Permissions['teacher']): FinalizeResult {
  if (draft.status === 'published' && draft.visibility === null) return { ok: false, error: 'vis.required' }
  const visibility: Visibility = draft.visibility ?? 'private'
  const audience = visibility === 'public' ? { studentIds: [], groupIds: [] } : draft.audience
  const updatedAt = new Date().toISOString()
  if (draft.status === 'published' && mode === 'teacher' && !perms.publishDirectly) {
    return { ok: true, patch: { status: 'draft', visibility, audience, reviewRequested: true, updatedAt }, note: 'studio.reviewPending' }
  }
  return { ok: true, patch: { status: draft.status, visibility, audience, reviewRequested: false, updatedAt } }
}
