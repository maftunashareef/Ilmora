import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: { path: string; method?: string; body?: unknown }[] = []
vi.mock('../lib/api', () => ({
  api: vi.fn(async (path: string, opts: { method?: string; body?: unknown } = {}) => {
    calls.push({ path, method: opts.method, body: opts.body })
    return {}
  }),
}))

const { nameDiffers, reasonOk, reviews, searchQuery } = await import('./reviews')

describe('Super Admin review of institutions and companies', () => {
  beforeEach(() => { calls.length = 0 })

  it('unlinking the representative sends the reason, trimmed', async () => {
    await reviews.institutions.release('i1', '  Haqiqiy rahbar murojaat qildi  ')
    await reviews.companies.release('c1', 'Not their company')
    expect(calls).toEqual([
      { path: '/admin/institutions/i1/release', method: 'POST', body: { reason: 'Haqiqiy rahbar murojaat qildi' } },
      { path: '/admin/companies/c1/release', method: 'POST', body: { reason: 'Not their company' } },
    ])
  })

  it('queue, card, approve, reject and the certificate link use their own addresses', async () => {
    await reviews.institutions.queue()
    await reviews.institutions.detail('i1')
    await reviews.institutions.approve('i1')
    await reviews.institutions.reject('i1', 'STIR does not match')
    await reviews.companies.queue()
    await reviews.companies.certificate('c1')
    expect(calls.map((c) => `${c.method ?? 'GET'} ${c.path}`)).toEqual([
      'GET /admin/institutions/reviews', 'GET /admin/institutions/i1', 'POST /admin/institutions/i1/approve', 'POST /admin/institutions/i1/reject',
      'GET /admin/companies/reviews', 'GET /admin/companies/c1/certificate',
    ])
  })

  it('a reason is 5–1000 characters without < or > (as the API checks)', () => {
    expect(reasonOk('abcd')).toBe(false)
    expect(reasonOk('  abcde  ')).toBe(true)
    expect(reasonOk('x'.repeat(1001))).toBe(false)
    expect(reasonOk('see <b>this</b>')).toBe(false)
  })

  it('the official name is flagged only when it really differs from the entered one', () => {
    expect(nameDiffers('Toshkent axborot texnikumi', null)).toBe(false)
    expect(nameDiffers('Toshkent  axborot TEXNIKUMI ', 'Toshkent axborot texnikumi')).toBe(false)
    expect(nameDiffers('ITech Akademiya', 'Toshkent axborot texnikumi')).toBe(true)
  })

  it('«Все записи»: 9 digits are a STIR (exact), anything else a name; status and page as given', async () => {
    expect(searchQuery({ text: '', status: '', page: 1 })).toBe('')
    expect(searchQuery({ text: ' 301 234 567 ', status: '', page: 1 })).toBe('?stir=301234567')
    expect(searchQuery({ text: 'Toshkent texnikumi', status: 'APPROVED', page: 2 })).toBe('?q=Toshkent+texnikumi&status=APPROVED&page=2')
    expect(searchQuery({ text: '30123', status: 'DRAFT', page: 1 })).toBe('?q=30123&status=DRAFT')
    await reviews.institutions.search({ text: '301234567', status: '', page: 1 })
    await reviews.companies.search({ text: 'Ilm', status: 'PENDING', page: 1 })
    expect(calls.map((c) => c.path)).toEqual(['/admin/institutions?stir=301234567', '/admin/companies?q=Ilm&status=PENDING'])
  })
})
