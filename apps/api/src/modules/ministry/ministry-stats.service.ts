import { Injectable } from '@nestjs/common'
import type { L, MinistryStatsDto, MinistryStatsFilters, MinistryTableKey, StatsTableDto } from '@ilmora/shared'
import { AppError } from '../../common/errors'
import type { Prisma } from '../../generated/prisma/client'
import { PrismaService } from '../../infra/prisma/prisma.service'
import { TenantContext } from '../../infra/tenancy/tenant-context'
import { regionIdByRef } from '../registry/registry.mappers'

const T = (uz: string, ru: string, en: string): L => ({ uz, ru, en })
const col = (key: string, label: L, numeric = true) => ({ key, label, numeric })
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0)
const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v)
const DASH = T('—', '—', '—')

/** Below this, a count of people is shown as «<5» (cybersecurity check 9.4, Н-3). */
export const SMALL_CELL = 5
/**
 * A count of people as the ministry may see it: 0 stays, 1–4 is «<5», 5 and more is rounded to 5. Rounding is what keeps
 * «<5» hidden: a table of people has its total next to its parts (and the web adds a column up), so with exact parts the
 * hidden cell would come back by subtraction; with parts and totals rounded independently it stays a range.
 */
export const protectCount = (n: number): number | string => (n === 0 ? 0 : n < SMALL_CELL ? `<${SMALL_CELL}` : Math.round(n / SMALL_CELL) * SMALL_CELL)
/** The columns of a table of people (students' own records, not the figures institutions or companies declare) protected. */
const protectPeople = (table: StatsTableDto, keys: string[]): StatsTableDto => ({
  ...table,
  rows: table.rows.map((r) => ({ ...r, ...Object.fromEntries(keys.map((k) => [k, typeof r[k] === 'number' ? protectCount(r[k] as number) : r[k]])) })),
})

const TYPE_NAMES: Record<string, L> = {
  TECHNIKUM: T('Texnikum', 'Техникум', 'Technikum'), COLLEGE: T('Kollej', 'Колледж', 'College'), LYCEUM: T('Litsey', 'Лицей', 'Lyceum'),
  SCHOOL: T('Maktab', 'Школа', 'School'), UNIVERSITY: T('Oliy ta’lim muassasasi', 'Вуз', 'University'), TRAINING_CENTER: T('Öquv markazi', 'Учебный центр', 'Training center'),
}
const COLS = {
  industry: col('industry', T('Soha', 'Отрасль', 'Industry'), false),
  region: col('region', T('Hudud', 'Регион', 'Region'), false),
  type: col('type', T('Muassasa turi', 'Тип учреждения', 'Institution type'), false),
  year: col('year', T('Yil', 'Год', 'Year')),
  institutions: col('institutions', T('Muassasalar', 'Учреждений', 'Institutions')),
  students: col('students', T('Talabalar', 'Студентов', 'Students')),
}

/** Where an institution is counted officially: approved once, not merged, not a student-added record (ТЗ 7). */
const OFFICIAL: Prisma.InstitutionWhereInput = { approvedAt: { not: null }, blockedAt: null, mergedIntoId: null, source: { not: 'STUDENT' } }

type Ctx = {
  f: MinistryStatsFilters & { regionDbId?: string }
  inst: Prisma.InstitutionWhereInput
  regions: Map<string, L>
  industries: { id: string; name: L; sortOrder: number }[]
  industryOfDirection: Map<string, string>
}

/**
 * The ministry's figures (ТЗ 7.3): counts only — no student, representative or contact ever leaves here, and a count of
 * students' own records is protected (`protectCount`: «<5», the rest rounded to 5; the Excel export reads the same tables). Official
 * figures take approved institutions only; student-added records are a table of their own. Filters: region (id or
 * the web app's slug), institution type, ownership, year (of graduation, of a training request, of enrolment).
 * Computed on request from a few grouped reads (600+ institutions, 10 000 students: tens of milliseconds).
 */
@Injectable()
export class MinistryStatsService {
  constructor(private readonly prisma: PrismaService) {}

  async all(filters: MinistryStatsFilters): Promise<MinistryStatsDto> {
    const ctx = await this.context(filters)
    const tables = await Promise.all([
      this.demandSupply(ctx), this.coverage(ctx), this.byRegion(ctx), this.byType(ctx), this.studentsByIndustry(ctx), this.graduatesByYear(ctx),
      this.companiesByRegion(ctx), this.ilmoraStudents(ctx), this.applicants(ctx), this.contractHelp(ctx), this.vacancies(ctx), this.studentAdded(ctx),
    ])
    return { filters, generatedAt: new Date().toISOString(), tables }
  }

  async one(key: MinistryTableKey, filters: MinistryStatsFilters): Promise<StatsTableDto> {
    const ctx = await this.context(filters)
    const build: Record<MinistryTableKey, (c: Ctx) => Promise<StatsTableDto>> = {
      demand_supply: (c) => this.demandSupply(c), coverage: (c) => this.coverage(c), institutions_by_region: (c) => this.byRegion(c),
      institutions_by_type: (c) => this.byType(c), students_by_industry: (c) => this.studentsByIndustry(c), graduates_by_year: (c) => this.graduatesByYear(c),
      companies_by_region: (c) => this.companiesByRegion(c), ilmora_students: (c) => this.ilmoraStudents(c), applicants: (c) => this.applicants(c),
      contract_help: (c) => this.contractHelp(c), vacancies: (c) => this.vacancies(c), student_added: (c) => this.studentAdded(c),
    }
    return build[key](ctx)
  }

  // ───────────── tables ─────────────

  /** The main table (ТЗ 7.3 «Спрос и предложение по отраслям»): what institutions teach and release against what companies ask for. */
  private async demandSupply(ctx: Ctx): Promise<StatsTableDto> {
    const [students, graduates, companies, requests, offers] = await Promise.all([
      this.studentsPerIndustry(ctx), this.graduatesPerIndustry(ctx),
      this.prisma.client.companyIndustry.groupBy({ by: ['industryId'], where: { company: this.companyWhere(ctx) }, _count: { _all: true } }),
      this.prisma.client.trainingRequest.findMany({ where: this.requestWhere(ctx), select: { count: true, directionId: true } }),
      this.prisma.client.trainingOffer.findMany({ where: { status: { in: ['PENDING', 'ACCEPTED'] }, request: this.requestWhere(ctx), institution: ctx.inst }, select: { count: true, status: true, request: { select: { directionId: true } } } }),
    ])
    const companiesBy = new Map(companies.map((c) => [c.industryId, c._count._all]))
    const requested = new Map<string, number>()
    for (const r of requests) add(requested, this.industryOf(ctx, r.directionId), r.count)
    const offered = new Map<string, number>()
    const promised = new Map<string, number>()
    for (const o of offers) {
      const ind = this.industryOf(ctx, o.request.directionId)
      add(offered, ind, o.count)
      if (o.status === 'ACCEPTED') add(promised, ind, o.count)
    }
    const rows = ctx.industries.map((i) => ({
      industry: i.name, students: students.students.get(i.id) ?? 0, graduates: graduates.get(i.id) ?? 0, companies: companiesBy.get(i.id) ?? 0,
      requested: requested.get(i.id) ?? 0, offered: offered.get(i.id) ?? 0, promised: promised.get(i.id) ?? 0,
      gap: (requested.get(i.id) ?? 0) - (promised.get(i.id) ?? 0),
    }))
    return {
      key: 'demand_supply', title: T('Sohalar böyiça talab va taklif', 'Спрос и предложение по отраслям', 'Demand and supply by industry'),
      columns: [
        COLS.industry, COLS.students, col('graduates', T('Bitiruvçilar (e’lonlar)', 'Выпуск (объявления)', 'Graduates (announcements)')),
        col('companies', T('Kompaniyalar', 'Компаний', 'Companies')), col('requested', T('Kompaniyalar söradi, kişi', 'Запросили компании, чел.', 'Requested, people')),
        col('offered', T('Muassasalar taklif qildi, kişi', 'Предложили учреждения, чел.', 'Offered, people')),
        col('promised', T('Kelişildi, kişi', 'Договорились, чел.', 'Agreed, people')), col('gap', T('Yetişmaydi, kişi', 'Не хватает, чел.', 'Shortfall, people')),
      ],
      rows,
    }
  }

  /** ТЗ 7.3 «Охват»: how much of the official list has registered and been approved. */
  private async coverage(ctx: Ctx): Promise<StatsTableDto> {
    const base = this.instFilters(ctx)
    const count = (where: Prisma.InstitutionWhereInput) => this.prisma.client.institution.count({ where: { ...base, mergedIntoId: null, ...where } })
    const [inList, registered, pending, approved, rejected, approvedSelf] = await Promise.all([
      count({ source: 'IMPORT' }), count({ source: 'IMPORT', status: { not: 'UNCLAIMED' } }), count({ source: { not: 'STUDENT' }, status: 'PENDING' }),
      count({ source: { not: 'STUDENT' }, approvedAt: { not: null }, blockedAt: null }), count({ source: { not: 'STUDENT' }, status: 'REJECTED' }), count({ source: 'SELF', approvedAt: { not: null }, blockedAt: null }),
    ])
    return {
      key: 'coverage', title: T('Qamrov', 'Охват реестра', 'Registry coverage'),
      columns: [
        col('inList', T('Rasmiy röyxatda', 'В официальном списке', 'In the official list')), col('registered', T('Ulardan röyxatdan ötgan', 'Из них зарегистрировались', 'Of them registered')),
        col('coverage', T('Qamrov, %', 'Охват, %', 'Coverage, %')), col('approved', T('Tasdiqlangan', 'Одобрено', 'Approved')),
        col('approvedNotInList', T('Shu jumladan röyxatda yöq', 'В т. ч. не из списка', 'Of them not in the list')),
        col('pending', T('Tekşiruvda', 'На проверке', 'Under review')), col('rejected', T('Rad etilgan', 'Отклонено', 'Rejected')),
      ],
      rows: [{ inList, registered, coverage: pct(registered, inList), approved, approvedNotInList: approvedSelf, pending, rejected }],
    }
  }

  private async byRegion(ctx: Ctx): Promise<StatsTableDto> {
    const base = this.instFilters(ctx)
    const [listed, registered, official, students] = await Promise.all([
      this.prisma.client.institution.groupBy({ by: ['regionId'], where: { ...base, mergedIntoId: null, source: 'IMPORT' }, _count: { _all: true } }),
      this.prisma.client.institution.groupBy({ by: ['regionId'], where: { ...base, mergedIntoId: null, source: 'IMPORT', status: { not: 'UNCLAIMED' } }, _count: { _all: true } }),
      this.prisma.client.institution.groupBy({ by: ['regionId'], where: ctx.inst, _count: { _all: true } }),
      this.prisma.client.institutionDirection.findMany({ where: { institution: ctx.inst }, select: { studentsCount: true, institution: { select: { regionId: true } } } }),
    ])
    const by = (rows: { regionId: string | null; _count: { _all: number } }[]) => new Map(rows.map((r) => [r.regionId ?? '', r._count._all]))
    const [l, r, o] = [by(listed), by(registered), by(official)]
    const s = new Map<string, number>()
    for (const d of students) add(s, d.institution.regionId ?? '', d.studentsCount)
    const rows = [...ctx.regions.entries()].filter(([id]) => !ctx.f.regionDbId || id === ctx.f.regionDbId).map(([id, name]) => ({
      region: name, inList: l.get(id) ?? 0, registered: r.get(id) ?? 0, coverage: pct(r.get(id) ?? 0, l.get(id) ?? 0), institutions: o.get(id) ?? 0, students: s.get(id) ?? 0,
    }))
    return {
      key: 'institutions_by_region', title: T('Hududlar böyiça muassasalar', 'Учреждения по регионам', 'Institutions by region'),
      columns: [COLS.region, col('inList', T('Rasmiy röyxatda', 'В официальном списке', 'In the official list')), col('registered', T('Röyxatdan ötgan', 'Зарегистрировались', 'Registered')), col('coverage', T('Qamrov, %', 'Охват, %', 'Coverage, %')), col('institutions', T('Tasdiqlangan', 'Одобрено', 'Approved')), COLS.students],
      rows,
    }
  }

  private async byType(ctx: Ctx): Promise<StatsTableDto> {
    const [groups, students] = await Promise.all([
      this.prisma.client.institution.groupBy({ by: ['type', 'ownership'], where: ctx.inst, _count: { _all: true } }),
      this.prisma.client.institutionDirection.findMany({ where: { institution: ctx.inst }, select: { studentsCount: true, institution: { select: { type: true } } } }),
    ])
    const s = new Map<string, number>()
    for (const d of students) add(s, d.institution.type, d.studentsCount)
    const rows = Object.keys(TYPE_NAMES).map((type) => {
      const of = (own: string | null) => groups.filter((g) => g.type === type && (own === null || g.ownership === own)).reduce((n, g) => n + g._count._all, 0)
      return { type: TYPE_NAMES[type], institutions: of(null), state: of('STATE'), private: of('PRIVATE'), students: s.get(type) ?? 0 }
    }).filter((r) => r.institutions > 0 || !ctx.f.type)
    return {
      key: 'institutions_by_type', title: T('Turlar va mulkçilik şakli böyiça', 'По типам и формам собственности', 'By type and ownership'),
      columns: [COLS.type, col('institutions', T('Tasdiqlangan', 'Одобрено', 'Approved')), col('state', T('Davlat', 'Государственные', 'State')), col('private', T('Xususiy', 'Частные', 'Private')), COLS.students],
      rows,
    }
  }

  /** ТЗ 7.3 «Студенты по данным учреждений»: by industry and by direction of the approved institutions. */
  private async studentsByIndustry(ctx: Ctx): Promise<StatsTableDto> {
    const { students, institutions, directions } = await this.studentsPerIndustry(ctx)
    const rows = ctx.industries.map((i) => ({ industry: i.name, institutions: institutions.get(i.id)?.size ?? 0, directions: directions.get(i.id)?.size ?? 0, students: students.get(i.id) ?? 0 }))
    return {
      key: 'students_by_industry', title: T('Sohalar böyiça talabalar (muassasalar ma’lumoti)', 'Студенты по отраслям (данные учреждений)', 'Students by industry (institutions’ data)'),
      columns: [COLS.industry, COLS.institutions, col('directions', T('Yönalişlar', 'Направлений', 'Directions')), COLS.students],
      rows,
    }
  }

  private async graduatesByYear(ctx: Ctx): Promise<StatsTableDto> {
    const lines = await this.prisma.client.announcementLine.findMany({ where: { announcement: this.announcementWhere(ctx) }, select: { count: true, directionId: true, announcement: { select: { year: true } } } })
    const by = new Map<string, number>()
    for (const l of lines) add(by, `${l.announcement.year}|${this.industryOf(ctx, l.directionId)}`, l.count)
    const order = new Map(ctx.industries.map((i) => [i.id, i]))
    const rows = [...by.entries()]
      .map(([k, graduates]) => { const [year, ind] = k.split('|'); return { year: Number(year), ind, graduates } })
      .sort((a, b) => a.year - b.year || (order.get(a.ind)?.sortOrder ?? 99) - (order.get(b.ind)?.sortOrder ?? 99))
      .map((r) => ({ year: r.year, industry: order.get(r.ind)?.name ?? DASH, graduates: r.graduates }))
    return {
      key: 'graduates_by_year', title: T('Yillar va sohalar böyiça bitiruv', 'Выпуск по годам и отраслям', 'Graduates by year and industry'),
      columns: [COLS.year, COLS.industry, col('graduates', T('Bitiruvçilar', 'Выпускников', 'Graduates'))],
      rows,
    }
  }

  /** ТЗ 7.3 «Спрос компаний» by region: approved companies, their requests and the people asked for. */
  private async companiesByRegion(ctx: Ctx): Promise<StatsTableDto> {
    const [companies, requests, responses] = await Promise.all([
      this.prisma.client.company.groupBy({ by: ['regionId'], where: this.companyWhere(ctx), _count: { _all: true } }),
      this.prisma.client.trainingRequest.findMany({ where: this.requestWhere(ctx), select: { count: true, company: { select: { regionId: true } } } }),
      this.prisma.client.announcementResponse.findMany({ where: { company: this.companyWhere(ctx), status: { not: 'WITHDRAWN' } }, select: { company: { select: { regionId: true } } } }),
    ])
    const c = new Map(companies.map((g) => [g.regionId ?? '', g._count._all]))
    const reqN = new Map<string, number>()
    const reqP = new Map<string, number>()
    for (const r of requests) { add(reqN, r.company.regionId ?? '', 1); add(reqP, r.company.regionId ?? '', r.count) }
    const resp = new Map<string, number>()
    for (const r of responses) add(resp, r.company.regionId ?? '', 1)
    const rows = [...ctx.regions.entries()].filter(([id]) => !ctx.f.regionDbId || id === ctx.f.regionDbId).map(([id, name]) => ({
      region: name, companies: c.get(id) ?? 0, requests: reqN.get(id) ?? 0, requested: reqP.get(id) ?? 0, responses: resp.get(id) ?? 0,
    }))
    return {
      key: 'companies_by_region', title: T('Hududlar böyiça kompaniyalar talabi', 'Спрос компаний по регионам', 'Company demand by region'),
      columns: [COLS.region, col('companies', T('Kompaniyalar', 'Компаний', 'Companies')), col('requests', T('Arizalar', 'Заявок «под обучение»', 'Training requests')), col('requested', T('Söralgan, kişi', 'Запрошено, чел.', 'Requested, people')), col('responses', T('Bitiruvga javoblar', 'Откликов на выпуск', 'Responses to graduations'))],
      rows,
    }
  }

  /** ТЗ 7.3 «Студенты в ILMORA»: registered students by type of institution, studying or applying. */
  private async ilmoraStudents(ctx: Ctx): Promise<StatsTableDto> {
    const groups = await this.prisma.client.studentProfile.groupBy({ by: ['institutionType', 'mode'], where: this.studentWhere(ctx), _count: { _all: true } })
    const rows = Object.keys(TYPE_NAMES).map((type) => {
      const of = (mode: string) => groups.find((g) => g.institutionType === type && g.mode === mode)?._count._all ?? 0
      return { type: TYPE_NAMES[type], studying: of('STUDYING'), applying: of('APPLYING'), total: of('STUDYING') + of('APPLYING') }
    }).filter((r) => r.total > 0)
    const none = groups.filter((g) => !g.institutionType).reduce((n, g) => n + g._count._all, 0)
    if (none) rows.push({ type: T('Körsatilmagan', 'Не указан', 'Not given'), studying: 0, applying: none, total: none })
    return protectPeople({
      key: 'ilmora_students', title: T('ILMORAdagi talabalar', 'Студенты в ILMORA', 'Students in ILMORA'),
      columns: [COLS.type, col('studying', T('Öqiydi', 'Учатся', 'Studying')), col('applying', T('Kirmoqçi', 'Поступают', 'Applying')), col('total', T('Jami', 'Всего', 'Total'))],
      rows,
    }, ['studying', 'applying', 'total'])
  }

  /**
   * ТЗ 7.3 «Абитуриенты»: who wants to enrol, by industry and year. Counted in the database by year and direction (a
   * few hundred groups whatever the number of students), then folded into industries here.
   */
  private async applicants(ctx: Ctx): Promise<StatsTableDto> {
    const groups = await this.prisma.client.studentProfile.groupBy({
      by: ['enrollYear', 'directionId'],
      where: { ...this.studentWhere(ctx), mode: 'APPLYING', ...(ctx.f.year ? { enrollYear: ctx.f.year } : {}) },
      _count: { _all: true },
    })
    const by = new Map<string, number>()
    for (const g of groups) add(by, `${g.enrollYear ?? ''}|${g.directionId ? this.industryOf(ctx, g.directionId) : ''}`, g._count._all)
    const order = new Map(ctx.industries.map((i) => [i.id, i]))
    const rows = [...by.entries()]
      .map(([k, applicants]) => { const [year, ind] = k.split('|'); return { year: year ? Number(year) : null, industry: order.get(ind)?.name ?? DASH, applicants, sort: order.get(ind)?.sortOrder ?? 99 } })
      .sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || a.sort - b.sort)
      .map(({ sort: _sort, ...r }) => r)
    return protectPeople({
      key: 'applicants', title: T('Abituriyentlar', 'Абитуриенты', 'Applicants'),
      columns: [col('year', T('Kiriş yili', 'Год поступления', 'Enrolment year')), COLS.industry, col('applicants', T('Abituriyentlar', 'Абитуриентов', 'Applicants'))],
      rows,
    }, ['applicants'])
  }

  private async contractHelp(ctx: Ctx): Promise<StatsTableDto> {
    const groups = await this.prisma.client.contractHelpRequest.groupBy({ by: ['status'], where: { user: { studentProfile: { is: this.studentWhere(ctx) } } }, _count: { _all: true } })
    const of = (s: string) => groups.find((g) => g.status === s)?._count._all ?? 0
    return protectPeople({
      key: 'contract_help', title: T('Kontrakt tölovida yordam', 'Помощь с оплатой контракта', 'Help with the tuition contract'),
      columns: [col('total', T('Arizalar', 'Заявок', 'Requests')), col('active', T('Faol', 'Активных', 'Active')), col('interested', T('Kompaniyalar qiziqqan', 'С интересом компаний', 'With company interest')), col('signed', T('Şartnoma tuzilgan', 'Договор заключён', 'Contract signed')), col('withdrawn', T('Qaytarib olingan', 'Отозвано', 'Withdrawn'))],
      rows: [{ total: groups.reduce((n, g) => n + g._count._all, 0), active: of('ACTIVE'), interested: of('INTERESTED'), signed: of('SIGNED'), withdrawn: of('WITHDRAWN') }],
    }, ['total', 'active', 'interested', 'signed', 'withdrawn'])
  }

  private async vacancies(ctx: Ctx): Promise<StatsTableDto> {
    const where: Prisma.VacancyWhereInput = { company: this.companyWhere(ctx), ...(ctx.f.regionDbId ? { regionId: ctx.f.regionDbId } : {}) }
    const [vac, apps] = await Promise.all([
      this.prisma.client.vacancy.findMany({ where, select: { kind: true, status: true, seats: true } }),
      this.prisma.client.vacancyApplication.findMany({ where: { vacancy: where }, select: { status: true, vacancy: { select: { kind: true } } } }),
    ])
    const KIND_NAMES = { PRACTICE: T('Amaliyot', 'Практика', 'Practice'), INTERNSHIP: T('Stajirovka', 'Стажировка', 'Internship'), JOB: T('Iş', 'Работа', 'Job') }
    const rows = (['PRACTICE', 'INTERNSHIP', 'JOB'] as const).map((kind) => ({
      kind: KIND_NAMES[kind],
      vacancies: vac.filter((v) => v.kind === kind).length, open: vac.filter((v) => v.kind === kind && v.status === 'OPEN').length,
      seats: vac.filter((v) => v.kind === kind).reduce((n, v) => n + v.seats, 0),
      applications: apps.filter((a) => a.vacancy.kind === kind).length, invited: apps.filter((a) => a.vacancy.kind === kind && a.status === 'INVITED').length,
    }))
    // Vacancies and seats are the companies' figures; applications and invitations are students.
    return protectPeople({
      key: 'vacancies', title: T('Vakansiyalar', 'Вакансии', 'Vacancies'),
      columns: [col('kind', T('Turi', 'Вид', 'Kind'), false), col('vacancies', T('Vakansiyalar', 'Вакансий', 'Vacancies')), col('open', T('Oçiq', 'Открытых', 'Open')), col('seats', T('Örinlar', 'Мест', 'Seats')), col('applications', T('Arizalar', 'Откликов', 'Applications')), col('invited', T('Taklif qilingan', 'Приглашено', 'Invited'))],
      rows,
    }, ['applications', 'invited'])
  }

  /** ТЗ 7: records students added — shown apart, never in the official figures. */
  private async studentAdded(ctx: Ctx): Promise<StatsTableDto> {
    const base = this.instFilters(ctx)
    const groups = await this.prisma.client.institution.groupBy({ by: ['regionId', 'type'], where: { ...base, mergedIntoId: null, source: 'STUDENT' }, _count: { _all: true } })
    const rows = groups.map((g) => ({ region: ctx.regions.get(g.regionId ?? '') ?? DASH, type: TYPE_NAMES[g.type] ?? DASH, institutions: g._count._all })).sort((a, b) => a.region.ru.localeCompare(b.region.ru))
    return {
      key: 'student_added', title: T('Talabalar qöşgan muassasalar (rasmiy raqamlarga kirmaydi)', 'Добавлены студентами (не в официальных цифрах)', 'Added by students (not in the official figures)'),
      columns: [COLS.region, COLS.type, COLS.institutions],
      rows,
    }
  }

  // ───────────── shared reads ─────────────

  private async context(filters: MinistryStatsFilters): Promise<Ctx> {
    let regionDbId: string | undefined
    if (filters.regionId) {
      const found = await regionIdByRef(this.prisma, filters.regionId)
      if (!found) throw AppError.invalid('invalid_region', 'Choose a region from the list')
      regionDbId = found
    }
    const f = { ...filters, regionDbId }
    const [regions, industries, directions] = await Promise.all([
      this.prisma.client.region.findMany({ orderBy: { sortOrder: 'asc' }, select: { id: true, name: true } }),
      this.prisma.client.industry.findMany({ orderBy: { sortOrder: 'asc' }, select: { id: true, name: true, sortOrder: true } }),
      this.prisma.client.direction.findMany({ select: { id: true, industryId: true, mergedInto: { select: { industryId: true } } } }),
    ])
    const base: Prisma.InstitutionWhereInput = {
      ...(regionDbId ? { regionId: regionDbId } : {}), ...(filters.type ? { type: filters.type } : {}), ...(filters.ownership ? { ownership: filters.ownership } : {}),
    }
    return {
      f,
      inst: { ...OFFICIAL, ...base },
      regions: new Map(regions.map((r) => [r.id, r.name as L])),
      industries: industries.map((i) => ({ id: i.id, name: i.name as L, sortOrder: i.sortOrder })),
      industryOfDirection: new Map(directions.map((d) => [d.id, d.mergedInto?.industryId ?? d.industryId])),
    }
  }

  private instFilters(ctx: Ctx): Prisma.InstitutionWhereInput {
    const { f } = ctx
    return { ...(f.regionDbId ? { regionId: f.regionDbId } : {}), ...(f.type ? { type: f.type } : {}), ...(f.ownership ? { ownership: f.ownership } : {}) }
  }

  private industryOf(ctx: Ctx, directionId: string): string {
    return ctx.industryOfDirection.get(directionId) ?? ''
  }

  private async studentsPerIndustry(ctx: Ctx) {
    const rows = await this.prisma.client.institutionDirection.findMany({ where: { institution: ctx.inst }, select: { institutionId: true, directionId: true, studentsCount: true } })
    const students = new Map<string, number>()
    const institutions = new Map<string, Set<string>>()
    const directions = new Map<string, Set<string>>()
    for (const r of rows) {
      const ind = this.industryOf(ctx, r.directionId)
      add(students, ind, r.studentsCount)
      if (!institutions.has(ind)) institutions.set(ind, new Set())
      institutions.get(ind)!.add(r.institutionId)
      if (!directions.has(ind)) directions.set(ind, new Set())
      directions.get(ind)!.add(r.directionId)
    }
    return { students, institutions, directions }
  }

  private async graduatesPerIndustry(ctx: Ctx) {
    const lines = await this.prisma.client.announcementLine.findMany({ where: { announcement: this.announcementWhere(ctx) }, select: { count: true, directionId: true } })
    const by = new Map<string, number>()
    for (const l of lines) add(by, this.industryOf(ctx, l.directionId), l.count)
    return by
  }

  /** Reached from AnnouncementLine (no tenantId): the tenant is stated here, as in companyWhere. */
  private announcementWhere(ctx: Ctx): Prisma.GraduationAnnouncementWhereInput {
    return { tenantId: TenantContext.requireTenantId(), status: { in: ['PUBLISHED', 'CLOSED'] }, institution: ctx.inst, ...(ctx.f.year ? { year: ctx.f.year } : {}) }
  }

  /**
   * Also used as a relation filter from rows without tenantId (CompanyIndustry): the tenant is stated here, the
   * automatic scope covers only top-level queries of tenant models.
   */
  private companyWhere(ctx: Ctx): Prisma.CompanyWhereInput {
    return { tenantId: TenantContext.requireTenantId(), approvedAt: { not: null }, blockedAt: null, ...(ctx.f.regionDbId ? { regionId: ctx.f.regionDbId } : {}) }
  }

  private requestWhere(ctx: Ctx): Prisma.TrainingRequestWhereInput {
    return { company: { approvedAt: { not: null }, blockedAt: null }, ...(ctx.f.regionDbId ? { OR: [{ regionId: ctx.f.regionDbId }, { regionId: null, company: { regionId: ctx.f.regionDbId } }] } : {}), ...(ctx.f.year ? { byYear: ctx.f.year } : {}) }
  }

  /**
   * Students of ILMORA: living accounts only — a deleted or disabled account is nobody's student any more (re-check 11.11
   * №111). The relation filter is not covered by the soft-delete scope of top-level queries, so it is stated here.
   */
  private studentWhere(ctx: Ctx): Prisma.StudentProfileWhereInput {
    return { user: { deletedAt: null, isActive: true }, ...(ctx.f.regionDbId ? { regionId: ctx.f.regionDbId } : {}), ...(ctx.f.type ? { institutionType: ctx.f.type } : {}) }
  }

}
