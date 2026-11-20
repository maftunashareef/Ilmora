'use client'
import { useId, useState } from 'react'
import { REGISTRY_INSTITUTION_TYPES, type InstitutionSearchItemDto, type RegistryInstitutionType } from '@ilmora/shared'
import { useT } from '../../i18n/useT'
import { registryApi, useSuggestions } from '../../services/registry'
import { Badge, Field, Icon, Input, Select } from '../ui'

export interface InstitutionValue { id: string | null; name: string; type: RegistryInstitutionType | null }

/**
 * Where a student studies (ТЗ 2026-11-18, 4.3): the registry first — the type narrows the search, a pick links the
 * record — and, when it is not there, the name typed by hand with its type. Never adds anything to the registry.
 */
export function InstitutionPicker({ value, onChange }: { value: InstitutionValue | null; onChange: (v: InstitutionValue | null) => void }) {
  const { t } = useT()
  const listId = useId()
  const [type, setType] = useState<RegistryInstitutionType | null>(value?.type ?? null)
  const [text, setText] = useState(value && !value.id ? value.name : '')
  const [open, setOpen] = useState(false)
  const found = useSuggestions<InstitutionSearchItemDto>(open ? text : '', (q) => registryApi.institutions(q, { type }), type ?? '')

  const setTyped = (name: string) => {
    setText(name)
    onChange(name.trim() ? { id: null, name, type } : null)
  }
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,12rem)_1fr]">
      <Field label={t('cs.form.institutionType')}>
        <Select value={type ?? ''} onChange={(e) => {
          const next = (e.target.value || null) as RegistryInstitutionType | null
          setType(next)
          if (value) onChange({ ...value, type: value.id ? value.type : next })
        }}>
          <option value="">—</option>
          {REGISTRY_INSTITUTION_TYPES.map((x) => <option key={x} value={x}>{t(`inst.type.${x}`)}</option>)}
        </Select>
      </Field>
      <Field label={t('cs.col.institution')} hint={t('cs.form.institutionHint')}>
        {value?.id ? (
          <div className="flex items-center gap-2 rounded-control border border-charcoal/15 bg-ivory/60 px-3 py-2 text-sm">
            <Badge tone="sage">{t('cs.form.fromRegistry')}</Badge>
            <span className="min-w-0 flex-1 truncate">{value.name}</span>
            <button type="button" className="text-charcoal/50 hover:text-charcoal" aria-label={t('cs.form.clear')} onClick={() => { onChange(null); setText('') }}><Icon name="x" className="h-4 w-4" /></button>
          </div>
        ) : (
          <div className="relative">
            <Input value={text} maxLength={200} aria-autocomplete="list" aria-controls={listId} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} onChange={(e) => { setTyped(e.target.value); setOpen(true) }} placeholder={t('cs.form.institutionText')} />
            {open && found.items.length > 0 && (
              <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-60 w-full overflow-auto rounded-control border border-charcoal/10 bg-white py-1 text-sm shadow-lift">
                {found.items.map((x) => (
                  <li key={x.id} role="option" aria-selected={false}>
                    <button type="button" className="block w-full px-3 py-2 text-left hover:bg-ivory" onMouseDown={(e) => e.preventDefault()} onClick={() => { onChange({ id: x.id, name: x.name, type: x.type }); setType(x.type); setText(''); setOpen(false) }}>
                      {x.name}<span className="ml-2 text-xs text-charcoal/45">{t(`inst.type.${x.type}`)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </Field>
    </div>
  )
}
