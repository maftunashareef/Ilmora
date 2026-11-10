/**
 * Registry test data for development and staging: by default 600 institutions and 10 000 students, plus companies,
 * graduation announcements, training requests and offers, contract-help requests, contact requests and vacancies —
 * enough to build the cabinets on and to check that the ministry's numbers stay under 2 seconds.
 *
 *   npm run prisma:seed:registry-demo -w apps/api
 *   REGISTRY_DEMO_INSTITUTIONS=600 REGISTRY_DEMO_STUDENTS=10000   sizes
 *   REGISTRY_DEMO_RESET=true                                      delete the previous demo rows first
 *
 * Every row is marked: ids start with "demo-", names end with "(demo)", STIRs start with 0 (no real STIR does).
 * Demo accounts get no password. Refuses to run with NODE_ENV=production: the live registry never holds fake records.
 */
import { PrismaPg } from '@prisma/adapter-pg'
import { registrySearchKey } from '@ilmora/shared'
import type { InstitutionStatus, InstitutionType, Prisma } from '../src/generated/prisma/client'
import { PrismaClient } from '../src/generated/prisma/client'
import { seedRegistryReference } from './registry-reference'

try {
  process.loadEnvFile?.('.env')
} catch {
  /* env from the process */
}

if (process.env.NODE_ENV === 'production') throw new Error('seed-registry-demo refuses to run with NODE_ENV=production')
const DATABASE_URL = process.env.DATABASE_MIGRATE_URL ?? process.env.DATABASE_URL
if (!DATABASE_URL) throw new Error('DATABASE_URL is required')
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: DATABASE_URL }) })

const TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG ?? 'ilmora'
const N_INSTITUTIONS = Number(process.env.REGISTRY_DEMO_INSTITUTIONS ?? 600)
const N_STUDENTS = Number(process.env.REGISTRY_DEMO_STUDENTS ?? 10_000)
const N_COMPANIES = 80
const RESET = process.env.REGISTRY_DEMO_RESET === 'true'
const BATCH = 1000

/** Deterministic pseudo-random numbers (mulberry32), so two runs produce the same data. */
let seed = 20261111
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}
const int = (min: number, max: number) => min + Math.floor(rnd() * (max - min + 1))
const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)]
const sample = <T>(a: readonly T[], n: number) => [...a].sort(() => rnd() - 0.5).slice(0, Math.min(n, a.length))
const weighted = <T>(pairs: [T, number][]) => {
  let r = rnd() * pairs.reduce((s, [, w]) => s + w, 0)
  for (const [v, w] of pairs) if ((r -= w) < 0) return v
  return pairs[pairs.length - 1][0]
}
const stir = (prefix: string, n: number) => `${prefix}${String(n).padStart(9 - prefix.length, '0')}`
async function inBatches<T>(rows: T[], insert: (chunk: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += BATCH) await insert(rows.slice(i, i + BATCH))
}

/** A few real-sounding directions per industry slug; names get " (demo)" so they never collide with real ones. */
const DIRECTIONS: Record<string, string[]> = {
  it: ['Dasturlaş', 'Kompyuter tarmoqlari', 'Veb-dizayn', 'Axborot xavfsizligi', 'Kompyuter texnikasini ta’mirlaş'],
  construction: ['Quriliş montaj işlari', 'Elektr montaj', 'Payvandlaş', 'Santexnika'],
  furniture: ['Bazis-Mebelşçik', 'Mebel işlab çiqariş', 'Duradgorlik'],
  business: ['Buxgalteriya hisobi', 'Bank işi', 'Marketing', 'Kiçik biznes'],
  'agriculture-food': ['Agronomiya', 'Veterinariya', 'Oziq-ovqat texnologiyasi', 'Qandolatçilik'],
  medicine: ['Hamşiralik işi', 'Farmatsiya', 'Laboratoriya diagnostikasi'],
  education: ['Boşlanğiç ta’lim', 'Maktabgaça ta’lim', 'Jismoniy tarbiya'],
  transport: ['Avtomobil ta’mirlaş', 'Logistika', 'Temir yöl transporti'],
  energy: ['Elektr energetikasi', 'Neft va gaz quduqlarini burğilaş', 'Quyoş energetikasi'],
  machinery: ['Tokarlik işi', 'Metallga işlov beriş', 'Stanoklarni sozlaş'],
  textile: ['Tikuvçilik', 'Kiyim dizayni', 'Töqimaçilik texnologiyasi'],
  'chemistry-mining': ['Kimyoviy texnologiya', 'Kon işlari'],
  tourism: ['Mehmonxona xizmati', 'Oşpazlik', 'Turizm'],
  services: ['Sartaroşlik', 'Maişiy texnika ta’miri'],
  'design-media': ['Grafik dizayn', 'Fotografiya', 'Interyer dizayni'],
  'law-government': ['Huquqşunoslik', 'Ish yuritiş'],
  other: ['Boşqa yönaliş'],
}

const TYPE_LABEL: Record<InstitutionType, string> = {
  TECHNIKUM: 'Texnikum', COLLEGE: 'Kollej', LYCEUM: 'Litsey', SCHOOL: 'Maktab', UNIVERSITY: 'Universitet', TRAINING_CENTER: 'Öquv markazi',
}

async function reset(tenantId: string) {
  const demo = { tenantId, id: { startsWith: 'demo-' } }
  await prisma.vacancyApplication.deleteMany({ where: demo })
  await prisma.contactRequest.deleteMany({ where: demo })
  await prisma.contractHelpRequest.deleteMany({ where: demo })
  await prisma.studentConsent.deleteMany({ where: demo })
  await prisma.announcementResponse.deleteMany({ where: demo })
  await prisma.trainingOffer.deleteMany({ where: demo })
  await prisma.vacancy.deleteMany({ where: demo })
  await prisma.graduationAnnouncement.deleteMany({ where: demo })
  await prisma.trainingRequest.deleteMany({ where: demo })
  await prisma.studentProfile.deleteMany({ where: demo })
  await prisma.user.deleteMany({ where: demo })
  await prisma.company.deleteMany({ where: demo })
  await prisma.institutionDirection.deleteMany({ where: demo })
  await prisma.institution.deleteMany({ where: demo })
  await prisma.direction.deleteMany({ where: demo })
}

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { slug: TENANT_SLUG } })
  if (!tenant) throw new Error(`Tenant "${TENANT_SLUG}" does not exist: run prisma/seed.ts first`)
  const tenantId = tenant.id
  await seedRegistryReference(prisma, tenantId)

  if (await prisma.institution.count({ where: { tenantId, id: { startsWith: 'demo-' } } })) {
    if (!RESET) return console.log('Registry demo data already exists: set REGISTRY_DEMO_RESET=true to recreate it')
    await reset(tenantId)
  }

  const industries = await prisma.industry.findMany({ where: { tenantId } })
  const regions = await prisma.region.findMany({ where: { tenantId } })
  const industryBySlug = new Map(industries.map((i) => [i.slug, i]))

  // Directions
  const directions: { id: string; industryId: string; name: string }[] = []
  for (const [slug, names] of Object.entries(DIRECTIONS)) {
    const industry = industryBySlug.get(slug)
    if (!industry) continue
    for (const name of names) directions.push({ id: `demo-dir-${directions.length + 1}`, industryId: industry.id, name: `${name} (demo)` })
  }
  await prisma.direction.createMany({
    data: directions.map((d) => ({ id: d.id, tenantId, name: d.name, searchKey: registrySearchKey(d.name), industryId: d.industryId, origin: 'ADMIN' as const })),
  })

  // Institutions, their directions and representatives
  const institutions: Prisma.InstitutionCreateManyInput[] = []
  const instDirections: Prisma.InstitutionDirectionCreateManyInput[] = []
  const reps: Prisma.UserCreateManyInput[] = []
  const approved: { id: string; regionId: string; directionIds: string[] }[] = []
  for (let i = 0; i < N_INSTITUTIONS; i++) {
    const id = `demo-inst-${i + 1}`
    const type = weighted<InstitutionType>([['TECHNIKUM', 85], ['COLLEGE', 5], ['LYCEUM', 4], ['UNIVERSITY', 3], ['TRAINING_CENTER', 3]])
    const status = weighted<InstitutionStatus>([['APPROVED', 40], ['PENDING', 20], ['DRAFT', 10], ['UNCLAIMED', 30]])
    const region = regions[i % regions.length]
    const name = `${TYPE_LABEL[type]} №${i + 1} (demo)`
    const now = new Date()
    institutions.push({
      id, tenantId, type, ownership: rnd() < 0.8 ? 'STATE' : 'PRIVATE', name, searchKey: registrySearchKey(name), stir: stir('0', i + 1),
      regionId: region.id, address: `${int(1, 120)}-uy (demo)`, status, source: 'IMPORT', directorName: status === 'UNCLAIMED' ? null : `Direktor ${i + 1} (demo)`,
      submittedAt: status === 'PENDING' || status === 'APPROVED' ? now : null, approvedAt: status === 'APPROVED' ? now : null,
    })
    const dirs = sample(directions, int(3, 8))
    for (const d of dirs) instDirections.push({ id: `demo-idir-${instDirections.length + 1}`, tenantId, institutionId: id, directionId: d.id, studentsCount: int(20, 300) })
    if (status !== 'UNCLAIMED') {
      reps.push({ id: `demo-irep-${i + 1}`, tenantId, login: `demo-inst-${i + 1}`, displayName: `Vakil ${i + 1} (demo)`, roles: ['INSTITUTION_ADMIN'], institutionId: id, jobTitle: 'Direktor örinbosari' })
    }
    if (status === 'APPROVED') approved.push({ id, regionId: region.id, directionIds: dirs.map((d) => d.id) })
  }
  await inBatches(institutions, (c) => prisma.institution.createMany({ data: c }))
  await inBatches(instDirections, (c) => prisma.institutionDirection.createMany({ data: c }))

  // Companies, their industries and representatives
  const companies: Prisma.CompanyCreateManyInput[] = []
  const companyIndustries: Prisma.CompanyIndustryCreateManyInput[] = []
  const approvedCompanies: string[] = []
  for (let i = 0; i < N_COMPANIES; i++) {
    const id = `demo-co-${i + 1}`
    const status = weighted<'APPROVED' | 'PENDING' | 'DRAFT'>([['APPROVED', 70], ['PENDING', 20], ['DRAFT', 10]])
    const name = `Kompaniya ${i + 1} (demo)`
    companies.push({ id, tenantId, stir: stir('09', i + 1), name, searchKey: registrySearchKey(name), regionId: pick(regions).id, address: `${int(1, 90)}-uy (demo)`, status, approvedAt: status === 'APPROVED' ? new Date() : null })
    for (const ind of sample(industries, int(1, 3))) companyIndustries.push({ companyId: id, industryId: ind.id })
    reps.push({ id: `demo-crep-${i + 1}`, tenantId, login: `demo-company-${i + 1}`, displayName: `HR ${i + 1} (demo)`, roles: ['COMPANY_ADMIN'], companyId: id, jobTitle: 'HR menejer' })
    if (status === 'APPROVED') approvedCompanies.push(id)
  }
  await prisma.company.createMany({ data: companies })
  await prisma.companyIndustry.createMany({ data: companyIndustries })
  await inBatches(reps, (c) => prisma.user.createMany({ data: c }))

  // Students and their questionnaires
  const users: Prisma.UserCreateManyInput[] = []
  const profiles: Prisma.StudentProfileCreateManyInput[] = []
  const consents: Prisma.StudentConsentCreateManyInput[] = []
  const contractStudents: string[] = []
  for (let i = 0; i < N_STUDENTS; i++) {
    const userId = `demo-st-${i + 1}`
    users.push({ id: userId, tenantId, login: `demo-student-${i + 1}`, displayName: `Talaba ${i + 1} (demo)`, roles: ['STUDENT'] })
    const age = int(15, 23)
    const birthDate = new Date(Date.UTC(2026 - age, int(0, 11), int(1, 28)))
    if (rnd() < 0.8 && approved.length) {
      const inst = pick(approved)
      const studyForm = rnd() < 0.55 ? 'CONTRACT' : 'GRANT'
      profiles.push({
        id: `demo-sp-${i + 1}`, tenantId, userId, mode: 'STUDYING', institutionType: 'TECHNIKUM', institutionId: inst.id, course: int(1, 3),
        graduationYear: int(2026, 2029), directionId: pick(inst.directionIds), studyForm,
        contractAmountMinor: studyForm === 'CONTRACT' ? BigInt(int(8, 20)) * 1_000_000_00n : null, birthDate, regionId: inst.regionId,
        studyConfirmation: weighted([['CONFIRMED', 60], ['PENDING', 25], ['NONE', 15]]),
      })
      if (rnd() < 0.5) consents.push({ id: `demo-cs-${consents.length + 1}`, tenantId, userId, kind: 'GRADUATE_CARD', textVersion: '2026-11-11' })
      if (studyForm === 'CONTRACT' && contractStudents.length < 300) contractStudents.push(userId)
    } else {
      profiles.push({
        id: `demo-sp-${i + 1}`, tenantId, userId, mode: 'APPLYING', institutionType: pick(['TECHNIKUM', 'UNIVERSITY', 'LYCEUM'] as const),
        institutionId: rnd() < 0.5 && approved.length ? pick(approved).id : null, enrollYear: int(2026, 2027), directionId: pick(directions).id,
        studyForm: pick(['GRANT', 'CONTRACT', 'UNDECIDED'] as const), birthDate, regionId: pick(regions).id,
      })
    }
  }
  await inBatches(users, (c) => prisma.user.createMany({ data: c }))
  await inBatches(profiles, (c) => prisma.studentProfile.createMany({ data: c }))

  // Graduation announcements (one per approved institution, up to 120) with up to three lines each
  const announcements: Prisma.GraduationAnnouncementCreateManyInput[] = []
  const lines: Prisma.AnnouncementLineCreateManyInput[] = []
  for (const inst of approved.slice(0, 120)) {
    const id = `demo-ann-${announcements.length + 1}`
    announcements.push({ id, tenantId, institutionId: inst.id, year: 2026, status: 'PUBLISHED', publishedAt: new Date() })
    for (const d of sample(inst.directionIds, 3)) lines.push({ id: `demo-line-${lines.length + 1}`, announcementId: id, directionId: d, count: int(10, 200) })
  }
  await prisma.graduationAnnouncement.createMany({ data: announcements })
  await prisma.announcementLine.createMany({ data: lines })

  // Training requests from approved companies and offers from approved institutions
  const requests: Prisma.TrainingRequestCreateManyInput[] = []
  const offers: Prisma.TrainingOfferCreateManyInput[] = []
  for (let i = 0; i < 120 && approvedCompanies.length; i++) {
    const id = `demo-tr-${i + 1}`
    requests.push({ id, tenantId, companyId: pick(approvedCompanies), directionId: pick(directions).id, count: int(5, 100), byYear: int(2026, 2028), regionId: rnd() < 0.5 ? pick(regions).id : null, requirements: 'Talablar (demo)' })
    for (const inst of sample(approved, int(0, 3))) offers.push({ id: `demo-to-${offers.length + 1}`, tenantId, requestId: id, institutionId: inst.id, count: int(5, 50), byYear: int(2026, 2028) })
  }
  await prisma.trainingRequest.createMany({ data: requests })
  await prisma.trainingOffer.createMany({ data: offers, skipDuplicates: true })

  // Contract help: open requests with their consent rows; some companies asked for contacts
  await prisma.contractHelpRequest.createMany({
    data: contractStudents.map((userId, i) => ({ id: `demo-ch-${i + 1}`, tenantId, userId, motivation: 'Kontrakt tölovi uçun yordam kerak (demo)', yearsToWork: int(1, 5), workRegionId: rnd() < 0.5 ? pick(regions).id : null, status: 'ACTIVE' as const, openKey: userId })),
  })
  for (const userId of contractStudents) consents.push({ id: `demo-cs-${consents.length + 1}`, tenantId, userId, kind: 'CONTRACT_HELP_CARD', textVersion: '2026-11-11' })
  await inBatches(consents, (c) => prisma.studentConsent.createMany({ data: c }))
  const contacts = new Map<string, Prisma.ContactRequestCreateManyInput>()
  for (let i = 0; i < 150 && approvedCompanies.length && contractStudents.length; i++) {
    const companyId = pick(approvedCompanies)
    const userId = pick(contractStudents)
    contacts.set(`${companyId}:${userId}`, { id: `demo-cr-${i + 1}`, tenantId, companyId, userId, source: 'CONTRACT_HELP', status: weighted([['PENDING', 50], ['ACCEPTED', 35], ['DECLINED', 15]]) })
  }
  await prisma.contactRequest.createMany({ data: [...contacts.values()] })

  // Vacancies and applications
  const vacancies: Prisma.VacancyCreateManyInput[] = []
  const vacancyDirections: Prisma.VacancyDirectionCreateManyInput[] = []
  for (let i = 0; i < 60 && approvedCompanies.length; i++) {
    const id = `demo-vac-${i + 1}`
    const paid = rnd() < 0.4
    vacancies.push({ id, tenantId, companyId: pick(approvedCompanies), kind: rnd() < 0.6 ? 'PRACTICE' : 'INTERNSHIP', title: `Amaliyot ${i + 1} (demo)`, regionId: pick(regions).id, format: pick(['ONSITE', 'REMOTE', 'HYBRID'] as const), paid, stipendMinor: paid ? BigInt(int(1, 4)) * 1_000_000_00n : null, duration: `${int(1, 6)} oy`, seats: int(1, 20) })
    for (const d of sample(directions, int(1, 2))) vacancyDirections.push({ vacancyId: id, directionId: d.id })
  }
  await prisma.vacancy.createMany({ data: vacancies })
  await prisma.vacancyDirection.createMany({ data: vacancyDirections })
  const applications = new Map<string, Prisma.VacancyApplicationCreateManyInput>()
  for (let i = 0; i < 300 && vacancies.length; i++) {
    const vacancyId = pick(vacancies).id as string
    const userId = `demo-st-${int(1, N_STUDENTS)}`
    applications.set(`${vacancyId}:${userId}`, { id: `demo-va-${i + 1}`, tenantId, vacancyId, userId, status: weighted([['NEW', 50], ['VIEWED', 25], ['INVITED', 15], ['REJECTED', 10]]) })
  }
  await prisma.vacancyApplication.createMany({ data: [...applications.values()] })

  console.log(
    `Registry demo data: ${institutions.length} institutions (${approved.length} approved), ${directions.length} directions, ` +
      `${companies.length} companies, ${users.length} students, ${announcements.length} announcements, ${requests.length} training requests, ` +
      `${contractStudents.length} contract-help requests, ${vacancies.length} vacancies`,
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
