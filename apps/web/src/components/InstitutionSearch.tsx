'use client'
import { useId, useState, type KeyboardEvent } from 'react'
import {
  matchesFormerNameOnly, searchInstitutions, UZ_REGIONS, type Institution, type InstitutionChoice, type InstitutionSearchItemDto,
  type InstitutionType, type OrgOwnership,
} from '@ilmora/shared'
import { useT } from '@/i18n/useT'
import { apiErrorText } from '../lib/apiErrors'
import { registryApi, useSuggestions } from '../services/registry'
import { Badge, Button, Icon, Input, Select } from './ui'
import { cx } from './ui/helpers'

const SHOWN = 50

/** One row of the list, whichever source it came from. `region` is the UZ_REGIONS id (the API's region slug). */
interface Option {
  id: string
  name: string
  nameRu?: string | null
  formerName?: string
  region: string
  district?: string
  ownership?: OrgOwnership | null
  addedByStudent?: boolean
}

const fromLocal = (x: Institution): Option => ({ ...x, addedByStudent: x.addedBy === 'STUDENT' })
const fromApi = (x: InstitutionSearchItemDto, lang: 'uz' | 'ru' | 'en'): Option => ({
  id: x.id,
  name: x.name,
  nameRu: x.nameRu,
  region: x.region?.slug ?? x.region?.id ?? '',
  district: x.district?.name[lang] ?? x.districtName ?? undefined,
  ownership: x.ownership,
  addedByStudent: x.addedByStudent,
})

/**
 * Institution search over the registry (ТЗ 3.5): narrowed by the type (and ownership) chosen outside and a region filter
 * here, search-as-you-type in any spelling, and "not in the list — add it" with a name and region.
 *
 * - With `list` (the sign-up page, where the visitor has no account and the API's registry cannot be read): searches that
 *   list in the browser; an institution typed by hand is kept as name + region and claimed after sign-up.
 * - Without `list` (signed-in pages): asks the API (`/v1/registry/institutions`, from two letters); "add" saves the
 *   institution to the registry right away, marked "added by a student".
 */
export function InstitutionSearch({ id, list, type, ownership, value, onChange, invalid }: {
  id?: string
  list?: readonly Institution[]
  type: InstitutionType | null
  ownership?: OrgOwnership | null
  value: InstitutionChoice | null
  onChange: (v: InstitutionChoice | null) => void
  invalid?: boolean
}) {
  const { t, lang } = useT()
  const listId = useId()
  const local = !!list
  const [region, setRegion] = useState(value?.region ?? '')
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(local && !!value && !value.id)
  const [draft, setDraft] = useState({ name: '', region: '' })
  const [saving, setSaving] = useState(false)
  const [addError, setAddError] = useState<string | null>(null)
  const [pickedInfo, setPickedInfo] = useState<Option | null>(null)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const regionName = (r: string) => UZ_REGIONS.find((x) => x.id === r)?.name[lang] ?? r

  const remote = useSuggestions(local ? '' : query, (q) => registryApi.institutions(q, { type, regionId: region || undefined }), `${type}|${region}`)
  const localFound = local ? searchInstitutions(list, query, { type, region, ownership }, SHOWN + 1) : []
  const options: Option[] = local
    ? localFound.slice(0, SHOWN).map(fromLocal)
    : remote.items.map((x) => fromApi(x, lang)).filter((x) => !ownership || !x.ownership || x.ownership === ownership)
  const showAdd = local || (remote.enough && (remote.status === 'ready' || remote.status === 'error'))
  const count = options.length + (showAdd ? 1 : 0)

  const listed = value?.id && local ? list.find((x) => x.id === value.id) : undefined
  const picked: Option | undefined = value?.id
    ? (listed ? fromLocal(listed) : pickedInfo?.id === value.id ? pickedInfo : { id: value.id, name: value.name, region: value.region })
    : undefined
  const show = open && !picked

  const startAdding = () => {
    setAdding(true)
    setOpen(false)
    setAddError(null)
    if (local) onChange({ name: query.trim(), region })
    else setDraft({ name: query.trim(), region })
  }
  const pick = (i: number) => {
    if (i < options.length) {
      setPickedInfo(options[i])
      onChange({ id: options[i].id, name: options[i].name, region: options[i].region })
      setQuery('')
      setOpen(false)
    } else if (showAdd) startAdding()
  }
  const addToRegistry = async () => {
    if (!type) return
    setSaving(true); setAddError(null)
    try {
      const { institution } = await registryApi.addInstitution({ name: draft.name, type, regionId: draft.region })
      const option = fromApi(institution, lang)
      setPickedInfo(option)
      onChange({ id: option.id, name: option.name, region: option.region || draft.region })
      setAdding(false)
    } catch (err) {
      setAddError(apiErrorText(err, lang))
    } finally {
      setSaving(false)
    }
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, Math.max(count - 1, 0))) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter' && show && count) { e.preventDefault(); pick(active) }
    else if (e.key === 'Escape') setOpen(false)
  }
  const optionId = (i: number) => `${listId}-o${i}`

  if (adding) {
    // On the sign-up page the typed institution is the value itself; on signed-in pages it is a draft until it is added.
    const name = local ? value?.name ?? '' : draft.name
    const reg = local ? value?.region ?? '' : draft.region
    const setName = (v: string) => (local ? onChange({ name: v, region: reg }) : setDraft({ name: v, region: reg }))
    const setReg = (v: string) => (local ? onChange({ name, region: v }) : setDraft({ name, region: v }))
    return (
      <div className="space-y-3 rounded-control border border-champagne/50 bg-paper p-3.5">
        <p className="flex items-start gap-2 text-xs leading-relaxed text-charcoal/65"><Icon name="plus" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-champagne" />{t('q.institutionAddHint')}</p>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-charcoal/70">{t('q.institutionName')}</span>
          <Input id={id} maxLength={200} value={name} aria-invalid={invalid} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-charcoal/70">{t('auth.org.region')}</span>
          <Select value={reg} aria-invalid={invalid} onChange={(e) => setReg(e.target.value)} className={reg ? undefined : 'text-charcoal/40'}>
            <option value="" disabled>{t('auth.org.regionPlaceholder')}</option>
            {UZ_REGIONS.map((r) => <option key={r.id} value={r.id} className="text-charcoal">{r.name[lang]}</option>)}
          </Select>
        </label>
        {addError && <p className="text-xs text-red-700" role="alert">{addError}</p>}
        <div className="flex flex-wrap items-center gap-3">
          {!local && (
            <Button type="button" size="sm" disabled={saving || !type || name.trim().length < 2 || !reg} onClick={() => void addToRegistry()}>
              {saving ? <Icon name="refresh" className="h-3.5 w-3.5 animate-spin" /> : <Icon name="plus" className="h-3.5 w-3.5" />}{t('q.institutionAddButton')}
            </Button>
          )}
          <button type="button" className="text-xs font-medium text-forest underline" onClick={() => { setAdding(false); setQuery(name); if (local) onChange(null) }}>
            {t('q.institutionSearch')}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <Select aria-label={t('auth.org.region')} value={region} onChange={(e) => { setRegion(e.target.value); if (picked && e.target.value && picked.region && picked.region !== e.target.value) onChange(null) }} className={cx('py-2 text-xs', !region && 'text-charcoal/50')}>
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
          aria-activedescendant={show && count ? optionId(active) : undefined}
          aria-invalid={invalid}
          aria-busy={(!local && remote.status === 'loading') || undefined}
          autoComplete="off"
          maxLength={200}
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
        {show && (local || query.trim().length > 0) && (
          <ul id={listId} role="listbox" className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-control border border-charcoal/12 bg-paper py-1 shadow-lift">
            {!local && !remote.enough && <li className="px-3.5 py-2.5 text-xs text-charcoal/55">{t('dir.typeMore')}</li>}
            {!local && remote.enough && remote.status === 'loading' && options.length === 0 && <li className="flex items-center gap-2 px-3.5 py-2.5 text-xs text-charcoal/55"><Icon name="refresh" className="h-3.5 w-3.5 animate-spin" />{t('dir.searching')}</li>}
            {!local && remote.status === 'error' && <li className="px-3.5 py-2.5 text-xs text-red-700">{t('dir.searchFailed')}</li>}
            {options.map((m, i) => (
              <li key={m.id} id={optionId(i)} role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(i)} onClick={() => pick(i)} className={cx('cursor-pointer px-3.5 py-2', i === active && 'bg-sage/50')}>
                <div className="text-sm text-charcoal">
                  {m.name}
                  {m.addedByStudent && <Badge tone="champagne" className="ml-2 align-middle">{t('inst.addedByStudent')}</Badge>}
                  {lang === 'ru' && m.nameRu && <span className="block text-xs text-charcoal/60">{m.nameRu}</span>}
                  {m.formerName && matchesFormerNameOnly({ name: m.name, nameRu: m.nameRu ?? undefined, formerName: m.formerName }, query) && <span className="block text-xs text-champagne">{t('auth.org.formerName', { name: m.formerName })}</span>}
                </div>
                <div className="mt-0.5 text-[11px] text-charcoal/50">{[!region && m.region && regionName(m.region), m.district].filter(Boolean).join(' · ')}</div>
              </li>
            ))}
            {local && localFound.length > SHOWN && <li className="px-3.5 py-2 text-[11px] text-charcoal/50">{t('auth.org.technikumMore', { n: SHOWN })}</li>}
            {options.length === 0 && (local || remote.status === 'ready') && <li className="px-3.5 py-2.5 text-xs text-charcoal/60">{t('auth.org.technikumNoMatch')}</li>}
            {showAdd && (
              <li id={optionId(options.length)} role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setActive(options.length)} onClick={() => pick(options.length)} className={cx('mt-1 flex cursor-pointer items-center gap-2 border-t border-charcoal/8 px-3.5 py-2.5 text-xs font-medium text-forest', active === options.length && 'bg-sage/50')}>
                <Icon name="plus" className="h-3.5 w-3.5" />{t('q.institutionAdd')}
              </li>
            )}
          </ul>
        )}
      </div>
      {picked && (
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-forest">
          <Icon name="check" className="h-3.5 w-3.5" />{t('q.institutionPicked')}{picked.region && ` · ${regionName(picked.region)}`}
          {picked.addedByStudent && <Badge tone="champagne">{t('inst.addedByStudent')}</Badge>}
        </p>
      )}
    </div>
  )
}
