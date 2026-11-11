import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InstitutionPassportDto } from '@ilmora/shared'

const calls: { path: string; method?: string; body?: unknown }[] = []
vi.mock('../lib/api', () => ({
  api: vi.fn(async (path: string, opts: { method?: string; body?: unknown } = {}) => {
    calls.push({ path, method: opts.method, body: opts.body })
    return {}
  }),
}))

const {
  announcementLines, announcementYears, directionProblems, directionRows, directionsBody, institutionApi, MISSING_FIELD, offerYears, passportForm,
  passportPatch, reviewedChanged,
} = await import('./institutionCabinet')

const industry = { id: 'it', slug: 'it', name: { uz: 'IT', ru: 'IT', en: 'IT' } }
const passport: InstitutionPassportDto = {
  id: 'i1', type: 'TECHNIKUM', ownership: 'STATE', name: 'Andijon texnikumi', nameRu: null, formerName: null, stir: '200237474',
  region: { id: 'r-and', name: { uz: 'Andijon', ru: 'Андижан', en: 'Andijan' }, slug: 'andijan' }, district: { id: 'd1', name: { uz: 'A', ru: 'А', en: 'A' } },
  districtName: null, address: 'Navoiy 1', phone: '+998901234567', email: null, website: null, directorName: 'Karimov', status: 'DRAFT', rejectReason: null,
  submittedAt: null, approvedAt: null, workspaceOpen: false, editable: true,
  directions: [{ id: 'x1', direction: { id: 'dir1', name: 'Dasturlash', industry, official: true, code: null } as never, department: null, studentsCount: 120 }],
  totals: { students: 120, directions: 1 }, representative: { name: 'Vakil', jobTitle: 'Direktor örinbosari' }, pendingChanges: null, blocked: null,
}

describe('the institution passport form', () => {
  const before = passportForm(passport)

  it('sends only what changed; an emptied field is cleared', () => {
    expect(passportPatch(before, before)).toEqual({})
    expect(passportPatch({ ...before, address: '  Navoiy 2 ', phone: '' }, before)).toEqual({ address: 'Navoiy 2', phone: null })
    expect(passportPatch({ ...before, email: 'info@texnikum.uz', website: 'https://texnikum.uz' }, before)).toEqual({ email: 'info@texnikum.uz', website: 'https://texnikum.uz' })
  })

  it('a new region without a district leaves the district to the API (it clears the old one)', () => {
    expect(passportPatch({ ...before, regionId: 'r-fer', districtId: '' }, before)).toEqual({ regionId: 'r-fer' })
    expect(passportPatch({ ...before, regionId: 'r-fer', districtId: 'd9' }, before)).toEqual({ regionId: 'r-fer', districtId: 'd9' })
    expect(passportPatch({ ...before, districtId: 'd2' }, before)).toEqual({ districtId: 'd2' })
  })

  it('the representative goes as a whole; a reviewed field is recognised', () => {
    expect(passportPatch({ ...before, repJobTitle: 'Direktor' }, before)).toEqual({ representative: { name: 'Vakil', jobTitle: 'Direktor' } })
    expect(reviewedChanged(passportPatch({ ...before, name: 'Yangi nom' }, before))).toBe(true)
    expect(reviewedChanged(passportPatch({ ...before, address: 'X' }, before))).toBe(false)
  })

  it('directions: the whole list, with checks the API would make', () => {
    const rows = directionRows(passport)
    expect(rows).toEqual([{ directionId: 'dir1', name: 'Dasturlash', industryId: 'it', department: '', studentsCount: '120' }])
    expect(directionsBody([...rows, { directionId: 'dir2', name: 'B', department: ' Kunduzgi ', studentsCount: '30' }])).toEqual({
      directions: [{ directionId: 'dir1', department: null, studentsCount: 120 }, { directionId: 'dir2', department: 'Kunduzgi', studentsCount: 30 }],
    })
    expect(directionProblems([...rows, { directionId: '', name: '', department: '', studentsCount: '5' }, { directionId: 'dir1', name: '', department: '', studentsCount: '5' }, { directionId: 'dir3', name: '', department: '', studentsCount: '0' }]))
      .toEqual({ 1: 'direction', 2: 'twice', 3: 'count' })
  })

  it('every required field the API can name has a place in the form', () => {
    expect(Object.keys(MISSING_FIELD)).toHaveLength(12)
  })
})

describe('institution workspace calls', () => {
  beforeEach(() => { calls.length = 0 })

  it('use their own addresses', async () => {
    await institutionApi.update({ address: 'X' })
    await institutionApi.submit()
    await institutionApi.districts('andijan')
    await institutionApi.students('PENDING')
    await institutionApi.confirm('s1')
    await institutionApi.reject('s1')
    await institutionApi.incoming('it')
    await institutionApi.offer('r1', { count: 20, byYear: 2027, comment: '  ' })
    await institutionApi.withdraw('o1')
    await institutionApi.createAnnouncement(2027, [{ directionId: 'dir1', count: 40 }])
    await institutionApi.exclude('a1', 's2')
    await institutionApi.include('a1', 's2')
    await institutionApi.acceptResponse('resp1')
    expect(calls.map((c) => `${c.method ?? 'GET'} ${c.path}`)).toEqual([
      'PATCH /institutions/me', 'POST /institutions/me/submit', 'GET /registry/districts?regionId=andijan', 'GET /institutions/me/students?status=PENDING',
      'POST /institutions/me/students/s1/confirm', 'POST /institutions/me/students/s1/reject', 'GET /training-requests?industryId=it',
      'POST /training-requests/r1/offers', 'POST /institutions/me/offers/o1/withdraw', 'POST /institutions/me/announcements',
      'POST /institutions/me/announcements/a1/exclusions', 'DELETE /institutions/me/announcements/a1/exclusions/s2', 'POST /institutions/me/announcement-responses/resp1/accept',
    ])
    expect(calls[7].body).toEqual({ count: 20, byYear: 2027, comment: null })
  })

  it('years: an offer this year to 10 ahead, an announcement last year to 6 ahead; empty lines are not sent', () => {
    const now = new Date('2026-11-11')
    expect(offerYears(now)[0]).toBe(2026)
    expect(offerYears(now).at(-1)).toBe(2036)
    expect(announcementYears(now)).toEqual([2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032])
    expect(announcementLines([{ directionId: 'd1', count: '40' }, { directionId: '', count: '5' }, { directionId: 'd2', count: '0' }])).toEqual([{ directionId: 'd1', count: 40 }])
  })
})
