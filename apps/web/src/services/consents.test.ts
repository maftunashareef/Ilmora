import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EMPTY_QUESTIONNAIRE, translate, type StudentConsentDto, type StudentQuestionnaire } from '@ilmora/shared'

const calls: { path: string; method?: string; body?: unknown }[] = []
vi.mock('../lib/api', () => ({
  api: vi.fn(async (path: string, opts: { method?: string; body?: unknown } = {}) => {
    calls.push({ path, method: opts.method, body: opts.body })
    return []
  }),
}))

const { CONSENT_TEXT, consentRows, consentsApi, REVOKE_WARNING } = await import('./consents')

const TODAY = new Date(Date.UTC(2026, 10, 13))
const adult: StudentQuestionnaire = { ...EMPTY_QUESTIONNAIRE, status: 'STUDYING', birthDate: '2005-03-15' }
const minor: StudentQuestionnaire = { ...adult, birthDate: '2010-05-01', guardianName: 'Aliyeva Malika', guardianPhone: '+998901234568' }
const row = (kind: StudentConsentDto['kind'], active = true, company: StudentConsentDto['company'] = null): StudentConsentDto => ({ id: `${kind}-${active}`, kind, company, textVersion: '2026-11-10', givenAt: '2026-11-01T10:00:00.000Z', revokedAt: active ? null : '2026-11-02T10:00:00.000Z', active })
const shape = (rows: ReturnType<typeof consentRows>) => rows.map((r) => `${r.kind}:${r.active ? 'on' : (r.block ?? 'off')}`)

describe('«Мои согласия»', () => {
  beforeEach(() => { calls.length = 0 })

  it('each action is its own request and carries no questionnaire', async () => {
    await consentsApi.journal()
    await consentsApi.give('INDUSTRY_CARD')
    await consentsApi.revoke('PARENT_CONSENT')
    expect(calls).toEqual([
      { path: '/students/me/consents', method: undefined, body: undefined },
      { path: '/students/me/consents/INDUSTRY_CARD/give', method: 'POST', body: undefined },
      { path: '/students/me/consents/PARENT_CONSENT/revoke', method: 'POST', body: undefined },
    ])
  })

  it('an adult who studies is offered the three card consents, not the parent’s', () => {
    expect(shape(consentRows(adult, [], TODAY))).toEqual(['GRADUATE_CARD:off', 'CONTRACT_HELP_CARD:off', 'INDUSTRY_CARD:off'])
    expect(shape(consentRows(adult, [row('INDUSTRY_CARD'), row('GRADUATE_CARD', false)], TODAY))).toEqual(['GRADUATE_CARD:off', 'CONTRACT_HELP_CARD:off', 'INDUSTRY_CARD:on'])
  })

  it('«компании моей отрасли» is not offered to an applicant — but one in force can still be taken back', () => {
    const applying: StudentQuestionnaire = { ...adult, status: 'APPLYING' }
    expect(shape(consentRows(applying, [], TODAY))).toEqual(['GRADUATE_CARD:off', 'CONTRACT_HELP_CARD:off'])
    expect(shape(consentRows(applying, [row('INDUSTRY_CARD')], TODAY))).toEqual(['GRADUATE_CARD:off', 'CONTRACT_HELP_CARD:off', 'INDUSTRY_CARD:on'])
  })

  it('a minor gives the parent’s consent first; without it the card consents are closed', () => {
    expect(shape(consentRows(minor, [], TODAY))).toEqual(['PARENT_CONSENT:off', 'GRADUATE_CARD:parent_consent_required', 'CONTRACT_HELP_CARD:parent_consent_required', 'INDUSTRY_CARD:parent_consent_required'])
    expect(shape(consentRows(minor, [row('PARENT_CONSENT')], TODAY))).toEqual(['PARENT_CONSENT:on', 'GRADUATE_CARD:off', 'CONTRACT_HELP_CARD:off', 'INDUSTRY_CARD:off'])
    // Taken back: a card consent still in force stays on the screen, to be taken back too.
    expect(shape(consentRows(minor, [row('PARENT_CONSENT', false), row('INDUSTRY_CARD')], TODAY))).toEqual(['PARENT_CONSENT:off', 'GRADUATE_CARD:parent_consent_required', 'CONTRACT_HELP_CARD:parent_consent_required', 'INDUSTRY_CARD:on'])
    expect(shape(consentRows({ ...minor, guardianPhone: '' }, [], TODAY))[0]).toBe('PARENT_CONSENT:guardian_details_required')
  })

  it('without a questionnaire nothing can be given, and consents to one company are not rows of this list', () => {
    expect(shape(consentRows(null, [], TODAY))).toEqual(['GRADUATE_CARD:questionnaire_required', 'CONTRACT_HELP_CARD:questionnaire_required', 'INDUSTRY_CARD:questionnaire_required'])
    expect(shape(consentRows(adult, [row('COMPANY_CONTACTS', true, { id: 'c1', name: 'Soft Co' })], TODAY))).toEqual(['GRADUATE_CARD:off', 'CONTRACT_HELP_CARD:off', 'INDUSTRY_CARD:off'])
    // An adult whose parent consent is still in force (given while a minor) sees it and can take it back.
    expect(shape(consentRows(adult, [row('PARENT_CONSENT')], TODAY))[0]).toBe('PARENT_CONSENT:on')
  })

  it('the warning before a revocation is the kind’s own: contacts are mentioned for named cards only, the parent’s hides every card', () => {
    expect(REVOKE_WARNING.GRADUATE_CARD).toBe(REVOKE_WARNING.INDUSTRY_CARD)
    const ru = (k: keyof typeof REVOKE_WARNING) => translate('ru', REVOKE_WARNING[k])
    expect(ru('INDUSTRY_CARD')).toContain('контакты, которые компании уже получили, останутся у них')
    expect(ru('INDUSTRY_CARD')).toContain('их можно отклонить')
    expect(ru('CONTRACT_HELP_CARD')).not.toContain('уже получили')
    expect(ru('CONTRACT_HELP_CARD')).toContain('их можно отклонить')
    expect(ru('PARENT_CONSENT')).toContain('Все ваши карточки будут сразу скрыты')
    for (const key of Object.values(CONSENT_TEXT)) for (const lang of ['uz', 'ru', 'en'] as const) expect(translate(lang, key)).not.toBe(key)
  })
})
