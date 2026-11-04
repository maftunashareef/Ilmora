import { describe, expect, it } from 'vitest'
import type { Group, Preset, University } from '../types'
import { arrangeCartByPackage } from './cartPackages'

const g = (courseId: string): Group => ({ id: `${courseId}-g`, courseId, name: courseId, days: [0], start: '10:00', end: '11:00', room: '1', capacity: 5 })
const L = (s: string) => ({ uz: s, ru: s, en: s })
const preset = (id: string, enabled = true): Preset => ({ id, universityId: 'u', name: L(id), description: L(''), enabled, slots: [] })
const UNIS: University[] = [{ id: 'u', name: 'University' }]

describe('arrangeCartByPackage', () => {
  it('shows each course once, under the first package that includes it, and the rest on their own', () => {
    const groups = [g('math'), g('eng'), g('phys'), g('art')]
    const r = arrangeCartByPackage(groups, [{ presetId: 'a', courseIds: ['math', 'eng'] }, { presetId: 'b', courseIds: ['eng', 'phys'] }], [preset('a'), preset('b')], UNIS)
    expect(r.packages.map((p) => [p.presetId, p.university?.id, p.groups.map((x) => x.courseId)])).toEqual([['a', 'u', ['math', 'eng']], ['b', 'u', ['phys']]])
    expect(r.loose.map((x) => x.courseId)).toEqual(['art'])
  })

  it('skips a package that is no longer published or has none of its courses in the cart', () => {
    const r = arrangeCartByPackage([g('math')], [{ presetId: 'off', courseIds: ['math'] }, { presetId: 'gone', courseIds: ['eng'] }], [preset('off', false), preset('gone')], UNIS)
    expect(r.packages).toEqual([])
    expect(r.loose.map((x) => x.courseId)).toEqual(['math'])
  })
})
