'use client'
import { useEffect, useState, type ReactNode } from 'react'
import type { DistrictDto, InstitutionPassportDto, InstitutionRequiredField } from '@ilmora/shared'
import type { TKey } from '../../i18n/translations'
import { DirectionField } from '../../components/DirectionField'
import { Button, Card, Field, Icon, Input, Notice, PageTitle, Select } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { isApiError } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import {
  directionProblems, directionRows, institutionApi, MISSING_FIELD, passportForm, passportPatch, reviewedChanged, type DirectionRow, type PassportForm,
} from '../../services/institutionCabinet'
import { INSTITUTION_TYPES, OWNERSHIPS } from '../../services/ministry'
import { useRegions } from '../../services/registry'
import { useStore } from '../../store/useStore'
import { setPassport, usePassport } from './passportStore'

/** Labels of the required fields, for «Не заполнено: …» after `incomplete_profile`. */
const REQUIRED_LABEL: Record<InstitutionRequiredField, TKey> = {
  type: 'rev.type', ownership: 'auth.org.ownershipLabel', name: 'inst.p.name', stir: 'auth.org.stir', regionId: 'min.filter.region', districtId: 'inst.p.district',
  address: 'min.inst.address', phone: 'inst.c.phone', directorName: 'rev.director', directions: 'inst.p.directions', representativeName: 'auth.org.repName',
  representativeJobTitle: 'auth.position',
}

/**
 * The institution's passport (ТЗ 4.2): the profile, the fields of study with their students, «Отправить на проверку».
 * While the first review runs the profile is read-only; after approval key fields go to the Super Admin by themselves.
 */
export function InstitutionPassport() {
  const { t, tr, lang } = useT()
  const notify = useStore((s) => s.notify)
  const { passport, error } = usePassport()
  const regions = useRegions()
  // The form starts from the passport and again after every save (the passport object changes then).
  const [base, setBase] = useState<InstitutionPassportDto | null>(null)
  const [form, setForm] = useState<PassportForm | null>(null)
  const [rows, setRows] = useState<DirectionRow[]>([])
  if (passport && passport !== base) { setBase(passport); setForm(passportForm(passport)); setRows(directionRows(passport)) }
  const [districts, setDistricts] = useState<{ region: string; list: DistrictDto[] } | null>(null)
  const [missing, setMissing] = useState<InstitutionRequiredField[]>([])
  const [busy, setBusy] = useState<'save' | 'dirs' | 'submit' | null>(null)
  const [failure, setFailure] = useState<unknown>(null)
  const [touchedDirs, setTouchedDirs] = useState(false)

  const regionId = form?.regionId ?? ''
  useEffect(() => {
    if (!regionId) return
    let live = true
    institutionApi.districts(regionId).then((list) => { if (live) setDistricts({ region: regionId, list }) }, () => { if (live) setDistricts({ region: regionId, list: [] }) })
    return () => { live = false }
  }, [regionId])

  if (error != null) return <Notice tone="warn">{apiErrorText(error, lang)}</Notice>
  if (!passport || !form || !base) return <p className="text-sm text-charcoal/55" role="status">{t('common.loading')}</p>

  const before = passportForm(base)
  const editable = passport.editable && !passport.blocked
  const set = <K extends keyof PassportForm>(k: K, v: PassportForm[K]) => { setForm({ ...form, [k]: v, ...(k === 'regionId' ? { districtId: '' } : {}) }); setMissing([]) }
  const patch = passportPatch(form, before)
  const dirsChanged = JSON.stringify(rows) !== JSON.stringify(directionRows(base))
  const problems = directionProblems(rows)
  const districtList = districts?.region === regionId ? [...districts.list].sort((a, b) => a.name[lang].localeCompare(b.name[lang], lang)) : []
  const miss = (f: keyof PassportForm | 'directions') => missing.some((m) => MISSING_FIELD[m] === f)

  const savePassport = async () => {
    if (!Object.keys(patch).length) return passport
    const saved = await institutionApi.update(patch)
    setPassport(saved)
    return saved
  }
  const saveDirections = async () => {
    if (!dirsChanged) return passport
    const saved = await institutionApi.setDirections(rows)
    setPassport(saved)
    return saved
  }
  const run = async (kind: 'save' | 'dirs' | 'submit') => {
    setBusy(kind); setFailure(null); setMissing([])
    try {
      if (kind === 'dirs') {
        setTouchedDirs(true)
        if (Object.keys(problems).length) return
        await saveDirections(); notify(t('common.saved'))
      } else if (kind === 'save') {
        const reviewed = passport.approvedAt && reviewedChanged(patch)
        await savePassport(); notify(t(reviewed ? 'inst.p.savedReview' : 'common.saved'))
      } else {
        setTouchedDirs(true)
        if (Object.keys(problems).length) return
        await savePassport(); await saveDirections()
        setPassport(await institutionApi.submit()); notify(t('inst.p.submitted'))
      }
    } catch (e) {
      const list = isApiError(e) && e.code === 'incomplete_profile' ? (e.details as { missing?: InstitutionRequiredField[] } | undefined)?.missing : undefined
      if (list?.length) setMissing(list)
      else setFailure(e)
    } finally {
      setBusy(null)
    }
  }

  const banner = passport.blocked ? { tone: 'warn' as const, text: t('inst.p.blocked') }
    : passport.status === 'REJECTED' ? { tone: 'warn' as const, text: t('inst.p.status.REJECTED', { reason: passport.rejectReason ?? '—' }) }
      : passport.status === 'PENDING' && !passport.approvedAt ? { tone: 'info' as const, text: t('inst.p.status.PENDING') }
        : passport.approvedAt ? { tone: 'ok' as const, text: t('inst.p.status.APPROVED') }
          : { tone: 'info' as const, text: t('inst.p.status.DRAFT') }
  const canSubmit = editable && (passport.status === 'DRAFT' || passport.status === 'REJECTED')
  const input = (k: keyof PassportForm, props: { type?: string; maxLength?: number; placeholder?: string; inputMode?: 'tel' | 'email' | 'url' | 'numeric' } = {}) => (
    <Input value={form[k]} disabled={!editable} aria-invalid={miss(k)} onChange={(e) => set(k, e.target.value as never)} {...props} />
  )

  return (
    <div>
      <PageTitle eyebrow={t('dash.institution')} title={passport.name || t('inst.p.title')} subtitle={t('inst.p.title')} />
      <Notice tone={banner.tone} className="mb-3">{banner.text}</Notice>
      {passport.pendingChanges && <Notice className="mb-3">{t('inst.p.pendingChanges')}</Notice>}
      {missing.length > 0 && <Notice tone="warn" className="mb-3">{t('inst.p.missing', { fields: missing.map((m) => t(REQUIRED_LABEL[m])).join(', ') })}</Notice>}
      {failure != null && <Notice tone="warn" className="mb-3">{apiErrorText(failure, lang)}</Notice>}

      <Card className="mb-6">
        <div className="grid gap-4 md:grid-cols-2">
          <Row label={t('inst.p.name')} required wide>{input('name', { maxLength: 200 })}</Row>
          <Row label={t('rev.type')} required>
            <Select value={form.type} disabled={!editable} onChange={(e) => set('type', e.target.value as PassportForm['type'])}>
              {INSTITUTION_TYPES.map((x) => <option key={x} value={x}>{t(`inst.type.${x}`)}</option>)}
            </Select>
          </Row>
          <Row label={t('auth.org.ownershipLabel')} required>
            <Select value={form.ownership} disabled={!editable} aria-invalid={miss('ownership')} onChange={(e) => set('ownership', e.target.value as PassportForm['ownership'])}>
              <option value="" disabled>—</option>
              {OWNERSHIPS.map((x) => <option key={x} value={x}>{t(`min.own.${x}`)}</option>)}
            </Select>
          </Row>
          <Row label={t('auth.org.stir')} required>{input('stir', { inputMode: 'numeric', maxLength: 9 })}</Row>
          <Row label={t('inst.c.phone')} required>{input('phone', { inputMode: 'tel', maxLength: 30, placeholder: '+998 71 123 45 67' })}</Row>
          <Row label={t('min.filter.region')} required>
            <Select value={form.regionId} disabled={!editable} aria-invalid={miss('regionId')} onChange={(e) => set('regionId', e.target.value)}>
              <option value="" disabled>—</option>
              {regions.map((r) => <option key={r.id} value={r.id}>{tr(r.name)}</option>)}
            </Select>
          </Row>
          <Row label={t('inst.p.district')} required>
            {/* The official districts of the region (SOATO); cities of district status are entries of their own. */}
            <Select value={form.districtId} disabled={!editable || !form.regionId} aria-invalid={miss('districtId')} onChange={(e) => set('districtId', e.target.value)}>
              <option value="" disabled>{form.regionId ? t('inst.p.chooseDistrict') : t('inst.p.regionFirst')}</option>
              {districtList.map((d) => <option key={d.id} value={d.id}>{d.name[lang]}</option>)}
            </Select>
            {!form.districtId && passport.districtName && <p className="mt-1.5 text-xs text-amber-800">{t('inst.p.ministryDistrict', { name: passport.districtName })}</p>}
          </Row>
          <Row label={t('min.inst.address')} required wide>{input('address', { maxLength: 300 })}</Row>
          <Row label={t('rev.director')} required>{input('directorName', { maxLength: 120 })}</Row>
          <Row label={t('inst.p.email')}>{input('email', { inputMode: 'email', maxLength: 120, placeholder: 'info@texnikum.uz' })}</Row>
          <Row label={t('rev.website')}>{input('website', { inputMode: 'url', maxLength: 200, placeholder: 'https://' })}</Row>
          <Row label={t('auth.org.repName')} required>{input('repName', { maxLength: 120 })}</Row>
          <Row label={t('auth.position')} required>{input('repJobTitle', { maxLength: 80 })}</Row>
        </div>
        {editable && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-charcoal/10 pt-4">
            <p className="max-w-xl text-xs text-charcoal/55">{passport.approvedAt ? t('inst.p.reviewedHint') : null}</p>
            <Button variant="secondary" disabled={busy !== null || !Object.keys(patch).length} onClick={() => void run('save')}>
              {busy === 'save' ? <Icon name="refresh" className="h-4 w-4 animate-spin" /> : <Icon name="check" className="h-4 w-4" />}{t('inst.p.save')}
            </Button>
          </div>
        )}
      </Card>

      <Card className={miss('directions') ? 'ring-2 ring-amber-300' : undefined}>
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-xl text-charcoal">{t('inst.p.directions')}</h2>
          <span className="text-xs text-charcoal/55">{t('min.inst.totals', { students: passport.totals.students, directions: passport.totals.directions })}</span>
        </div>
        <p className="mb-4 text-xs text-charcoal/55">{t('inst.p.directionsHint')}</p>
        <ul className="space-y-3">
          {rows.map((r, i) => (
            <li key={i} className="grid gap-2 rounded-control border border-charcoal/10 p-3 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_8rem_auto] md:items-start">
              <div>
                <span className="sr-only">{t('inst.p.direction')}</span>
                {editable
                  ? <DirectionField value={r.directionId ? { id: r.directionId, name: r.name, industryId: r.industryId } : null} invalid={touchedDirs && !!problems[i]}
                    onChange={(v) => setRows(rows.map((x, j) => (j === i ? { ...x, directionId: v?.id ?? '', name: v?.name ?? '', industryId: v?.industryId } : x)))} />
                  : <div className="py-2 text-sm font-medium text-charcoal">{r.name}</div>}
                {touchedDirs && problems[i] && <p className="mt-1 text-xs text-red-700" role="alert">{t(`inst.p.dir.${problems[i]}`)}</p>}
              </div>
              <Input aria-label={t('inst.p.department')} placeholder={t('inst.p.department')} value={r.department} maxLength={120} disabled={!editable}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, department: e.target.value } : x)))} />
              <Input aria-label={t('inst.p.studentsCount')} placeholder={t('inst.p.studentsCount')} inputMode="numeric" value={r.studentsCount} disabled={!editable}
                onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, studentsCount: e.target.value.replace(/\D/g, '').slice(0, 6) } : x)))} />
              {editable && <Button size="sm" variant="ghost" aria-label={t('inst.p.removeDirection')} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Icon name="trash" className="h-4 w-4" /></Button>}
            </li>
          ))}
        </ul>
        {editable && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <Button size="sm" variant="ghost" onClick={() => setRows([...rows, { directionId: '', name: '', department: '', studentsCount: '' }])}><Icon name="plus" className="h-4 w-4" />{t('inst.p.addDirection')}</Button>
            <div className="flex items-center gap-3">
              {dirsChanged && <span className="text-xs text-amber-800">{t('inst.p.unsavedDirections')}</span>}
              <Button variant="secondary" disabled={busy !== null || !dirsChanged} onClick={() => void run('dirs')}>
                {busy === 'dirs' ? <Icon name="refresh" className="h-4 w-4 animate-spin" /> : <Icon name="check" className="h-4 w-4" />}{t('inst.p.saveDirections')}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {canSubmit && (
        <div className="mt-6 flex justify-end">
          <Button disabled={busy !== null} onClick={() => void run('submit')}>
            {busy === 'submit' ? <Icon name="refresh" className="h-4 w-4 animate-spin" /> : <Icon name="arrowRight" className="h-4 w-4" />}{t('inst.p.submit')}
          </Button>
        </div>
      )}
    </div>
  )
}

function Row({ label, required, wide, children }: { label: string; required?: boolean; wide?: boolean; children: ReactNode }) {
  return <Field label={label} required={required} className={wide ? 'md:col-span-2' : undefined}>{children}</Field>
}
