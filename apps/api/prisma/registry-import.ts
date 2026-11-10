import { REGISTRY_REGIONS, registrySearchKey, registrySearchText, TECHNIKUMS, type Technikum } from '@ilmora/shared'
import type { Prisma, PrismaClient } from '../src/generated/prisma/client'

type Holder = { id: string; name: string; source: string; status: string }

export interface TechnikumImportReport {
  total: number
  /** New records (ids "pe-…"), UNCLAIMED, source IMPORT. */
  created: string[]
  /** Unclaimed imported records whose official fields changed in the list. */
  updated: string[]
  /** Claimed records (a representative is filling them in): only the empty informational fields were filled. */
  enriched: string[]
  unchanged: number
  /** The list's STIR already belongs to another record (e.g. a self-registration): not written, merge by hand. */
  stirConflicts: { id: string; name: string; stir: string; holder: Holder }[]
  /** Created next to a record with the same normalized name in the same region (e.g. added by a student): merge later. */
  sameName: { id: string; name: string; holder: Holder }[]
  /** Regions of the list that are not in the database (run prisma/seed-registry.ts). */
  missingRegion: string[]
  /** Imported records ("pe-…") no longer in the list: kept as they are. */
  notInList: { id: string; name: string }[]
  applied: boolean
}

/**
 * Loads the official technikum list (TECHNIKUMS in @ilmora/shared, stat.edu.uz) into "Institution" with the ids the web
 * app already uses ("pe-<id>"). Idempotent; without `apply` it only reports what it would do.
 *
 * - New: created UNCLAIMED, source IMPORT, type TECHNIKUM (the list is the ministry's list of professional education
 *   institutions; the Super Admin changes the type where needed).
 * - Unclaimed imported records follow the list; a value the list lacks (STIR, district) is never cleared.
 * - Claimed records (DRAFT and later: the representative owns name, STIR, region) get only the empty Russian name, former
 *   name and district, and their search text.
 * - A STIR already held by another record is reported, not written: one institution per STIR (unique index), and the
 *   self-registered record is the one people use. The two are merged by hand.
 * Everything is written in one transaction.
 */
export async function importTechnikums(
  prisma: PrismaClient,
  tenantId: string,
  { apply = false, list = TECHNIKUMS }: { apply?: boolean; list?: readonly Technikum[] } = {},
): Promise<TechnikumImportReport> {
  const report: TechnikumImportReport = {
    total: list.length, created: [], updated: [], enriched: [], unchanged: 0, stirConflicts: [], sameName: [], missingRegion: [], notInList: [], applied: false,
  }

  // Regions by the web app's slug, through the SOATO code (works before Region.slug is filled in).
  const regions = await prisma.region.findMany({ where: { tenantId }, select: { id: true, code: true } })
  const regionIdByCode = new Map(regions.map((r) => [r.code, r.id]))
  const regionIdBySlug = new Map(REGISTRY_REGIONS.map((r) => [r.slug, regionIdByCode.get(r.code)]))

  const rows = await prisma.institution.findMany({
    where: { tenantId },
    select: { id: true, name: true, nameRu: true, formerName: true, searchKey: true, searchText: true, stir: true, ownership: true, regionId: true, districtName: true, source: true, status: true, mergedIntoId: true },
  })
  const byId = new Map(rows.map((r) => [r.id, r]))
  const holder = (r: (typeof rows)[number]): Holder => ({ id: r.id, name: r.name, source: r.source, status: r.status })
  // Who holds each STIR, kept current while planning so two list entries never claim the same one.
  const stirHolders = new Map(rows.filter((r) => r.stir).map((r) => [r.stir!, holder(r)]))

  const creates: Prisma.InstitutionCreateManyInput[] = []
  const updates: { id: string; data: Prisma.InstitutionUncheckedUpdateInput }[] = []

  for (const t of list) {
    const regionId = regionIdBySlug.get(t.region)
    if (!regionId) {
      report.missingRegion.push(t.id)
      continue
    }
    const stir = t.inn ?? null
    const stirHolder = stir ? stirHolders.get(stir) : undefined
    if (stir && stirHolder && stirHolder.id !== t.id) {
      report.stirConflicts.push({ id: t.id, name: t.name, stir, holder: stirHolder })
      continue
    }
    const row = byId.get(t.id)
    const searchKey = registrySearchKey(t.name)

    if (!row) {
      const twin = rows.find((r) => r.searchKey === searchKey && r.regionId === regionId && !r.mergedIntoId)
      if (twin) report.sameName.push({ id: t.id, name: t.name, holder: holder(twin) })
      creates.push({
        id: t.id, tenantId, type: 'TECHNIKUM', ownership: t.ownership, name: t.name, nameRu: t.nameRu ?? null, formerName: t.formerName ?? null,
        searchKey, searchText: registrySearchText(t.name, t.nameRu, t.formerName), stir, regionId, districtName: t.district ?? null,
        source: 'IMPORT', status: 'UNCLAIMED',
      })
      report.created.push(t.id)
      if (stir) stirHolders.set(stir, { id: t.id, name: t.name, source: 'IMPORT', status: 'UNCLAIMED' })
      continue
    }

    const unclaimed = row.source === 'IMPORT' && row.status === 'UNCLAIMED'
    const wanted: Record<string, unknown> = unclaimed
      ? {
          name: t.name, searchKey, ownership: t.ownership, regionId,
          nameRu: t.nameRu ?? row.nameRu, formerName: t.formerName ?? row.formerName,
          stir: stir ?? row.stir, districtName: t.district ?? row.districtName,
        }
      : { nameRu: row.nameRu ?? t.nameRu ?? null, formerName: row.formerName ?? t.formerName ?? null, districtName: row.districtName ?? t.district ?? null }
    const name = (wanted.name as string | undefined) ?? row.name
    wanted.searchText = registrySearchText(name, wanted.nameRu as string | null, wanted.formerName as string | null)

    const data = Object.fromEntries(Object.entries(wanted).filter(([k, v]) => (row as Record<string, unknown>)[k] !== v))
    if (!Object.keys(data).length) {
      report.unchanged++
      continue
    }
    if (typeof data.stir === 'string') stirHolders.set(data.stir, holder(row))
    updates.push({ id: row.id, data })
    ;(unclaimed ? report.updated : report.enriched).push(row.id)
  }

  const listed = new Set(list.map((t) => t.id))
  report.notInList = rows.filter((r) => r.source === 'IMPORT' && r.id.startsWith('pe-') && !listed.has(r.id)).map((r) => ({ id: r.id, name: r.name }))

  // Ids are primary keys for the whole database, so the list can live in one tenant only.
  const elsewhere = creates.length
    ? await prisma.institution.findMany({ where: { id: { in: creates.map((c) => c.id!) }, NOT: { tenantId } }, select: { id: true, tenantId: true }, take: 5 })
    : []
  if (elsewhere.length) throw new Error(`Institutions ${elsewhere.map((e) => `${e.id} (tenant ${e.tenantId})`).join(', ')} already exist in another tenant`)

  if (apply && (creates.length || updates.length)) {
    await prisma.$transaction(
      async (tx) => {
        if (creates.length) await tx.institution.createMany({ data: creates })
        for (const u of updates) await tx.institution.update({ where: { id: u.id }, data: u.data })
      },
      { timeout: 120_000 },
    )
  }
  report.applied = apply
  return report
}
