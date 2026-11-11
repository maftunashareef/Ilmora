'use client'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { CompanyProfileDto, CompanyRequiredField, DistrictDto } from '@ilmora/shared'
import { DirectionField } from '../../components/DirectionField'
import { Badge, Button, Card, Field, FieldGroup, Icon, Input, Notice, PageTitle, Select, Textarea } from '../../components/ui'
import type { TKey } from '../../i18n/translations'
import { useT } from '../../i18n/useT'
import { isApiError } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import { certificateProblem, COMPANY_MISSING_LABEL, companyApi, companyForm, companyPatch, companyReviewedChanged, type CompanyForm } from '../../services/companyCabinet'
import { institutionApi } from '../../services/institutionCabinet'
import { useIndustries, useRegions } from '../../services/registry'
import { useStore } from '../../store/useStore'
import { setCompany, useCompany } from './companyStore'

/**
 * The company's profile (ТЗ 4.3): name, STIR, region and district, address, website, about, industries, optional
 * fields of study, the representative, the state-registration certificate; «Сохранить и отправить на проверку».
 */
export function CompanyProfile() {
  const { t, tr, lang } = useT()
  const directionId = useId()
  const notify = useStore((s) => s.notify)
  const { profile, error } = useCompany()
  const regions = useRegions()
  const industries = useIndustries()
  const [base, setBase] = useState<CompanyProfileDto | null>(null)
  const [form, setForm] = useState<CompanyForm | null>(null)
  if (profile && profile !== base) { setBase(profile); setForm(companyForm(profile)) }
  const [districts, setDistricts] = useState<{ region: string; list: DistrictDto[] } | null>(null)
  const [missing, setMissing] = useState<CompanyRequiredField[]>([])
  const [busy, setBusy] = useState<'save' | 'submit' | 'cert' | 'open' | null>(null)
  const [failure, setFailure] = useState<unknown>(null)
  const [certError, setCertError] = useState<string | null>(null)
  const file = useRef<HTMLInputElement>(null)

  const regionId = form?.regionId ?? ''
  useEffect(() => {
    if (!regionId) return
    let live = true
    institutionApi.districts(regionId).then((list) => { if (live) setDistricts({ region: regionId, list }) }, () => { if (live) setDistricts({ region: regionId, list: [] }) })
    return () => { live = false }
  }, [regionId])

  if (error != null) return <Notice tone="warn">{apiErrorText(error, lang)}</Notice>
  if (!profile || !form || !base) return <p className="text-sm text-charcoal/55" role="status">{t('common.loading')}</p>

  const editable = profile.editable && !profile.blocked
  const patch = companyPatch(form, companyForm(base))
  const set = <K extends keyof CompanyForm>(k: K, v: CompanyForm[K]) => { setForm({ ...form, [k]: v, ...(k === 'regionId' ? { districtId: '' } : {}) }); setMissing([]) }
  const miss = (f: CompanyRequiredField) => missing.includes(f)
  const districtList = districts?.region === regionId ? [...districts.list].sort((a, b) => a.name[lang].localeCompare(b.name[lang], lang)) : []

  const save = async () => {
    if (!Object.keys(patch).length) return
    setCompany(await companyApi.update(patch))
  }
  const run = async (kind: 'save' | 'submit') => {
    setBusy(kind); setFailure(null); setMissing([])
    try {
      if (kind === 'save') {
        const reviewed = profile.approvedAt && companyReviewedChanged(patch)
        await save(); notify(t(reviewed ? 'inst.p.savedReview' : 'common.saved'))
      } else {
        await save(); setCompany(await companyApi.submit()); notify(t('inst.p.submitted'))
      }
    } catch (e) {
      const list = isApiError(e) && e.code === 'incomplete_profile' ? (e.details as { missing?: CompanyRequiredField[] } | undefined)?.missing : undefined
      if (list?.length) setMissing(list)
      else setFailure(e)
    } finally {
      setBusy(null)
    }
  }
  const upload = async (f: File | undefined) => {
    if (file.current) file.current.value = ''
    if (!f) return
    const problem = certificateProblem(f)
    if (problem) { setCertError(t(problem === 'type' ? 'co.p.certType' : 'co.p.certSize')); return }
    setCertError(null); setBusy('cert')
    try { setCompany(await companyApi.uploadCertificate(f)); notify(t('co.p.certDone')) } catch (e) { setCertError(apiErrorText(e, lang)) } finally { setBusy(null) }
  }
  const openCertificate = async () => {
    setBusy('open')
    try { window.open((await companyApi.certificateLink()).url, '_blank', 'noopener,noreferrer') } catch (e) { notify(apiErrorText(e, lang), 'warn') } finally { setBusy(null) }
  }

  const banner = profile.blocked ? { tone: 'warn' as const, text: t('co.p.blocked') }
    : profile.status === 'REJECTED' ? { tone: 'warn' as const, text: t('inst.p.status.REJECTED', { reason: profile.rejectReason ?? '—' }) }
      : profile.status === 'PENDING' && !profile.approvedAt ? { tone: 'info' as const, text: t('inst.p.status.PENDING') }
        : profile.approvedAt ? { tone: 'ok' as const, text: t('co.p.status.APPROVED') }
          : { tone: 'info' as const, text: t('co.p.status.DRAFT') }
  const canSubmit = editable && (profile.status === 'DRAFT' || profile.status === 'REJECTED')
  const text = (k: 'name' | 'stir' | 'address' | 'website' | 'repName' | 'repJobTitle' | 'repEmail', props: { maxLength?: number; placeholder?: string; inputMode?: 'numeric' | 'url' | 'email' } = {}, invalid = false) => (
    <Input value={form[k]} disabled={!editable} aria-invalid={invalid} onChange={(e) => set(k, e.target.value)} {...props} />
  )

  return (
    <div>
      <PageTitle eyebrow={t('dash.company')} title={profile.name || t('co.p.title')} subtitle={t('co.p.title')} />
      <Notice tone={banner.tone} className="mb-3">{banner.text}</Notice>
      {profile.pendingChanges && <Notice className="mb-3">{t('inst.p.pendingChanges')}</Notice>}
      {missing.length > 0 && <Notice tone="warn" className="mb-3">{t('inst.p.missing', { fields: missing.map((m) => t(COMPANY_MISSING_LABEL[m] as TKey)).join(', ') })}</Notice>}
      {failure != null && <Notice tone="warn" className="mb-3">{apiErrorText(failure, lang)}</Notice>}

      <Card className="mb-6">
        <div className="grid gap-4 md:grid-cols-2">
          <Row label={t('inst.p.name')} required wide>{text('name', { maxLength: 200 }, miss('name'))}</Row>
          <Row label={t('auth.org.stir')} required>{text('stir', { inputMode: 'numeric', maxLength: 9 }, miss('stir'))}</Row>
          <Row label={t('rev.website')}>{text('website', { inputMode: 'url', maxLength: 200, placeholder: 'https://' })}</Row>
          <Row label={t('min.filter.region')} required>
            <Select value={form.regionId} disabled={!editable} aria-invalid={miss('regionId')} onChange={(e) => set('regionId', e.target.value)}>
              <option value="" disabled>—</option>
              {regions.map((r) => <option key={r.id} value={r.id}>{tr(r.name)}</option>)}
            </Select>
          </Row>
          <Row label={t('inst.p.district')}>
            <Select value={form.districtId} disabled={!editable || !form.regionId} onChange={(e) => set('districtId', e.target.value)}>
              <option value="">{form.regionId ? t('inst.p.chooseDistrict') : t('inst.p.regionFirst')}</option>
              {districtList.map((d) => <option key={d.id} value={d.id}>{d.name[lang]}</option>)}
            </Select>
          </Row>
          <Row label={t('min.inst.address')} required wide>{text('address', { maxLength: 300 }, miss('address'))}</Row>
          <Row label={t('co.p.about')} wide><Textarea rows={4} maxLength={2000} value={form.about} disabled={!editable} onChange={(e) => set('about', e.target.value)} /></Row>
          <Row label={t('rev.industries')} required wide group>
            <p className="mb-2 text-xs text-charcoal/55">{t('co.p.industriesHint')}</p>
            <div className={`flex flex-wrap gap-2 ${miss('industries') ? 'rounded-control ring-2 ring-amber-300 p-1' : ''}`} >
              {industries.list.map((i) => {
                const on = form.industryIds.includes(i.id)
                return (
                  <button key={i.id} type="button" disabled={!editable} aria-pressed={on} onClick={() => set('industryIds', on ? form.industryIds.filter((x) => x !== i.id) : [...form.industryIds, i.id])}
                    className={`rounded-full border px-3 py-1.5 text-xs transition ${on ? 'border-forest bg-forest text-ivory' : 'border-charcoal/15 text-charcoal/70 hover:border-forest/50'} disabled:opacity-60`}>
                    {tr(i.name)}
                  </button>
                )
              })}
            </div>
          </Row>
          <Row label={t('co.p.directions')} wide group htmlFor={directionId}>
            <p className="mb-2 text-xs text-charcoal/55">{t('co.p.directionsHint')}</p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {form.directions.map((d) => (
                <Badge key={d.id} tone="sage">{d.name}{editable && <button type="button" aria-label={t('inst.p.removeDirection')} className="ml-1" onClick={() => set('directions', form.directions.filter((x) => x.id !== d.id))}><Icon name="x" className="h-3 w-3" /></button>}</Badge>
              ))}
            </div>
            {editable && <DirectionField id={directionId} value={null} onChange={(v) => { if (v?.id && !form.directions.some((x) => x.id === v.id)) set('directions', [...form.directions, { id: v.id, name: v.name }]) }} />}
          </Row>
          <Row label={t('auth.org.repName')} required>{text('repName', { maxLength: 120 }, miss('representativeName'))}</Row>
          <Row label={t('auth.position')} required>{text('repJobTitle', { maxLength: 80 }, miss('representativeJobTitle'))}</Row>
          <Row label={t('co.p.repEmail')}>{text('repEmail', { inputMode: 'email', maxLength: 120, placeholder: 'hr@company.uz' })}</Row>
        </div>
        {editable && (
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-charcoal/10 pt-4">
            <p className="max-w-xl text-xs text-charcoal/55">{profile.approvedAt ? t('co.p.reviewedHint') : null}</p>
            <Button variant="secondary" disabled={busy !== null || !Object.keys(patch).length} onClick={() => void run('save')}>
              {busy === 'save' ? <Icon name="refresh" className="h-4 w-4 animate-spin" /> : <Icon name="check" className="h-4 w-4" />}{t('inst.p.save')}
            </Button>
          </div>
        )}
      </Card>

      <Card className={miss('certificate') ? 'ring-2 ring-amber-300' : undefined}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl text-charcoal">{t('co.p.certificate')}</h2>
            <p className="mt-1 text-xs text-charcoal/55">{t('co.p.certHint')}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={profile.certificateUploaded ? 'forest' : 'muted'}>{t(profile.certificateUploaded ? 'co.p.certUploaded' : 'co.p.certNone')}</Badge>
            {profile.certificateUploaded && <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void openCertificate()}><Icon name="external" className="h-3.5 w-3.5" />{t('co.p.certOpen')}</Button>}
            {editable && (
              <>
                <input ref={file} type="file" accept="application/pdf,image/jpeg,image/png" className="sr-only" aria-label={t('co.p.certUpload')} onChange={(e) => void upload(e.target.files?.[0])} />
                <Button size="sm" variant="secondary" disabled={busy !== null} onClick={() => file.current?.click()}>
                  <Icon name={busy === 'cert' ? 'refresh' : 'upload'} className={busy === 'cert' ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />{t(profile.certificateUploaded ? 'co.p.certReplace' : 'co.p.certUpload')}
                </Button>
              </>
            )}
          </div>
        </div>
        {certError && <Notice tone="warn" className="mt-3">{certError}</Notice>}
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

function Row({ label, required, wide, group, htmlFor, children }: { label: string; required?: boolean; wide?: boolean; group?: boolean; htmlFor?: string; children: ReactNode }) {
  const className = wide ? 'md:col-span-2' : undefined
  if (group) return <FieldGroup label={label} required={required} className={className} htmlFor={htmlFor}>{children}</FieldGroup>
  return <Field label={label} required={required} className={className}>{children}</Field>
}
