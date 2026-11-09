'use client'
import { useId, useState, type KeyboardEvent } from 'react'
import { matchesFormerNameOnly, searchInstitutions, UZ_REGIONS, type Institution, type InstitutionChoice, type InstitutionType } from '@ilmora/shared'
import { useT } from '@/i18n/useT'
import { Badge, cx, Icon, Input, Select } from './ui'

const SHOWN = 50

/**
 * Institution search over the registry (ТЗ 3.5): narrowed by the type chosen outside and an optional region filter here,
 * search-as-you-type in any spelling, and "not in the list — add it" with a name and region (saved to the registry
 * by the server, marked "added by a student"). One component for the student questionnaire and wherever an institution is picked.
 */
export function InstitutionSearch({ id, list, type, value, onChange, invalid }: {
  id?: string
  list: readonly Institution[]
  type: InstitutionType | null
  value: InstitutionChoice | null
  onChange: (v: InstitutionChoice | null) => void
  invalid?: boolean
}) {
  const { t, lang } = useT()
  const listId = useId()
  const [region, setRegion] = useState(value?.region ?? '')
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(!!value && !value.id)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const regionName = (r: string) => UZ_REGIONS.find((x) => x.id === r)?.name[lang] ?? r
  const picked = value?.id ? list.find((x) => x.id === value.id) : undefined

  const found = searchInstitutions(list, query, { type, region }, SHOWN + 1)
  const matches = found.slice(0, SHOWN)
  const count = matches.length + 1
  const show = open && !picked

  const startAdding = () => {
    setAdding(true)
    setOpen(false)
    onChange({ name: query.trim(), region })
  }
  const pick = (i: number) => {
    if (i < matches.length) { onChange({ id: matches[i].id, name: matches[i].name, region: matches[i].region }); setQuery('') ; setOpen(false) }
    else startAdding()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, count - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter' && show) { e.preventDefault(); pick(active) }
    else if (e.key === 'Escape') setOpen(false)
  }
  const optionId = (i: number) => `${listId}-o${i}`

  if (adding) {
    return (
      <div className="space-y-3 rounded-control border border-champagne/50 bg-paper p-3.5">
        <p className="flex items-start gap-2 text-xs leading-relaxed text-charcoal/65"><Icon name="plus" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-champagne" />{t('q.institutionAddHint')}</p>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-charcoal/70">{t('q.institutionName')}</span>
          <Input id={id} maxLength={160} value={value?.name ?? ''} aria-invalid={invalid} onChange={(e) => onChange({ name: e.target.value, region: value?.region ?? '' })} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-charcoal/70">{t('auth.org.region')}</span>
          <Select value={value?.region ?? ''} aria-invalid={invalid} onChange={(e) => onChange({ name: value?.name ?? '', region: e.target.value })} className={value?.region ? undefined : 'text-charcoal/40'}>
            <option value="" disabled>{t('auth.org.regionPlaceholder')}</option>
            {UZ_REGIONS.map((r) => <option key={r.id} value={r.id} className="text-charcoal">{r.name[lang]}</option>)}
          </Select>
        </label>
        <button type="button" className="text-xs font-medium text-forest underline" onClick={() => { setAdding(false); setQuery(value?.name ?? ''); onChange(null) }}>
          {t('q.institutionSearch')}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Select aria-label={t('auth.org.region')} value={region} onChange={(e) => { setRegion(e.target.value); if (picked && e.target.value && picked.region !== e.target.value) onChange(null) }} className={cx('py-2 text-xs', !region && 'text-charcoal/50')}>
        <option value="">{t('q.allRegions')}</option>
        {UZ_REGIONS.map((r) => <option key={r.id} value={r.id} className="text-charcoal">{r.name[lang]}</option>)}
      </Select>
      <div className="relative">
        <Input
          id={id}
          role="combobox"
          aria-expanded={show}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={show ? optionId(active) : undefined}
          aria-invalid={invalid}
          autoComplete="off"
          maxLength={160}
          placeholder={t('q.institutionSearch')}
          value={picked ? picked.name : query}
          onChange={(e) => { if (picked) onChange(null); setQuery(e.target.value); setOpen(true); setActive(0) }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
          className="pr-9"
        />
        {picked
          ? <button type="button" aria-label={t('common.close')} onClick={() => { onChange(null); setQuery('') }} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-charcoal/45 hover:text-forest"><Icon name="x" className="h-4 w-4" /></button>
          : <Icon name="search" className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-charcoal/35" />}
        {show && (
          <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-control border border-charcoal/12 bg-paper py-1 shadow-lift">
            {matches.map((m, i) => (
              <li key={m.id} id={optionId(i)} role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(i)} className={cx('cursor-pointer px-3.5 py-2', i === active && 'bg-sage/50')}>
                <div className="text-sm text-charcoal">
                  {m.name}
                  {lang === 'ru' && m.nameRu && <span className="block text-xs text-charcoal/60">{m.nameRu}</span>}
                  {matchesFormerNameOnly(m, query) && <span className="block text-xs text-champagne">{t('auth.org.formerName', { name: m.formerName! })}</span>}
                </div>
                <div className="mt-0.5 text-[11px] text-charcoal/50">{[!region && regionName(m.region), m.district].filter(Boolean).join(' · ')}</div>
              </li>
            ))}
            {found.length > SHOWN && <li className="px-3.5 py-2 text-[11px] text-charcoal/50">{t('auth.org.technikumMore', { n: SHOWN })}</li>}
            {matches.length === 0 && <li className="px-3.5 py-2.5 text-xs text-charcoal/60">{t('auth.org.technikumNoMatch')}</li>}
            <li id={optionId(matches.length)} role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(matches.length)} onClick={() => pick(matches.length)} className={cx('mt-1 flex cursor-pointer items-center gap-2 border-t border-charcoal/8 px-3.5 py-2.5 text-xs font-medium text-forest', active === matches.length && 'bg-sage/50')}>
              <Icon name="plus" className="h-3.5 w-3.5" />{t('q.institutionAdd')}
            </li>
          </ul>
        )}
      </div>
      {picked && (
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-forest">
          <Icon name="check" className="h-3.5 w-3.5" />{t('q.institutionPicked')} · {regionName(picked.region)}
          {picked.addedBy === 'STUDENT' && <Badge tone="champagne">{t('inst.addedByStudent')}</Badge>}
        </p>
      )}
    </div>
  )
}
