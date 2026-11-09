import { randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'
import { directionKey, type DirectionDto, type DistrictDto, type IndustryDto, type InstitutionSearchItemDto, type InstitutionType, type Ownership, type RegionDto, type RegistrySource } from '@ilmora/shared'
import { DuplicateKeyError, type RegistryStore } from './registry.store'

/**
 * STUB until the data engineer's migration: the registry kept in process memory with sample data, so the web app can
 * be built against the real routes and response shapes. Additions live until the process restarts.
 *
 * Region and district codes are placeholders («stub-…»): official SOATO codes come with the ministry's file or the
 * statistics committee's list (ТЗ 3.4). Industries follow the draft list in ТЗ 3.1. Institutions are marked «(demo)».
 */

const L = (uz: string, ru: string, en: string) => ({ uz, ru, en })

const INDUSTRIES: IndustryDto[] = [
  { id: 'ind-it', name: L('IT va aloqa', 'IT и связь', 'IT and communications') },
  { id: 'ind-construction', name: L('Qurilish va arxitektura', 'Строительство и архитектура', 'Construction and architecture') },
  { id: 'ind-furniture', name: L('Mebel va yoğoçsozlik', 'Мебель и деревообработка', 'Furniture and woodworking') },
  { id: 'ind-business', name: L('Biznes, iqtisodiyot va moliya', 'Бизнес, экономика и финансы', 'Business, economics and finance') },
  { id: 'ind-agro', name: L('Qişloq xöjaligi va oziq-ovqat sanoati', 'Сельское хозяйство и пищевая промышленность', 'Agriculture and food industry') },
  { id: 'ind-medicine', name: L('Tibbiyot va farmatsevtika', 'Медицина и фармацевтика', 'Medicine and pharmacy') },
  { id: 'ind-education', name: L('Ta’lim va pedagogika', 'Образование и педагогика', 'Education and teaching') },
  { id: 'ind-transport', name: L('Transport va logistika', 'Транспорт и логистика', 'Transport and logistics') },
  { id: 'ind-energy', name: L('Energetika, neft va gaz', 'Энергетика, нефть и газ', 'Energy, oil and gas') },
  { id: 'ind-machinery', name: L('Maşinasozlik va metallga işlov beriş', 'Машиностроение и металлообработка', 'Mechanical engineering and metalworking') },
  { id: 'ind-textile', name: L('Töqimaçilik va yengil sanoat', 'Текстиль и лёгкая промышленность', 'Textiles and light industry') },
  { id: 'ind-chemistry', name: L('Kimyo va kon işi', 'Химия и горное дело', 'Chemistry and mining') },
  { id: 'ind-tourism', name: L('Turizm, mehmonxona işi va umumiy ovqatlaniş', 'Туризм, гостиничное дело и общепит', 'Tourism, hospitality and catering') },
  { id: 'ind-service', name: L('Servis va maişiy xizmatlar', 'Сервис и бытовые услуги', 'Services') },
  { id: 'ind-design', name: L('Dizayn, san’at va media', 'Дизайн, искусство и медиа', 'Design, art and media') },
  { id: 'ind-law', name: L('Huquq va davlat boşqaruvi', 'Право и госуправление', 'Law and public administration') },
  { id: 'ind-other', name: L('Boşqa', 'Другое', 'Other') },
]

const R = (n: number, uz: string, ru: string): RegionDto => ({ id: `reg-${n}`, soato: `stub-${String(n).padStart(2, '0')}`, name: { uz, ru } })
const REGIONS: RegionDto[] = [
  R(1, 'Toşkent şahri', 'г. Ташкент'),
  R(2, 'Toşkent viloyati', 'Ташкентская область'),
  R(3, 'Andijon viloyati', 'Андижанская область'),
  R(4, 'Buxoro viloyati', 'Бухарская область'),
  R(5, 'Jizzax viloyati', 'Джизакская область'),
  R(6, 'Qaşqadaryo viloyati', 'Кашкадарьинская область'),
  R(7, 'Navoiy viloyati', 'Навоийская область'),
  R(8, 'Namangan viloyati', 'Наманганская область'),
  R(9, 'Samarqand viloyati', 'Самаркандская область'),
  R(10, 'Surxondaryo viloyati', 'Сурхандарьинская область'),
  R(11, 'Sirdaryo viloyati', 'Сырдарьинская область'),
  R(12, 'Farğona viloyati', 'Ферганская область'),
  R(13, 'Xorazm viloyati', 'Хорезмская область'),
  R(14, 'Qoraqalpoğiston Respublikasi', 'Республика Каракалпакстан'),
]

const D = (regionN: number, n: number, uz: string, ru: string): DistrictDto => ({ id: `dist-${regionN}-${n}`, regionId: `reg-${regionN}`, soato: `stub-${regionN}-${n}`, name: { uz, ru } })
const DISTRICTS: DistrictDto[] = [
  D(1, 1, 'Çilonzor tumani', 'Чиланзарский район'),
  D(1, 2, 'Yunusobod tumani', 'Юнусабадский район'),
  D(1, 3, 'Mirzo Uluğbek tumani', 'Мирзо-Улугбекский район'),
  D(3, 1, 'Andijon şahri', 'г. Андижан'),
  D(9, 1, 'Samarqand şahri', 'г. Самарканд'),
]

interface DirectionRow { id: string; name: string; key: string; industryId: string; official: boolean; code: string | null; mergedIntoId: string | null; createdBy: string | null }
interface InstitutionRow { id: string; name: string; key: string; type: InstitutionType; ownership: Ownership | null; regionId: string; districtId: string | null; source: RegistrySource; createdBy: string | null }

const SAMPLE_DIRECTIONS: [string, string][] = [
  ['Dasturlaş', 'ind-it'], ['Kompyuter tarmoqlari', 'ind-it'], ['Mebel işlab çiqariş', 'ind-furniture'], ['Duradgorlik', 'ind-furniture'],
  ['Buxgalteriya hisobi', 'ind-business'], ['Bank işi', 'ind-business'], ['Hamşiralik işi', 'ind-medicine'], ['Qurilish muhandisligi', 'ind-construction'],
  ['Elektr montaj', 'ind-energy'], ['Payvandlaş', 'ind-machinery'], ['Tikuvçilik', 'ind-textile'], ['Oşpazlik', 'ind-tourism'],
]

const SAMPLE_INSTITUTIONS: Omit<InstitutionRow, 'id' | 'key' | 'source' | 'createdBy'>[] = [
  { name: '(demo) Toşkent axborot texnologiyalari texnikumi', type: 'TECHNIKUM', ownership: 'STATE', regionId: 'reg-1', districtId: 'dist-1-1' },
  { name: '(demo) Toşkent qurilish texnikumi', type: 'TECHNIKUM', ownership: 'STATE', regionId: 'reg-1', districtId: 'dist-1-2' },
  { name: '(demo) Andijon tibbiyot texnikumi', type: 'TECHNIKUM', ownership: 'STATE', regionId: 'reg-3', districtId: 'dist-3-1' },
  { name: '(demo) Samarqand mebel texnikumi', type: 'TECHNIKUM', ownership: 'PRIVATE', regionId: 'reg-9', districtId: 'dist-9-1' },
  { name: '(demo) Toşkent iqtisodiyot universiteti', type: 'UNIVERSITY', ownership: 'STATE', regionId: 'reg-1', districtId: 'dist-1-3' },
  { name: '(demo) 110-maktab', type: 'SCHOOL', ownership: 'STATE', regionId: 'reg-1', districtId: 'dist-1-1' },
  { name: '(demo) Akademik litsey', type: 'LYCEUM', ownership: 'STATE', regionId: 'reg-1', districtId: 'dist-1-2' },
]

@Injectable()
export class MemoryRegistryStore implements RegistryStore {
  private readonly directions: DirectionRow[] = SAMPLE_DIRECTIONS.map(([name, industryId], i) => ({ id: `dir-${i + 1}`, name, key: directionKey(name), industryId, official: false, code: null, mergedIntoId: null, createdBy: null }))
  private readonly institutions: InstitutionRow[] = SAMPLE_INSTITUTIONS.map((r, i) => ({ ...r, id: `inst-${i + 1}`, key: directionKey(r.name), source: 'IMPORT', createdBy: null }))

  async industries() { return INDUSTRIES }
  async industry(id: string) { return INDUSTRIES.find((i) => i.id === id) ?? null }
  async regions() { return REGIONS }
  async region(id: string) { return REGIONS.find((r) => r.id === id) ?? null }
  async districts(regionId: string) { return DISTRICTS.filter((d) => d.regionId === regionId) }
  async district(id: string) { return DISTRICTS.find((d) => d.id === id) ?? null }

  async suggestDirections(q: { key: string; industryId?: string; limit: number }) {
    return this.directions
      .filter((d) => !d.mergedIntoId && d.key.includes(q.key) && (!q.industryId || d.industryId === q.industryId))
      .sort((a, b) => Number(b.official) - Number(a.official) || a.name.localeCompare(b.name))
      .slice(0, q.limit)
      .map((d) => this.toDirection(d))
  }

  async directionByKey(key: string) {
    const d = this.directions.find((x) => !x.mergedIntoId && x.key === key)
    return d ? this.toDirection(d) : null
  }

  async createDirection(input: { name: string; key: string; industryId: string; createdBy: string }) {
    if (this.directions.some((x) => !x.mergedIntoId && x.key === input.key)) throw new DuplicateKeyError('direction')
    const row: DirectionRow = { id: randomUUID(), name: input.name, key: input.key, industryId: input.industryId, official: false, code: null, mergedIntoId: null, createdBy: input.createdBy }
    this.directions.push(row)
    return this.toDirection(row)
  }

  async searchInstitutions(q: { key: string; type?: InstitutionType; regionId?: string; limit: number }) {
    return this.institutions
      .filter((i) => i.key.includes(q.key) && (!q.type || i.type === q.type) && (!q.regionId || i.regionId === q.regionId))
      .sort((a, b) => Number(a.source === 'STUDENT') - Number(b.source === 'STUDENT') || a.name.localeCompare(b.name))
      .slice(0, q.limit)
      .map((i) => this.toInstitution(i))
  }

  async institutionByKey(key: string, regionId: string) {
    const i = this.institutions.find((x) => x.key === key && x.regionId === regionId)
    return i ? this.toInstitution(i) : null
  }

  async createStudentInstitution(input: { name: string; key: string; type: InstitutionType; regionId: string; districtId: string | null; createdBy: string }) {
    if (this.institutions.some((x) => x.key === input.key && x.regionId === input.regionId)) throw new DuplicateKeyError('institution')
    const row: InstitutionRow = { id: randomUUID(), name: input.name, key: input.key, type: input.type, ownership: null, regionId: input.regionId, districtId: input.districtId, source: 'STUDENT', createdBy: input.createdBy }
    this.institutions.push(row)
    return this.toInstitution(row)
  }

  private toDirection(d: DirectionRow): DirectionDto {
    const industry = INDUSTRIES.find((i) => i.id === d.industryId) ?? INDUSTRIES[INDUSTRIES.length - 1]
    return { id: d.id, name: d.name, industry, official: d.official, code: d.code }
  }

  private toInstitution(i: InstitutionRow): InstitutionSearchItemDto {
    const region = REGIONS.find((r) => r.id === i.regionId)
    const district = i.districtId ? DISTRICTS.find((d) => d.id === i.districtId) : undefined
    return {
      id: i.id, name: i.name, type: i.type, ownership: i.ownership,
      region: { id: i.regionId, name: region?.name ?? { uz: '', ru: '' } },
      district: district ? { id: district.id, name: district.name } : null,
      addedByStudent: i.source === 'STUDENT',
    }
  }
}
