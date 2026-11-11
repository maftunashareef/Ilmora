import { describe, expect, it, vi } from 'vitest'
import { CONTRACT_HELP_MOTIVATION_MAX, type StudentQuestionnaire } from '@ilmora/shared'
import { api } from '../lib/api'
import { contractHelpBody, contractHelpOpen, contractHelpProblems, defaultVacancyFilters, emptyContractHelp, studentApi, vacancyQuery } from './studentOpportunities'

vi.mock('../lib/api', async (importOriginal) => ({ ...(await importOriginal<typeof import('../lib/api')>()), api: vi.fn() }))
const apiMock = vi.mocked(api)

describe('help with the contract fee', () => {
  it('asks for the reason (10–1000 characters, no markup), the years and the consent — as the API does', () => {
    expect(contractHelpProblems(emptyContractHelp())).toEqual(['motivation', 'years', 'consent'])
    const ok = { motivation: 'Нужна помощь с оплатой второго курса', yearsToWork: '3', workRegion: 'OWN' as const, consent: true }
    expect(contractHelpProblems(ok)).toEqual([])
    expect(contractHelpProblems({ ...ok, motivation: 'коротко' })).toEqual(['motivation'])
    expect(contractHelpProblems({ ...ok, motivation: 'a'.repeat(CONTRACT_HELP_MOTIVATION_MAX + 1) })).toEqual(['motivation'])
    expect(contractHelpProblems({ ...ok, motivation: 'Помогите <b>пожалуйста</b>' })).toEqual(['motivation'])
    expect(contractHelpProblems({ ...ok, yearsToWork: '11' })).toEqual(['years'])
    expect(contractHelpBody(ok)).toEqual({ motivation: 'Нужна помощь с оплатой второго курса', yearsToWork: 3, workRegion: 'OWN', consent: true })
  })

  it('is open while it is in the companies’ feed', () => {
    expect(contractHelpOpen(null)).toBe(false)
    expect(contractHelpOpen({ status: 'INTERESTED' } as never)).toBe(true)
    expect(contractHelpOpen({ status: 'SIGNED' } as never)).toBe(false)
  })

  it('reads «no request yet» from an empty answer', async () => {
    apiMock.mockResolvedValueOnce(undefined)
    expect(await studentApi.contractHelp()).toBeNull()
  })
})

describe('vacancies', () => {
  it('start from the student’s industry and region', () => {
    const q = { direction: { id: 'd1', name: 'Dasturlaş', industryId: 'it' }, region: 'andijan' } as unknown as StudentQuestionnaire
    expect(defaultVacancyFilters(q)).toEqual({ industry: 'it', region: 'andijan', kind: '', format: '' })
    expect(defaultVacancyFilters(null)).toEqual({ industry: '', region: '', kind: '', format: '' })
  })

  it('send only the filters that are set', () => {
    expect(vacancyQuery({ industry: 'it', region: '', kind: 'PRACTICE', format: '' })).toBe('?industry=it&kind=PRACTICE')
    expect(vacancyQuery({ industry: '', region: '', kind: '', format: '' })).toBe('')
  })

  it('apply with the consent and an optional note; requests from companies are answered by id', async () => {
    apiMock.mockReset()
    apiMock.mockResolvedValue([])
    await studentApi.apply('v 1', '  ')
    await studentApi.acceptRequest('r1')
    await studentApi.revokeRequest('r1')
    await studentApi.withdrawApplication('a1')
    expect(apiMock.mock.calls.map(([path, opts]) => `${(opts as { method?: string } | undefined)?.method ?? 'GET'} ${path}`)).toEqual([
      'POST /vacancies/v%201/apply', 'POST /students/me/contact-requests/r1/accept', 'POST /students/me/contact-requests/r1/revoke', 'DELETE /students/me/applications/a1',
    ])
    expect((apiMock.mock.calls[0][1] as { body: unknown }).body).toEqual({ note: null, consent: true })
  })
})
