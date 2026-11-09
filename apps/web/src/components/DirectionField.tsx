'use client'
import { useId, useState, type KeyboardEvent } from 'react'
import { DIRECTION_MIN_QUERY, directionKey, findSameDirection, searchDirections, type Direction, type DirectionChoice } from '@ilmora/shared'
import { useT } from '@/i18n/useT'
import { addDirection, useDirectory } from '../services/directory'
import { Badge, Button, cx, Icon, Input } from './ui'

/**
 * The direction field used everywhere (ТЗ 3.2): suggestions from the shared directory after two characters, with the
 * industry beside each; a pick becomes a chip and brings its industry; "Add “…”" asks for the industry and saves the
 * direction to the directory for everyone. Spellings that differ only in case, spaces, script (Cyrillic / Latin) or
 * apostrophe are the same direction, so the add option is not offered for them.
 */
export function DirectionField({ id, value, onChange, invalid, placeholder }: {
  id?: string
  value: DirectionChoice | null
  onChange: (v: DirectionChoice | null) => void
  invalid?: boolean
  placeholder?: string
}) {
  const { t, lang } = useT()
  const { directions, industries } = useDirectory()
  const listId = useId()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [adding, setAdding] = useState<string | null>(null)
  const [industryId, setIndustryId] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const industryName = (iid?: string) => industries.find((x) => x.id === iid)?.name[lang] ?? ''

  const enough = directionKey(query).length >= DIRECTION_MIN_QUERY
  const matches = enough ? searchDirections(directions, query) : []
  const same = enough ? findSameDirection(directions, query) : undefined
  const canAdd = enough && !same
  const count = matches.length + (canAdd ? 1 : 0)
  const show = open && query.trim().length > 0 && !adding

  const choose = (d: Direction) => { onChange({ id: d.id, name: d.name, industryId: d.industryId }); setQuery(''); setOpen(false) }
  const pick = (i: number) => { if (i < matches.length) choose(matches[i]); else if (canAdd) { setAdding(query.trim()); setIndustryId(''); setFailed(false); setOpen(false) } }
  const confirmAdd = async () => {
    if (!adding || !industryId) return
    setBusy(true); setFailed(false)
    try { choose(await addDirection(adding, industryId)); setAdding(null) } catch { setFailed(true) } finally { setBusy(false) }
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, Math.max(count - 1, 0))) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter' && show && count) { e.preventDefault(); pick(active) }
    else if (e.key === 'Escape') setOpen(false)
  }
  const optionId = (i: number) => `${listId}-o${i}`

  if (value) {
    const known = directions.find((d) => d.id === value.id)
    return (
      <div className="flex min-h-[44px] items-center gap-2 rounded-control border border-forest/30 bg-sage/30 px-3 py-2">
        <Icon name="tag" className="h-4 w-4 shrink-0 text-forest" />
        <span className="min-w-0 flex-1 text-sm text-charcoal">
          <span className="font-medium">{value.name}</span>
          {value.industryId && <span className="text-charcoal/55"> · {industryName(value.industryId)}</span>}
          {known?.source === 'USER' && <Badge tone="champagne" className="ml-2 align-middle">{t('dir.byUser')}</Badge>}
          {known?.source === 'OFFICIAL' && <Badge tone="forest" className="ml-2 align-middle">{t('dir.official')}{known.code ? ` · ${known.code}` : ''}</Badge>}
        </span>
        <button type="button" onClick={() => onChange(null)} aria-label={t('dir.remove')} title={t('dir.remove')} className="rounded p-1 text-charcoal/45 hover:text-forest"><Icon name="x" className="h-4 w-4" /></button>
      </div>
    )
  }

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={show}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={show && count ? optionId(active) : undefined}
        aria-invalid={invalid}
        autoComplete="off"
        maxLength={120}
        placeholder={placeholder ?? t('dir.placeholder')}
        value={adding ?? query}
        disabled={!!adding}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
      />
      {show && (
        <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-control border border-charcoal/12 bg-paper py-1 shadow-lift">
          {!enough && <li className="px-3.5 py-2.5 text-xs text-charcoal/55">{t('dir.typeMore')}</li>}
          {matches.map((m, i) => (
            <li key={m.id} id={optionId(i)} role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(i)} className={cx('flex cursor-pointer items-center gap-3 px-3.5 py-2', i === active && 'bg-sage/50')}>
              <span className="min-w-0 flex-1 text-sm text-charcoal">
                {m.name}
                {m.source === 'USER' && <span className="ml-2 text-[10px] uppercase tracking-wide text-champagne">{t('dir.byUser')}</span>}
                {m.source === 'OFFICIAL' && <span className="ml-2 text-[10px] uppercase tracking-wide text-forest">{t('dir.official')}</span>}
              </span>
              <span className="shrink-0 text-[11px] text-charcoal/50">{industryName(m.industryId)}</span>
            </li>
          ))}
          {canAdd && (
            <li id={optionId(matches.length)} role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(matches.length)} onClick={() => pick(matches.length)} className={cx('flex cursor-pointer items-center gap-2 border-t border-charcoal/8 px-3.5 py-2.5 text-sm font-medium text-forest', active === matches.length && 'bg-sage/50', matches.length > 0 && 'mt-1')}>
              <Icon name="plus" className="h-4 w-4" />{t('dir.add', { name: query.trim() })}
            </li>
          )}
        </ul>
      )}
      {adding && (
        <div className="mt-2 space-y-3 rounded-control border border-champagne/50 bg-paper p-3.5">
          <p className="text-sm font-medium text-charcoal">{t('dir.pickIndustry', { name: adding })}</p>
          {industries.length === 0
            ? <p className="text-xs text-charcoal/55">{t('dir.noIndustries')}</p>
            : (
              <div role="radiogroup" aria-label={t('dir.industry')} className="flex flex-wrap gap-2">
                {industries.map((ind) => (
                  <button key={ind.id} type="button" role="radio" aria-checked={industryId === ind.id} onClick={() => setIndustryId(ind.id)} className={cx('rounded-full border px-3 py-1.5 text-xs font-medium transition', industryId === ind.id ? 'border-forest bg-forest text-ivory' : 'border-charcoal/15 bg-ivory/60 text-charcoal/75 hover:border-forest/50')}>
                    {ind.name[lang]}
                  </button>
                ))}
              </div>
            )}
          {failed && <p className="text-xs text-red-700" role="alert">{t('dir.addFailed')}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" disabled={!industryId || busy} onClick={() => void confirmAdd()}>
              {busy ? <Icon name="refresh" className="h-3.5 w-3.5 animate-spin" /> : <Icon name="plus" className="h-3.5 w-3.5" />}{t('dir.addConfirm')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setAdding(null); setQuery(adding) }}>{t('common.cancel')}</Button>
          </div>
        </div>
      )}
    </div>
  )
}
