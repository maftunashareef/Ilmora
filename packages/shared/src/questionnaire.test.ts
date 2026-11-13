import { describe, expect, it } from 'vitest'
import { findInstitutionByInn, INSTITUTION_REGISTRY } from './institutions.js'
import { ageOn, consentGiveBlock, EMPTY_QUESTIONNAIRE, firstIncompleteStep, isMinor, validateQuestionnaireStep, type StudentQuestionnaire } from './questionnaire.js'
import { searchInstitutions } from './registry-search.js'

const TODAY = new Date(Date.UTC(2026, 10, 9)) // 2026-11-09

const studying: StudentQuestionnaire = {
  ...EMPTY_QUESTIONNAIRE,
  status: 'STUDYING',
  institutionType: 'TECHNIKUM',
  institution: { id: 'pe-4', name: 'Andijon shahar 1-son texnikumi', region: 'andijan' },
  course: 2,
  direction: { name: 'Elektr montaj' },
  studyForm: 'CONTRACT',
  contractSum: 9_000_000,
  graduationYear: 2028,
  fullName: 'Aliyev Jasur Karimovich',
  birthDate: '2007-03-15',
  region: 'andijan',
  district: 'Andijon shahri',
  phone: '+998 90 123 45 67',
}

describe('student questionnaire', () => {
  it('a complete questionnaire of an adult student has no errors on any step', () => {
    expect(firstIncompleteStep(studying, TODAY)).toBeNull()
  })

  it('step 1 needs "already study" or "want to apply"', () => {
    expect(validateQuestionnaireStep(1, EMPTY_QUESTIONNAIRE, TODAY)).toEqual({ status: 'q.err.status' })
  })

  it('a contract needs its yearly amount; a grant does not', () => {
    expect(validateQuestionnaireStep(2, { ...studying, contractSum: null }, TODAY)).toEqual({ contractSum: 'q.err.contractSum' })
    expect(validateQuestionnaireStep(2, { ...studying, studyForm: 'GRANT', contractSum: null }, TODAY)).toEqual({})
  })

  it('a school pupil gives a grade 1–11 and needs neither direction nor form of study', () => {
    const school = { ...studying, institutionType: 'SCHOOL' as const, course: 10, direction: null, studyForm: null, contractSum: null }
    expect(validateQuestionnaireStep(2, school, TODAY)).toEqual({})
    expect(validateQuestionnaireStep(2, { ...school, course: 12 }, TODAY)).toEqual({ course: 'q.err.grade' })
    expect(validateQuestionnaireStep(2, { ...studying, course: 7 }, TODAY)).toEqual({ course: 'q.err.course' })
  })

  it('offers each status only its own institution types', () => {
    expect(validateQuestionnaireStep(2, { ...studying, institutionType: 'LYCEUM' }, TODAY).institutionType).toBe('q.err.institutionType')
    const applying: StudentQuestionnaire = { ...studying, status: 'APPLYING', institutionType: 'LYCEUM', course: null, graduationYear: null, admissionYear: 2027, studyForm: 'UNKNOWN', contractSum: null }
    expect(validateQuestionnaireStep(2, applying, TODAY)).toEqual({})
    expect(validateQuestionnaireStep(2, { ...applying, institutionType: 'SCHOOL' }, TODAY).institutionType).toBe('q.err.institutionType')
  })

  it('an applicant may leave the institution undecided, but not the direction or planned form', () => {
    const applying: StudentQuestionnaire = { ...studying, status: 'APPLYING', institutionType: 'UNIVERSITY', institution: null, institutionUndecided: true, course: null, graduationYear: null, admissionYear: 2027, studyForm: null, contractSum: null, direction: null }
    expect(validateQuestionnaireStep(2, applying, TODAY)).toEqual({ direction: 'q.err.direction', studyForm: 'q.err.plannedForm' })
    expect(validateQuestionnaireStep(2, { ...applying, institutionUndecided: false }, TODAY).institution).toBe('q.err.institution')
  })

  it('an institution typed by hand needs a name and a region', () => {
    expect(validateQuestionnaireStep(2, { ...studying, institution: { name: 'Yangi maktab', region: '' } }, TODAY).institution).toBe('q.err.institution')
    expect(validateQuestionnaireStep(2, { ...studying, institution: { name: 'Yangi texnikum', region: 'navoi' } }, TODAY)).toEqual({})
  })

  it('a minor needs a parent’s name, phone and consent', () => {
    const minor = { ...studying, birthDate: '2010-05-01' }
    expect(isMinor(minor, TODAY)).toBe(true)
    expect(validateQuestionnaireStep(3, minor, TODAY)).toEqual({ guardianName: 'q.err.guardianName', guardianPhone: 'auth.err.phone', guardianConsent: 'q.err.guardianConsent' })
    expect(validateQuestionnaireStep(3, { ...minor, guardianName: 'Aliyeva Malika', guardianPhone: '901234568', guardianConsent: true }, TODAY)).toEqual({})
    // The parent's consent already in the journal (in force or taken back): the details are still asked for, the mark is not.
    expect(validateQuestionnaireStep(3, minor, TODAY, [], true)).toEqual({ guardianName: 'q.err.guardianName', guardianPhone: 'auth.err.phone' })
    expect(firstIncompleteStep({ ...minor, guardianName: 'Aliyeva Malika', guardianPhone: '901234568' }, TODAY, [], true)).toBeNull()
    expect(firstIncompleteStep({ ...minor, guardianName: 'Aliyeva Malika', guardianPhone: '901234568' }, TODAY)).toBe(3)
  })

  it('a consent is given with a questionnaire; a minor — with the parent’s details and consent; «my industry» — by those who study', () => {
    const adult = { status: 'STUDYING' as const, birthDate: '2007-03-15', hasGuardian: false, parentConsent: false }
    const minor = { status: 'STUDYING' as const, birthDate: '2010-05-01', hasGuardian: true, parentConsent: true }
    for (const kind of ['GRADUATE_CARD', 'CONTRACT_HELP_CARD', 'INDUSTRY_CARD'] as const) {
      expect(consentGiveBlock(kind, null, TODAY)).toBe('questionnaire_required')
      expect(consentGiveBlock(kind, { ...adult, birthDate: '' }, TODAY)).toBe('questionnaire_required')
      expect(consentGiveBlock(kind, adult, TODAY)).toBeNull()
      expect(consentGiveBlock(kind, minor, TODAY)).toBeNull()
      expect(consentGiveBlock(kind, { ...minor, parentConsent: false }, TODAY)).toBe('parent_consent_required')
      expect(consentGiveBlock(kind, { ...minor, hasGuardian: false }, TODAY)).toBe('guardian_details_required')
    }
    expect(consentGiveBlock('INDUSTRY_CARD', { ...adult, status: 'APPLYING' }, TODAY)).toBe('consent_studying_only')
    expect(consentGiveBlock('GRADUATE_CARD', { ...adult, status: 'APPLYING' }, TODAY)).toBeNull()
    expect(consentGiveBlock('PARENT_CONSENT', { ...minor, parentConsent: false }, TODAY)).toBeNull()
    expect(consentGiveBlock('PARENT_CONSENT', { ...minor, hasGuardian: false }, TODAY)).toBe('guardian_details_required')
    expect(consentGiveBlock('PARENT_CONSENT', adult, TODAY)).toBe('parent_consent_adult')
  })

  it('counts age in full years and rejects impossible or future dates', () => {
    expect(ageOn('2008-11-09', TODAY)).toBe(18)
    expect(ageOn('2008-11-10', TODAY)).toBe(17)
    expect(ageOn('2026-12-01', TODAY)).toBeNull()
    expect(ageOn('2007-02-30', TODAY)).toBeNull()
    expect(ageOn('15.03.2007', TODAY)).toBeNull()
  })

  it('checks email only when given, and "about" up to 500 characters', () => {
    expect(validateQuestionnaireStep(3, { ...studying, email: 'jasur@' }, TODAY)).toEqual({ email: 'q.err.email' })
    expect(validateQuestionnaireStep(3, { ...studying, about: 'x'.repeat(501) }, TODAY)).toEqual({ about: 'q.err.about' })
  })

  it('step 4 needs every required consent ticked', () => {
    expect(validateQuestionnaireStep(4, studying, TODAY, ['profile'])).toEqual({ consents: 'q.err.consents' })
    expect(validateQuestionnaireStep(4, { ...studying, consents: { profile: true } }, TODAY, ['profile'])).toEqual({})
  })
})

describe('institution registry', () => {
  it('holds the technikums and the Uzbek universities of the catalogue', () => {
    expect(INSTITUTION_REGISTRY.filter((x) => x.type === 'TECHNIKUM')).toHaveLength(738)
    expect(INSTITUTION_REGISTRY.filter((x) => x.type === 'UNIVERSITY').length).toBeGreaterThan(10)
    expect(INSTITUTION_REGISTRY.every((x) => x.region !== '')).toBe(true)
  })

  it('narrows by type and finds an institution by its TIN', () => {
    expect(searchInstitutions(INSTITUTION_REGISTRY, 'tashkent', { type: 'UNIVERSITY' }).every((x) => x.type === 'UNIVERSITY')).toBe(true)
    expect(findInstitutionByInn(INSTITUTION_REGISTRY, '200237474')?.name).toBe('Andijon pedagogika texnikumi')
    expect(findInstitutionByInn(INSTITUTION_REGISTRY, '')).toBeUndefined()
  })
})
