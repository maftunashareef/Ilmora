import { describe, expect, it } from 'vitest'
import { courseFormat, filterCourses, formatCounts, formatFilterFromParam, formatFilterToParam, isOnlineCourse, isSafeExternalUrl } from './catalog.js'
import type { LearningFormat } from './types.js'

type C = { id: string; title: string; learningFormat?: LearningFormat; categoryId: string; centerId: string; level: string; groups: { days: number[] }[] }
const c = (id: string, title: string, learningFormat: LearningFormat | undefined, categoryId: string, level = 'beginner', days: number[][] = []): C => ({ id, title, learningFormat, categoryId, centerId: 'ce-1', level, groups: days.map((d) => ({ days: d })) })

const COURSES: C[] = [
  c('c1', 'Algebra', undefined, 'math', 'intermediate', [[0, 2]]),
  c('c2', 'IELTS intensive', 'OFFLINE', 'english', 'advanced', [[1, 3]]),
  c('c3', 'Python for beginners', 'ONLINE', 'python'),
  c('c4', 'Linear algebra', 'ONLINE', 'math', 'intermediate'),
  c('c5', 'English grammar', 'ONLINE', 'english'),
]
const text = (x: C) => x.title
const ids = (list: C[]) => list.map((x) => x.id)

describe('learning format', () => {
  it('treats a course without the field as offline', () => {
    expect(courseFormat({})).toBe('OFFLINE')
    expect(courseFormat({ learningFormat: 'OFFLINE' })).toBe('OFFLINE')
    expect(courseFormat({ learningFormat: 'ONLINE' })).toBe('ONLINE')
    expect(isOnlineCourse({ learningFormat: 'ONLINE' })).toBe(true)
    expect(isOnlineCourse({})).toBe(false)
  })

  it('maps the catalog tabs to and from the URL', () => {
    expect(formatFilterFromParam('online')).toBe('ONLINE')
    expect(formatFilterFromParam('offline')).toBe('OFFLINE')
    expect(formatFilterFromParam('')).toBe('ALL')
    expect(formatFilterFromParam(null)).toBe('ALL')
    expect(formatFilterFromParam('ONLINE')).toBe('ALL') // only the lowercase words are valid
    expect(formatFilterToParam('ONLINE')).toBe('online')
    expect(formatFilterToParam('OFFLINE')).toBe('offline')
    expect(formatFilterToParam('ALL')).toBe('')
  })
})

describe('catalog filters', () => {
  it('format filter: all, offline only, online only', () => {
    expect(ids(filterCourses(COURSES, { format: 'ALL' }, text))).toEqual(['c1', 'c2', 'c3', 'c4', 'c5'])
    expect(ids(filterCourses(COURSES, {}, text))).toEqual(['c1', 'c2', 'c3', 'c4', 'c5'])
    expect(ids(filterCourses(COURSES, { format: 'OFFLINE' }, text))).toEqual(['c1', 'c2'])
    expect(ids(filterCourses(COURSES, { format: 'ONLINE' }, text))).toEqual(['c3', 'c4', 'c5'])
  })

  it('format and category work together', () => {
    expect(ids(filterCourses(COURSES, { format: 'ONLINE', categoryId: 'math' }, text))).toEqual(['c4'])
    expect(ids(filterCourses(COURSES, { format: 'OFFLINE', categoryId: 'math' }, text))).toEqual(['c1'])
    expect(ids(filterCourses(COURSES, { format: 'ONLINE', categoryId: 'python' }, text))).toEqual(['c3'])
    expect(ids(filterCourses(COURSES, { format: 'OFFLINE', categoryId: 'python' }, text))).toEqual([])
  })

  it('search is case-insensitive and combines with format and category', () => {
    expect(ids(filterCourses(COURSES, { q: 'ALGEBRA' }, text))).toEqual(['c1', 'c4'])
    expect(ids(filterCourses(COURSES, { q: 'algebra', format: 'ONLINE' }, text))).toEqual(['c4'])
    expect(ids(filterCourses(COURSES, { q: 'english', format: 'ONLINE', categoryId: 'english' }, text))).toEqual(['c5'])
    expect(ids(filterCourses(COURSES, { q: 'english', format: 'OFFLINE', categoryId: 'english' }, text))).toEqual([])
    expect(ids(filterCourses(COURSES, { q: '   ' }, text))).toHaveLength(5)
    expect(ids(filterCourses(COURSES, { q: 'zzz' }, text))).toEqual([])
  })

  it('level, center and day filters keep working with the format filter', () => {
    expect(ids(filterCourses(COURSES, { level: 'intermediate' }, text))).toEqual(['c1', 'c4'])
    expect(ids(filterCourses(COURSES, { level: 'intermediate', format: 'ONLINE' }, text))).toEqual(['c4'])
    expect(ids(filterCourses(COURSES, { centerId: 'ce-1', format: 'ONLINE' }, text))).toEqual(['c3', 'c4', 'c5'])
    expect(ids(filterCourses(COURSES, { day: 1 }, text))).toEqual(['c2'])
    // online courses have no scheduled days, so a weekday filter never lists them
    expect(ids(filterCourses(COURSES, { day: 0, format: 'ONLINE' }, text))).toEqual([])
    expect(ids(filterCourses(COURSES, { day: 0, format: 'ALL' }, text))).toEqual(['c1'])
  })

  it('counts each format tab', () => {
    expect(formatCounts(COURSES)).toEqual({ ALL: 5, OFFLINE: 2, ONLINE: 3 })
    expect(formatCounts([])).toEqual({ ALL: 0, OFFLINE: 0, ONLINE: 0 })
  })
})

describe('external learning links', () => {
  it('accepts plain https links only', () => {
    expect(isSafeExternalUrl('https://www.freecodecamp.org/learn/')).toBe(true)
    expect(isSafeExternalUrl('https://cs50.harvard.edu/python/')).toBe(true)
    for (const bad of ['http://example.com', 'javascript:alert(1)', 'data:text/html,x', 'ftp://example.com', 'https://user:pw@example.com', 'https://localhost', '//example.com', 'example.com', '', null, undefined, `https://example.com/${'a'.repeat(500)}`]) {
      expect(isSafeExternalUrl(bad as string)).toBe(false)
    }
  })
})
