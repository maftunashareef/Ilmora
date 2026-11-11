'use client'
import { useId, useMemo } from 'react'
import { registryDistrictNames, UZ_REGIONS } from '@ilmora/shared'
import { useT } from '@/i18n/useT'
import { Field, Input, Select } from './ui'

/**
 * Region and district (ТЗ 3.4). The student's district is stored as text (the API takes it so); the suggestions are the
 * region's districts from the official list of the Statistics Agency (SOATO, in @ilmora/shared — no request needed),
 * in the reader's language, cities of district status included.
 */
export function RegionDistrictField({ region, district, onRegion, onDistrict, regionError, districtError }: {
  region: string
  district: string
  onRegion: (v: string) => void
  onDistrict: (v: string) => void
  regionError?: string
  districtError?: string
}) {
  const { t, lang } = useT()
  const listId = useId()
  const known = useMemo(() => registryDistrictNames(region, lang), [region, lang])
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label={t('auth.org.region')} required>
        <Select value={region} onChange={(e) => onRegion(e.target.value)} aria-invalid={!!regionError} className={region ? undefined : 'text-charcoal/40'}>
          <option value="" disabled>{t('auth.org.regionPlaceholder')}</option>
          {UZ_REGIONS.map((r) => <option key={r.id} value={r.id} className="text-charcoal">{r.name[lang]}</option>)}
        </Select>
        {regionError && <p className="mt-1.5 text-xs text-red-700" role="alert">{regionError}</p>}
      </Field>
      <Field label={t('q.district')} required>
        <Input list={listId} maxLength={80} placeholder={t('q.districtPlaceholder')} value={district} onChange={(e) => onDistrict(e.target.value)} aria-invalid={!!districtError} />
        <datalist id={listId}>{known.map((d) => <option key={d} value={d} />)}</datalist>
        {districtError && <p className="mt-1.5 text-xs text-red-700" role="alert">{districtError}</p>}
      </Field>
    </div>
  )
}
