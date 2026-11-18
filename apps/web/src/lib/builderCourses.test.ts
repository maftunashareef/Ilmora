import { describe, expect, it } from 'vitest'
import type { Course, Group } from '../types'
import { subscribableCourses } from './builderCourses'

const group = (courseId: string): Group => ({ id: `${courseId}-g`, courseId, name: courseId, days: [0], start: '10:00', end: '11:00', room: '1', capacity: 5 })
const course = (id: string, extra: Partial<Course> = {}): Course => ({ id, groups: [group(id)], status: 'published', visibility: 'public', ...extra }) as Course

describe('subscribableCourses («Свой набор»)', () => {
  it('leaves out a published course with no group yet — it has no seat, and its missing schedule used to crash the cart', () => {
    const list = subscribableCourses([course('with-group'), course('no-group', { groups: [] })])
    expect(list.map((c) => c.id)).toEqual(['with-group'])
  })

  it('leaves out online and private courses, as before', () => {
    const online = course('online', { groups: [], externalUrl: 'https://example.org', delivery: 'ONLINE' } as Partial<Course>)
    const draft = course('draft', { status: 'draft' } as Partial<Course>)
    expect(subscribableCourses([course('ok'), online, draft]).map((c) => c.id)).toEqual(['ok'])
  })
})
