import type { Center, CenterKind, L } from '@ilmora/shared'
import type { TKey } from '../i18n/translations'

/**
 * The «Центры» tabs and the center filter of «Курсы» (director's task, Nozim's note 13.11): a center's type
 * (`Center.kind`) is one of the registry's six; the site shows them in four groups. A center without a type (sample
 * data) is a learning center, as on the server.
 */
export type CenterGroup = 'TRAINING' | 'UNIVERSITY' | 'COLLEGE' | 'SCHOOL'
export const CENTER_GROUPS: readonly { id: CenterGroup; label: TKey; kinds: readonly CenterKind[] }[] = [
  { id: 'TRAINING', label: 'centers.group.TRAINING', kinds: ['TRAINING_CENTER'] },
  { id: 'UNIVERSITY', label: 'centers.group.UNIVERSITY', kinds: ['UNIVERSITY'] },
  { id: 'COLLEGE', label: 'centers.group.COLLEGE', kinds: ['COLLEGE', 'TECHNIKUM'] },
  { id: 'SCHOOL', label: 'centers.group.SCHOOL', kinds: ['SCHOOL', 'LYCEUM'] },
]

export const centerKindOf = (c: Pick<Center, 'kind'>): CenterKind => c.kind ?? 'TRAINING_CENTER'
export const centerGroupOf = (c: Pick<Center, 'kind'>): CenterGroup => {
  const kind = centerKindOf(c)
  return CENTER_GROUPS.find((g) => g.kinds.includes(kind))!.id
}

/** Lower case, one kind of apostrophe, single spaces: «Ma’rifat» is found by «ma'rifat». */
const norm = (s: string) => s.normalize('NFC').toLowerCase().replace(/[’‘ʻʼ`´]/g, "'").replace(/\s+/g, ' ').trim()
const texts = (l: L | undefined) => (l ? [l.uz, l.ru, l.en] : [])

/** Search on «Центры»: every word must be in the name, the district or the description (any language). */
export function centerMatches(c: Pick<Center, 'name' | 'district' | 'description'>, query: string): boolean {
  const words = norm(query).split(' ').filter(Boolean)
  if (!words.length) return true
  const hay = norm([c.name, ...texts(c.district), ...texts(c.description)].join(' '))
  return words.every((w) => hay.includes(w))
}
