import type { Group, Preset, University } from '../types'
import type { CartBundle } from '../store/useStore'

export interface CartPackageView<G extends Group = Group> {
  presetId: string
  preset: Preset
  university?: University
  directionId?: string
  groups: G[]
}

/**
 * The cart's groups arranged by the ready-made packages they came with: each course is shown once, under the first
 * package in the cart that includes it, and the remaining ones stay on their own. A package whose courses all left
 * the cart, or that is no longer published, is skipped (its courses then count as the student's own).
 */
export function arrangeCartByPackage<G extends Group>(groups: G[], bundles: CartBundle[], presets: Preset[], universities: University[]): { packages: CartPackageView<G>[]; loose: G[] } {
  const packages: CartPackageView<G>[] = []
  const claimed = new Set<string>()
  for (const b of bundles) {
    const preset = presets.find((p) => p.id === b.presetId && p.enabled)
    const own = groups.filter((g) => b.courseIds.includes(g.courseId) && !claimed.has(g.courseId))
    if (!preset || own.length === 0) continue
    own.forEach((g) => claimed.add(g.courseId))
    packages.push({ presetId: b.presetId, preset, university: universities.find((u) => u.id === preset.universityId), directionId: b.directionId, groups: own })
  }
  return { packages, loose: groups.filter((g) => !claimed.has(g.courseId)) }
}
