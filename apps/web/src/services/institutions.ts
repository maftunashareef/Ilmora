import type { InstitutionType, OrgOwnership } from '@ilmora/shared'
import { api } from '../lib/api'

export interface ClaimChoice {
  stir: string
  type: InstitutionType
  /** The registry entry's name, or the name the representative typed when the institution is not listed. */
  name: string
  ownership: OrgOwnership
  /** UZ_REGIONS id; the API takes it as `regionId` (ТЗ 3.4: the region slug or the database id). */
  region: string
}

export interface ClaimOutcome {
  /** A new institution was added to the registry (its STIR was not there); false: an existing entry was claimed. */
  created: boolean
  /** For a new institution: whether its ownership and region were saved too (otherwise they are set in the passport). */
  detailsSaved: boolean
}

/**
 * ТЗ 4.2 steps 2–3, right after the representative's account is created: claim the institution by its STIR
 * (`POST /v1/institutions/claim`). A listed STIR takes the registry entry as it is; an unlisted one creates a draft
 * from the type and name, whose ownership and region are then saved to the passport (`PATCH /v1/institutions/me`).
 * A STIR someone already represents fails with `already_claimed`.
 */
export async function claimInstitution(c: ClaimChoice): Promise<ClaimOutcome> {
  const { created } = await api<{ created: boolean }>('/institutions/claim', {
    method: 'POST',
    body: { stir: c.stir, type: c.type, name: c.name.trim() },
  })
  if (!created) return { created, detailsSaved: true }
  try {
    await api('/institutions/me', { method: 'PATCH', body: { ownership: c.ownership, regionId: c.region } })
    return { created, detailsSaved: true }
  } catch {
    // The institution is claimed; ownership and region can still be filled in its passport.
    return { created, detailsSaved: false }
  }
}
