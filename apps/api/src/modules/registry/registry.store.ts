import type { DirectionDto, DistrictDto, IndustryDto, InstitutionSearchItemDto, InstitutionType, RegionDto } from '@ilmora/shared'

/**
 * Data access of the registry module. RegistryService holds the rules (keys, duplicates, limits, audit); the store only
 * reads and writes. Today the module runs on `MemoryRegistryStore` (stub data); once the data engineer's migration is
 * in, a Prisma implementation replaces it in `registry.module.ts` and nothing else changes.
 *
 * Needed from the migration: Industry, Direction (`searchKey` unique among not-merged rows), Region, District,
 * Institution with `searchKey` (= directionKey(name), indexed with regionId) for search and duplicate checks.
 */
export interface RegistryStore {
  industries(): Promise<IndustryDto[]>
  industry(id: string): Promise<IndustryDto | null>
  regions(): Promise<RegionDto[]>
  region(id: string): Promise<RegionDto | null>
  districts(regionId: string): Promise<DistrictDto[]>
  district(id: string): Promise<DistrictDto | null>

  /** Not-merged directions whose key contains `key`, official first, then by name. */
  suggestDirections(q: { key: string; industryId?: string; limit: number }): Promise<DirectionDto[]>
  /** The not-merged direction with exactly this key. */
  directionByKey(key: string): Promise<DirectionDto | null>
  /** Throws `DuplicateKeyError` when another request created the same key first (unique index). */
  createDirection(input: { name: string; key: string; industryId: string; createdBy: string }): Promise<DirectionDto>

  searchInstitutions(q: { key: string; type?: InstitutionType; regionId?: string; limit: number }): Promise<InstitutionSearchItemDto[]>
  institutionByKey(key: string, regionId: string): Promise<InstitutionSearchItemDto | null>
  /** A record added by a student: source STUDENT, no STIR, not counted in official figures until confirmed. */
  createStudentInstitution(input: { name: string; key: string; type: InstitutionType; regionId: string; districtId: string | null; createdBy: string }): Promise<InstitutionSearchItemDto>
}

export const REGISTRY_STORE = Symbol('REGISTRY_STORE')

/** A unique index refused the row: someone created the same key a moment earlier. */
export class DuplicateKeyError extends Error {
  constructor(what: string) {
    super(`Duplicate ${what}`)
  }
}
