import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompanyProfileDto } from '@ilmora/shared'

const calls: { path: string; method?: string; body?: unknown }[] = []
vi.mock('../lib/api', () => ({
  api: vi.fn(async (path: string, opts: { method?: string; body?: unknown } = {}) => {
    calls.push({ path, method: opts.method, body: opts.body })
    return {}
  }),
}))

const { certificateProblem, companyApi, companyForm, companyPatch, companyReviewedChanged, emptyVacancy, tashkentToday, vacancyBody, vacancyProblems } = await import('./companyCabinet')

const it_ = { id: 'it', slug: 'it', name: { uz: 'IT', ru: 'IT', en: 'IT' } }
const profile: CompanyProfileDto = {
  id: 'c1', stir: '301234567', name: 'Kompaniya', region: { id: 'r1', name: { uz: 'A', ru: 'А', en: 'A' }, slug: 'andijan' }, district: null, address: 'Navoiy 1',
  website: null, about: null, industries: [it_], directions: [], certificateUploaded: false, status: 'DRAFT', rejectReason: null, submittedAt: null, approvedAt: null,
  workspaceOpen: false, editable: true, representative: { name: 'Aziz', jobTitle: 'HR', email: null }, pendingChanges: null, blocked: null,
}

describe('the company profile form', () => {
  const before = companyForm(profile)
  it('sends only what changed; lists go whole; the representative together', () => {
    expect(companyPatch(before, before)).toEqual({})
    expect(companyPatch({ ...before, about: '  Biz IT kompaniya ', website: '' }, before)).toEqual({ about: 'Biz IT kompaniya' })
    expect(companyPatch({ ...before, industryIds: ['it', 'edu'] }, before)).toEqual({ industryIds: ['it', 'edu'] })
    expect(companyPatch({ ...before, directions: [{ id: 'd1', name: 'Dasturlash' }] }, before)).toEqual({ directionIds: ['d1'] })
    expect(companyPatch({ ...before, repEmail: 'hr@kompaniya.uz' }, before)).toEqual({ representative: { name: 'Aziz', jobTitle: 'HR', email: 'hr@kompaniya.uz' } })
    expect(companyPatch({ ...before, regionId: 'r2' }, before)).toEqual({ regionId: 'r2' })
  })
  it('the name, STIR and industries go to review after approval', () => {
    expect(companyReviewedChanged(companyPatch({ ...before, name: 'Yangi' }, before))).toBe(true)
    expect(companyReviewedChanged(companyPatch({ ...before, industryIds: [] }, before))).toBe(true)
    expect(companyReviewedChanged(companyPatch({ ...before, about: 'x' }, before))).toBe(false)
  })
  it('the certificate: PDF, JPG or PNG up to 10 MB', () => {
    expect(certificateProblem({ type: 'application/pdf', size: 1000 })).toBeNull()
    expect(certificateProblem({ type: 'image/gif', size: 1000 })).toBe('type')
    expect(certificateProblem({ type: 'image/png', size: 11 * 1024 * 1024 })).toBe('size')
  })
})

describe('vacancies', () => {
  it('a stipend only when paid; empty texts are null', () => {
    const f = { ...emptyVacancy(), title: ' Amaliyot ', directions: [{ id: 'd1', name: 'X' }], region: 'tashkent-city', stipend: '2000000', seats: '3' }
    expect(vacancyBody(f)).toMatchObject({ title: 'Amaliyot', directionIds: ['d1'], paid: false, stipend: null, seats: 3, address: null, deadline: null })
    expect(vacancyBody({ ...f, paid: true }).stipend).toBe(2000000)
  })
  it('checks what the API would refuse', () => {
    expect(vacancyProblems(emptyVacancy(), '2026-11-11')).toEqual(['title', 'directions', 'region'])
    expect(vacancyProblems({ ...emptyVacancy(), title: 'Ok', directions: [{ id: 'd', name: 'd' }], region: 'r', seats: '0', deadline: '2026-11-10' }, '2026-11-11')).toEqual(['seats', 'deadline'])
  })
  it('today in Tashkent', () => {
    expect(tashkentToday(new Date('2026-11-11T20:30:00Z'))).toBe('2026-11-12')
  })
})

describe('company workspace calls', () => {
  beforeEach(() => { calls.length = 0 })
  it('use their own addresses', async () => {
    await companyApi.createRequest({ directionId: 'd1', count: 10, byYear: 2027, regionId: null, requirements: ' ' })
    await companyApi.closeRequest('r1')
    await companyApi.acceptOffer('o1')
    await companyApi.announcements(2027)
    await companyApi.respond('a1', [{ lineId: 'l1', wantedCount: 2 }], '')
    await companyApi.invite('card1', 'a1')
    await companyApi.setApplication('ap1', 'INVITED')
    await companyApi.contractHelp('andijan')
    await companyApi.interest('ch1')
    await companyApi.contact('k1')
    expect(calls.map((c) => `${c.method ?? 'GET'} ${c.path}`)).toEqual([
      'POST /companies/me/training-requests', 'POST /companies/me/training-requests/r1/close', 'POST /companies/me/offers/o1/accept', 'GET /announcements?year=2027',
      'POST /announcements/a1/responses', 'POST /graduates/card1/invite', 'POST /companies/me/vacancy-applications/ap1/status', 'GET /contract-help?region=andijan',
      'POST /contract-help/ch1/interest', 'GET /companies/me/contacts/k1',
    ])
    expect(calls[0].body).toEqual({ directionId: 'd1', count: 10, byYear: 2027, regionId: null, requirements: null })
    expect(calls[4].body).toEqual({ lines: [{ lineId: 'l1', wantedCount: 2 }], comment: null })
    expect(calls[5].body).toEqual({ announcementId: 'a1' })
  })
})

describe('«Работа» in the vacancy form (ТЗ «Студенты у компании», 5)', () => {
  const job = { ...emptyVacancy(), kind: 'JOB' as const, title: 'Duradgor', directions: [{ id: 'd1', name: 'Duradgorlik' }], region: 'kashkadarya', seats: '2' }
  it('asks for the schedule and the experience, and a salary «to» not below «from»', () => {
    expect(vacancyProblems(job, '2026-11-11')).toEqual(['schedule', 'experience'])
    const ok = { ...job, schedule: 'FULL_TIME' as const, experience: 'NONE' as const }
    expect(vacancyProblems(ok, '2026-11-11')).toEqual([])
    expect(vacancyProblems({ ...ok, salaryTo: '5000000' }, '2026-11-11')).toEqual(['salary'])
    expect(vacancyProblems({ ...ok, salaryFrom: '6000000', salaryTo: '5000000' }, '2026-11-11')).toEqual(['salary'])
  })
  it('is always paid, with a salary instead of a stipend; practice keeps no salary, schedule or experience', () => {
    const body = vacancyBody({ ...job, paid: false, stipend: '900000', salaryFrom: '4000000', salaryTo: '6000000', schedule: 'SHIFT', experience: 'UP_TO_1' })
    expect(body).toMatchObject({ kind: 'JOB', paid: true, stipend: null, salaryFrom: 4000000, salaryTo: 6000000, schedule: 'SHIFT', experience: 'UP_TO_1' })
    const practice = vacancyBody({ ...job, kind: 'PRACTICE', paid: true, stipend: '900000', salaryFrom: '4000000', schedule: 'SHIFT', experience: 'NONE' })
    expect(practice).toMatchObject({ kind: 'PRACTICE', paid: true, stipend: 900000, salaryFrom: null, salaryTo: null, schedule: null, experience: null })
  })
})

