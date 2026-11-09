import { Inject, Injectable } from '@nestjs/common'
import { directionKey, type DirectionAddResult, type DirectionDto, type InstitutionAddResult, type InstitutionSearchItemDto, SUGGEST_LIMIT, SUGGEST_MIN_CHARS } from '@ilmora/shared'
import { AppError } from '../../common/errors'
import type { RequestActor } from '../../infra/tenancy/tenant-context'
import { AuditService } from '../audit/audit.service'
import type { DirectionInput, DirectionsQuery, InstitutionsQuery, StudentInstitutionInput } from './registry.schemas'
import { DuplicateKeyError, REGISTRY_STORE, type RegistryStore } from './registry.store'

/**
 * Reference data of the registry (ТЗ 3): industries, regions, the shared direction field and institution search.
 * One direction (and one student-added institution per region) per `directionKey`: the store's unique index is the
 * real guard, this service turns a lost race into «the existing one» instead of an error.
 */
@Injectable()
export class RegistryService {
  constructor(@Inject(REGISTRY_STORE) private readonly store: RegistryStore, private readonly audit: AuditService) {}

  industries() { return this.store.industries() }
  regions() { return this.store.regions() }
  districts(regionId: string) { return this.store.districts(regionId) }

  /** Suggestions after 2 characters (ТЗ 3.2). A shorter query answers an empty list rather than the whole dictionary. */
  async suggestDirections(q: DirectionsQuery): Promise<DirectionDto[]> {
    const key = directionKey(q.q)
    if (key.length < SUGGEST_MIN_CHARS) return []
    return this.store.suggestDirections({ key, industryId: q.industryId, limit: SUGGEST_LIMIT })
  }

  /**
   * «Добавить „…“» (ТЗ 3.2 step 3): saved to the shared dictionary at once, marked as user-added. When the same key
   * already exists the existing direction is returned (`created: false`) — with its own industry, which the chip shows.
   */
  async addDirection(actor: RequestActor, input: DirectionInput): Promise<DirectionAddResult> {
    if (!(await this.store.industry(input.industryId))) throw AppError.invalid('invalid_industry', 'Choose an industry from the list')
    const key = directionKey(input.name)
    if (key.length < SUGGEST_MIN_CHARS) throw AppError.invalid('invalid_name', 'Enter the name of the direction')
    const existing = await this.store.directionByKey(key)
    if (existing) return { direction: existing, created: false }
    let direction: DirectionDto
    try {
      direction = await this.store.createDirection({ name: input.name, key, industryId: input.industryId, createdBy: actor.id })
    } catch (e) {
      if (!(e instanceof DuplicateKeyError)) throw e
      const winner = await this.store.directionByKey(key)
      if (!winner) throw e
      return { direction: winner, created: false }
    }
    await this.audit.record({ action: 'registry.direction.create', entityType: 'Direction', entityId: direction.id, after: { name: direction.name, industryId: direction.industry.id } })
    return { direction, created: true }
  }

  /** Public search (ТЗ 9.4): name, type, region only. Needs 2+ characters, like the direction field. */
  async searchInstitutions(q: InstitutionsQuery): Promise<InstitutionSearchItemDto[]> {
    const key = directionKey(q.q)
    if (key.length < SUGGEST_MIN_CHARS) return []
    return this.store.searchInstitutions({ key, type: q.type, regionId: q.regionId, limit: SUGGEST_LIMIT })
  }

  /**
   * A student did not find their institution (ТЗ 3.5, 4.1): the record is available to other students at once, marked
   * «added by a student», with no STIR and outside the official figures until the Super Admin merges it.
   */
  async addStudentInstitution(actor: RequestActor, input: StudentInstitutionInput): Promise<InstitutionAddResult> {
    if (!(await this.store.region(input.regionId))) throw AppError.invalid('invalid_region', 'Choose a region from the list')
    if (input.districtId) {
      const district = await this.store.district(input.districtId)
      if (!district || district.regionId !== input.regionId) throw AppError.invalid('invalid_district', 'Choose a district of the selected region')
    }
    const key = directionKey(input.name)
    if (key.length < SUGGEST_MIN_CHARS) throw AppError.invalid('invalid_name', 'Enter the name of the institution')
    const existing = await this.store.institutionByKey(key, input.regionId)
    if (existing) return { institution: existing, created: false }
    let institution: InstitutionSearchItemDto
    try {
      institution = await this.store.createStudentInstitution({ name: input.name, key, type: input.type, regionId: input.regionId, districtId: input.districtId ?? null, createdBy: actor.id })
    } catch (e) {
      if (!(e instanceof DuplicateKeyError)) throw e
      const winner = await this.store.institutionByKey(key, input.regionId)
      if (!winner) throw e
      return { institution: winner, created: false }
    }
    await this.audit.record({ action: 'registry.institution.create_by_student', entityType: 'Institution', entityId: institution.id, after: { name: institution.name, type: institution.type, regionId: input.regionId } })
    return { institution, created: true }
  }
}
