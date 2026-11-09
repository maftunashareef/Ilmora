'use client'
import { useId, useState, type KeyboardEvent } from 'react'
import { searchTechnikums, UZ_REGIONS, type OrgOwnership, type Technikum } from '@ilmora/shared'
import { useT } from '@/i18n/useT'
import { cx, Icon, Input } from './ui'

/** The technikum being registered: `id` when it was picked from the list, `null` when its name was typed by hand. */
export interface TechnikumChoice { id: string | null; name: string }

/**
 * Search-as-you-type picker over the technikum list, narrowed by the region and type chosen above it. Typing a name
 * that is not in the list is allowed: the choice then has no id and the name is kept as typed.
 */
export function TechnikumPicker({ id, list, value, onChange, region, ownership, invalid }: {
  id?: string
  list: readonly Technikum[]
  value: TechnikumChoice
  onChange: (v: TechnikumChoice, picked?: Technikum) => void
  region: string
  ownership: OrgOwnership | null
  invalid?: boolean
}) {
  const { t, lang } = useT()
  const listId = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const hasList = list.length > 0
  // Once a listed technikum is picked, reopening shows the whole narrowed list so another one can be chosen.
  const matches = hasList ? searchTechnikums(list, value.id ? '' : value.name, { region, ownership }) : []
  const count = matches.length + (matches.length ? 1 : 0)
  const show = open && hasList
  const regionName = (id: string) => UZ_REGIONS.find((r) => r.id === id)?.name[lang] ?? id

  const pick = (i: number) => {
    if (i < matches.length) onChange({ id: matches[i].id, name: matches[i].name }, matches[i])
    else onChange({ id: null, name: value.id ? '' : value.name })
    setOpen(false)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!hasList) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, count - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter' && show && count) { e.preventDefault(); pick(active) }
    else if (e.key === 'Escape') setOpen(false)
  }

  const optionId = (i: number) => `${listId}-o${i}`
  return (
    <div className="relative">
      <Input
        id={id}
        role={hasList ? 'combobox' : undefined}
        aria-expanded={hasList ? show : undefined}
        aria-controls={hasList ? listId : undefined}
        aria-autocomplete={hasList ? 'list' : undefined}
        aria-activedescendant={show && count ? optionId(active) : undefined}
        aria-invalid={invalid}
        autoComplete="off"
        maxLength={120}
        placeholder={t(hasList ? 'auth.org.technikumSearch' : 'auth.org.technikumNamePlaceholder')}
        value={value.name}
        onChange={(e) => { onChange({ id: null, name: e.target.value }); setOpen(true); setActive(0) }}
        onFocus={() => { setOpen(true); setActive(0) }}
        onClick={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className={cx(hasList && 'pr-9')}
      />
      {hasList && <Icon name="search" className="pointer-events-none absolute right-3 top-[1.4rem] h-4 w-4 -translate-y-1/2 text-charcoal/35" />}

      {show && (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-control border border-charcoal/12 bg-paper py-1 shadow-lift">
          {matches.map((m, i) => (
            <li
              key={m.id}
              id={optionId(i)}
              role="option"
              aria-selected={value.id === m.id}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(i)}
              className={cx('cursor-pointer px-3.5 py-2', i === active && 'bg-sage/50')}
            >
              <div className="flex items-start gap-2 text-sm text-charcoal">
                <span className="min-w-0 flex-1">{m.name}</span>
                {value.id === m.id && <Icon name="check" className="mt-0.5 h-4 w-4 shrink-0 text-forest" />}
              </div>
              <div className="mt-0.5 text-[11px] text-charcoal/50">
                {[!region && regionName(m.region), m.district, !ownership && t(m.ownership === 'STATE' ? 'auth.org.state' : 'auth.org.private')].filter(Boolean).join(' · ')}
              </div>
            </li>
          ))}
          {matches.length === 0 && <li className="px-3.5 py-2.5 text-xs leading-relaxed text-charcoal/60">{t('auth.org.technikumNoMatch')}</li>}
          {matches.length > 0 && (
            <li
              id={optionId(matches.length)}
              role="option"
              aria-selected={false}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActive(matches.length)}
              onClick={() => pick(matches.length)}
              className={cx('mt-1 flex cursor-pointer items-center gap-2 border-t border-charcoal/8 px-3.5 py-2.5 text-xs font-medium text-forest', active === matches.length && 'bg-sage/50')}
            >
              <Icon name="edit" className="h-3.5 w-3.5" />
              {t('auth.org.technikumNotListed')}
            </li>
          )}
        </ul>
      )}

      {hasList && value.name.trim() && !show && (
        <p className={cx('mt-1.5 flex items-center gap-1.5 text-[11px]', value.id ? 'text-forest' : 'text-charcoal/55')}>
          <Icon name={value.id ? 'check' : 'edit'} className="h-3.5 w-3.5" />
          {t(value.id ? 'auth.org.technikumListed' : 'auth.org.technikumManual')}
        </p>
      )}
    </div>
  )
}
