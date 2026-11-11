import { beforeEach, describe, expect, it, vi } from 'vitest'

const calls: { path: string; method?: string; body?: unknown }[] = []
let answer: unknown = {}
vi.mock('../lib/api', () => ({
  api: vi.fn(async (path: string, opts: { method?: string; body?: unknown } = {}) => {
    calls.push({ path, method: opts.method, body: opts.body })
    return answer
  }),
}))

const { approveProblem, formatMinor, leftOf, myRefunds, noteOk, parseSom, providerRefOk, reasonTextProblem, refundBody, refundQueue } = await import('./refunds')

const form = { enrollmentIds: ['e1', 'e2'], allCourses: true, reason: 'REFUSAL' as const, reasonText: '', toOtherAccount: false }

describe('refund requests: the student', () => {
  beforeEach(() => { calls.length = 0; answer = {} })

  it('every course is sent as «all» (no list); a part — as the list, without repeats', () => {
    expect(refundBody(form)).toEqual({ reason: 'REFUSAL' })
    expect(refundBody({ ...form, allCourses: false, enrollmentIds: ['e2', 'e2'] })).toEqual({ enrollmentIds: ['e2'], reason: 'REFUSAL' })
    expect(refundBody({ ...form, reason: 'OTHER', reasonText: '  Köçib ketdim  ', toOtherAccount: true })).toEqual({ reason: 'OTHER', reasonText: 'Köçib ketdim', toOtherAccount: true })
  })

  it('«other» needs words; any reason at most 1000 characters', () => {
    expect(reasonTextProblem({ reason: 'OTHER', reasonText: '  ' })).toBe('required')
    expect(reasonTextProblem({ reason: 'REFUSAL', reasonText: '' })).toBeNull()
    expect(reasonTextProblem({ reason: 'REFUSAL', reasonText: 'x'.repeat(1001) })).toBe('tooLong')
  })

  it('quote, file, list and withdraw use their own addresses', async () => {
    await myRefunds.quote(form)
    await myRefunds.file(form)
    await myRefunds.list()
    await myRefunds.withdraw('r/1')
    expect(calls.map((c) => `${c.method ?? 'GET'} ${c.path}`)).toEqual([
      'POST /student/subscription/refunds/quote', 'POST /student/subscription/refunds', 'GET /student/subscription/refunds', 'POST /student/subscription/refunds/r%2F1/withdraw',
    ])
  })

  it('lists only the active courses of the subscription', async () => {
    answer = { subscription: { enrollments: [
      { id: 'e1', status: 'ACTIVE', courseId: 'c1', group: { id: 'g1' } },
      { id: 'e2', status: 'PENDING', courseId: 'c2', group: { id: 'g2' } },
    ] } }
    expect(await myRefunds.courses()).toEqual([{ enrollmentId: 'e1', courseId: 'c1', groupId: 'g1' }])
    answer = { subscription: null }
    expect(await myRefunds.courses()).toEqual([])
  })
})

describe('refund requests: the finance admin', () => {
  beforeEach(() => { calls.length = 0 })

  it('money: tiyin as so’m and back', () => {
    expect(formatMinor('7200000')).toBe('72 000')
    expect(formatMinor('4531250')).toBe('45 312,50')
    expect(formatMinor(null)).toBe('—')
    expect(parseSom('72 000')).toBe('7200000')
    expect(parseSom('45312,5')).toBe('4531250')
    expect(parseSom('45 312.50')).toBe('4531250')
    for (const bad of ['', 'abc', '1,234,5', '-5', '1.234']) expect(parseSom(bad), bad).toBeNull()
  })

  it('the approved amount is above zero and within what is left of the payment', () => {
    const payment = { amountMinor: '10000000', refundedMinor: '2500000' }
    expect(leftOf(payment)).toBe('7500000')
    expect(approveProblem('7500000', payment)).toBeNull()
    expect(approveProblem('7500001', payment)).toBe('tooMuch')
    expect(approveProblem('0', payment)).toBe('zero')
    expect(approveProblem(null, payment)).toBe('invalid')
  })

  it('a rejection note is 3–1000 characters; a transfer reference 3–200', () => {
    expect(noteOk('ok')).toBe(false)
    expect(noteOk(' yes ')).toBe(true)
    expect(providerRefOk('x'.repeat(201))).toBe(false)
    expect(providerRefOk('PP-123')).toBe(true)
  })

  it('queue filters, decisions and a request from a letter', async () => {
    await refundQueue.list({ status: 'PENDING', overdue: false, page: 1 })
    await refundQueue.list({ status: '', overdue: true, page: 2 })
    await refundQueue.approve('r1', '7200000', ' ')
    await refundQueue.approve('r1', '7200000', ' 4 lessons held ')
    await refundQueue.reject('r1', ' Payment not found ')
    await refundQueue.paid('r1', ' TR-55 ')
    await refundQueue.fromLetter('s1', { ...form, reason: 'GROUP_CLOSED' })
    expect(calls).toEqual([
      { path: '/admin/finance/refunds?pageSize=30&status=PENDING', method: undefined, body: undefined },
      { path: '/admin/finance/refunds?pageSize=30&overdue=true&page=2', method: undefined, body: undefined },
      { path: '/admin/finance/refunds/r1/approve', method: 'POST', body: { approvedMinor: '7200000' } },
      { path: '/admin/finance/refunds/r1/approve', method: 'POST', body: { approvedMinor: '7200000', note: '4 lessons held' } },
      { path: '/admin/finance/refunds/r1/reject', method: 'POST', body: { note: 'Payment not found' } },
      { path: '/admin/finance/refunds/r1/paid', method: 'POST', body: { providerRef: 'TR-55' } },
      { path: '/admin/finance/refunds', method: 'POST', body: { studentId: 's1', reason: 'GROUP_CLOSED' } },
    ])
  })
})
