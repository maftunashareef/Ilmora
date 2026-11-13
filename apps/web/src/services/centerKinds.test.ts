import { describe, expect, it } from 'vitest'
import { REGISTRY_INSTITUTION_TYPES } from '@ilmora/shared'
import { CENTER_GROUPS, centerGroupOf, centerKindOf, centerMatches } from './centerKinds'

const l = (uz: string, ru: string, en: string) => ({ uz, ru, en })
const center = { name: 'Ma’rifat Academy', district: l('Yunusobod', 'Юнусабад', 'Yunusabad'), description: l('Til markazi', 'Центр языков и математики', 'Languages and maths') }

describe('center types', () => {
  it('puts every registry type in exactly one group', () => {
    for (const kind of REGISTRY_INSTITUTION_TYPES) expect(CENTER_GROUPS.filter((g) => g.kinds.includes(kind))).toHaveLength(1)
  })
  it('groups colleges with technikums and schools with lyceums', () => {
    expect(centerGroupOf({ kind: 'TECHNIKUM' })).toBe('COLLEGE')
    expect(centerGroupOf({ kind: 'COLLEGE' })).toBe('COLLEGE')
    expect(centerGroupOf({ kind: 'LYCEUM' })).toBe('SCHOOL')
    expect(centerGroupOf({ kind: 'UNIVERSITY' })).toBe('UNIVERSITY')
  })
  it('reads a center without a type as a learning center', () => {
    expect(centerKindOf({})).toBe('TRAINING_CENTER')
    expect(centerGroupOf({})).toBe('TRAINING')
  })
})

describe('centerMatches', () => {
  it('finds by name, district and description in any language, ignoring case', () => {
    expect(centerMatches(center, 'academy')).toBe(true)
    expect(centerMatches(center, 'юнусабад')).toBe(true)
    expect(centerMatches(center, 'математики')).toBe(true)
    expect(centerMatches(center, 'Til')).toBe(true)
  })
  it('needs every word and treats apostrophes alike', () => {
    expect(centerMatches(center, "ma'rifat юнусабад")).toBe(true)
    expect(centerMatches(center, 'academy чиланзар')).toBe(false)
  })
  it('an empty query matches everything', () => {
    expect(centerMatches(center, '   ')).toBe(true)
  })
})
