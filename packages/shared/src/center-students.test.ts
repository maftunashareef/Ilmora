import { describe, expect, it } from 'vitest'
import {
  attendancePercent, canSubmitHomework, countsAsAttended, homeworkDeadline, homeworkState, INVITE_SENDS_MAX, inviteState, inviteUrl, isMinorOn,
  parseSheetDate, studyLabel,
} from './center-students.js'
import { dict } from './translations.js'

describe('«Ученик школы №N, 9 класс» (ТЗ 4.4)', () => {
  const base = { centerName: 'Najot', institutionName: '15-maktab', studyYear: 9 }
  it('a school counts classes, a lyceum, college, technikum or university — years', () => {
    expect(studyLabel('ru', { ...base, institutionType: 'SCHOOL' })).toBe('Ученик: 15-maktab, 9 класс')
    expect(studyLabel('uz', { ...base, institutionType: 'SCHOOL' })).toBe('15-maktab öquvçisi, 9-sinf')
    expect(studyLabel('ru', { ...base, institutionName: 'ТУИТ', studyYear: 2, institutionType: 'UNIVERSITY' })).toBe('Студент: ТУИТ, 2 курс')
    expect(studyLabel('ru', { ...base, institutionName: 'Texnikum', studyYear: 1, institutionType: 'TECHNIKUM' })).toBe('Студент: Texnikum, 1 курс')
    expect(studyLabel('en', { ...base, institutionName: 'Lyceum', studyYear: 1, institutionType: 'LYCEUM' })).toBe('Student at Lyceum, year 1')
  })
  it('without an institution (or a learning center as one): «Учится в центре …»', () => {
    expect(studyLabel('ru', { ...base, institutionName: null, institutionType: null })).toBe('Учится в центре Najot')
    expect(studyLabel('ru', { ...base, institutionName: '  ', institutionType: 'SCHOOL' })).toBe('Учится в центре Najot')
    expect(studyLabel('ru', { ...base, institutionType: 'TRAINING_CENTER' })).toBe('Учится в центре Najot')
  })
  it('a typed name of unknown type and a missing year', () => {
    expect(studyLabel('ru', { ...base, institutionType: null })).toBe('Учится: 15-maktab, 9-й год')
    expect(studyLabel('ru', { ...base, studyYear: null, institutionType: 'SCHOOL' })).toBe('Ученик: 15-maktab')
    expect(studyLabel('ru', { ...base, studyYear: 0, institutionType: 'UNIVERSITY' })).toBe('Студент: 15-maktab')
  })
  it('every label key exists in the dictionary', () => {
    for (const k of ['center', 'school', 'schoolYear', 'lyceum', 'lyceumYear', 'higher', 'higherYear', 'other', 'otherYear']) expect(dict).toHaveProperty(`cs.label.${k}`)
  })
})

describe('Minors and invitations (ТЗ 4.3)', () => {
  it('under 18 on the day', () => {
    expect(isMinorOn('2008-11-20', '2026-11-19')).toBe(true)
    expect(isMinorOn('2008-11-19', '2026-11-19')).toBe(false)
    expect(isMinorOn(null, '2026-11-19')).toBe(false)
    expect(isMinorOn('2008-02-30', '2026-11-19')).toBe(false)
  })
  it('invitation states: none, invited, expired, accepted; sends: the first and 3 more', () => {
    const now = new Date('2026-11-19T10:00:00Z')
    expect(inviteState({}, now)).toBe('none')
    expect(inviteState({ invitedAt: now, inviteExpiresAt: new Date('2026-11-26T10:00:00Z') }, now)).toBe('invited')
    expect(inviteState({ invitedAt: now, inviteExpiresAt: new Date('2026-11-19T09:59:59Z') }, now)).toBe('expired')
    expect(inviteState({ invitedAt: now, inviteExpiresAt: new Date('2026-11-19T09:00:00Z'), inviteAcceptedAt: now }, now)).toBe('accepted')
    expect(INVITE_SENDS_MAX).toBe(4)
  })
  it('the token travels in the fragment, never in the path or query', () => {
    const url = inviteUrl('https://ilmora.uz/', 'abc_DEF-123')
    expect(url).toBe('https://ilmora.uz/invite#abc_DEF-123')
    // No `URL` here: the shared package has neither DOM nor Node types. Path, then the fragment; no query at all.
    const [address, fragment] = url.split('#')
    expect(address).toBe('https://ilmora.uz/invite')
    expect(address).not.toContain('?')
    expect(fragment).toBe('abc_DEF-123')
  })
})

describe('Excel dates', () => {
  it('31.12.2010, 2010-12-31 and Excel day numbers; nonsense is null', () => {
    expect(parseSheetDate('31.12.2010')).toBe('2010-12-31')
    expect(parseSheetDate('1/2/2011')).toBe('2011-02-01')
    expect(parseSheetDate('2010-12-31')).toBe('2010-12-31')
    expect(parseSheetDate(40543)).toBe('2010-12-31')
    expect(parseSheetDate('40543')).toBe('2010-12-31')
    for (const bad of ['31.02.2010', 'завтра', '', null, undefined, '2010-13-01']) expect(parseSheetDate(bad as string)).toBeNull()
  })
})

describe('Journal and homework', () => {
  it('percent of past lessons; «опоздал» counts as attended', () => {
    expect(attendancePercent(3, 4)).toBe(75)
    expect(attendancePercent(0, 0)).toBeNull()
    expect(attendancePercent(5, 4)).toBe(100)
    expect(countsAsAttended('LATE')).toBe(true)
    expect(countsAsAttended('ABSENT')).toBe(false)
  })
  it('a deadline for one student: the later of the homework\'s and the extension; late = after the homework\'s own', () => {
    const due = '2026-11-20T13:00:00.000Z'
    expect(homeworkDeadline(due, null).toISOString()).toBe(due)
    expect(homeworkDeadline(due, '2026-11-22T13:00:00.000Z').toISOString()).toBe('2026-11-22T13:00:00.000Z')
    expect(homeworkDeadline(due, '2026-11-19T13:00:00.000Z').toISOString()).toBe(due)
    expect(canSubmitHomework(due, null, new Date('2026-11-20T13:00:00.000Z'))).toBe(true)
    expect(canSubmitHomework(due, null, new Date('2026-11-20T13:00:00.001Z'))).toBe(false)
    expect(canSubmitHomework(due, '2026-11-21T00:00:00.000Z', new Date('2026-11-20T20:00:00.000Z'))).toBe(true)
    expect(homeworkState(due, null)).toBe('missing')
    expect(homeworkState(due, '2026-11-20T12:00:00.000Z')).toBe('submitted')
    expect(homeworkState(due, '2026-11-20T14:00:00.000Z')).toBe('late')
  })
})
