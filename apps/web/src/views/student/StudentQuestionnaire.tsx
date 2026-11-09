'use client'
import { useState, type ReactNode } from 'react'
import {
  ABOUT_MAX, APPLYING_TYPES, EMPTY_QUESTIONNAIRE, firstIncompleteStep, INSTITUTION_REGISTRY, isMinor, maxCourse, QUESTIONNAIRE_STEPS,
  STUDYING_TYPES, UZ_REGIONS, validateQuestionnaireStep, type InstitutionType, type PlannedStudyForm, type QuestionnaireErrors,
  type StudentQuestionnaire as Questionnaire, type StudyStatus,
} from '@ilmora/shared'
import { DirectionField } from '../../components/DirectionField'
import { InstitutionSearch } from '../../components/InstitutionSearch'
import { RegionDistrictField } from '../../components/RegionDistrictField'
import { Badge, Button, Card, cx, Field, Icon, Input, LinkButton, Notice, PageTitle, Select, Textarea } from '../../components/ui'
import type { TKey } from '../../i18n/translations'
import { useT } from '../../i18n/useT'
import { apiErrorText } from '../../lib/apiErrors'
import { saveQuestionnaire, useQuestionnaire, type QuestionnaireState } from '../../services/questionnaire'
import { useStore } from '../../store/useStore'

/**
 * Section 8 consents shown on step 4 (texts and which are required come with section 8; every mark starts unticked).
 * Empty until then: the step explains that the marks will appear here.
 */
const STUDENT_CONSENTS: readonly { key: string; label: TKey; required: boolean }[] = []
const REQUIRED_CONSENTS = STUDENT_CONSENTS.filter((c) => c.required).map((c) => c.key)
const STEP_TITLES: TKey[] = ['q.step.status', 'q.step.study', 'q.step.person', 'q.step.consents']
const STATUS_ICON: Record<StudyStatus, string> = { STUDYING: 'cap', APPLYING: 'arrowRight' }

const digits = (s: string) => s.replace(/\D/g, '')
const groupThousands = (n: number | null) => (n === null ? '' : String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '))

/** The student questionnaire (ТЗ 4.1), step by step; once saved it shows a summary that can be edited again. */
export function StudentQuestionnaire() {
  const { t } = useT()
  const { data, status, setData, reload } = useQuestionnaire()
  if (status === 'error') {
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        <Notice tone="warn">{t('apiError.unavailable')}</Notice>
        <Button variant="secondary" onClick={() => void reload()}><Icon name="refresh" className="h-4 w-4" />{t('q.retry')}</Button>
      </div>
    )
  }
  if (status === 'loading' || !data) {
    return <div className="flex min-h-[40vh] items-center justify-center text-sm text-charcoal/55" role="status"><Icon name="refresh" className="mr-2 h-4 w-4 animate-spin" />{t('auth.checking')}</div>
  }
  return <Wizard initial={data} onSaved={setData} />
}

function Wizard({ initial, onSaved }: { initial: QuestionnaireState; onSaved: (s: QuestionnaireState) => void }) {
  const { t, lang } = useT()
  const notify = useStore((s) => s.notify)
  const [q, setQ] = useState<Questionnaire>(() => ({ ...EMPTY_QUESTIONNAIRE, ...initial.questionnaire }))
  const [confirmed, setConfirmed] = useState(initial.studyConfirmed)
  const [step, setStep] = useState(1)
  const [editing, setEditing] = useState(!initial.complete)
  const [errors, setErrors] = useState<QuestionnaireErrors>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const today = new Date()
  const year = today.getUTCFullYear()

  /** Changes fields and clears the errors shown for them. */
  const patch = (p: Partial<Questionnaire>) => {
    setQ((prev) => ({ ...prev, ...p }))
    setErrors((e) => { const n = { ...e }; for (const k of Object.keys(p)) delete n[k as keyof QuestionnaireErrors]; return n })
  }
  const set = <K extends keyof Questionnaire>(key: K, value: Questionnaire[K]) => patch({ [key]: value } as Partial<Questionnaire>)
  const err = (k: keyof QuestionnaireErrors) => (errors[k] ? <p className="mt-1.5 text-xs text-red-700" role="alert">{t(errors[k]!)}</p> : null)
  const goTo = (s: number) => { setStep(s); setErrors({}); window.scrollTo?.({ top: 0, behavior: 'smooth' }) }

  const next = async () => {
    const e = validateQuestionnaireStep(step, q, today, REQUIRED_CONSENTS)
    setErrors(e)
    if (Object.keys(e).length) return
    if (step < QUESTIONNAIRE_STEPS) { goTo(step + 1); return }
    const firstBad = firstIncompleteStep(q, today, REQUIRED_CONSENTS)
    if (firstBad) { goTo(firstBad); return }
    setSaving(true); setSaveError(null)
    try {
      const saved = await saveQuestionnaire(q)
      onSaved(saved)
      setConfirmed(saved.studyConfirmed)
      notify(t('q.saved'))
      setEditing(false)
    } catch (e2) {
      setSaveError(apiErrorText(e2, lang))
    } finally {
      setSaving(false)
    }
  }

  if (!editing) return <Summary q={q} confirmed={confirmed} onEdit={() => { setEditing(true); goTo(1) }} />

  const studying = q.status === 'STUDYING'
  const school = q.institutionType === 'SCHOOL'
  const types = studying ? STUDYING_TYPES : APPLYING_TYPES
  const minor = isMinor(q, today)

  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle eyebrow={t('dash.studentSpace')} title={t('q.title')} subtitle={t('q.subtitle')} />

      <ol className="mb-5 grid grid-cols-4 gap-1.5" aria-label={t('q.stepOf', { n: step, total: QUESTIONNAIRE_STEPS })}>
        {STEP_TITLES.map((title, i) => (
          <li key={title} aria-current={step === i + 1 ? 'step' : undefined}>
            <div className={cx('h-1.5 rounded-full', i + 1 < step ? 'bg-forest' : i + 1 === step ? 'bg-champagne' : 'bg-charcoal/10')} />
            <p className={cx('mt-1.5 truncate text-[11px]', i + 1 === step ? 'font-semibold text-charcoal' : 'text-charcoal/50')}>{t(title)}</p>
          </li>
        ))}
      </ol>

      <Card className="space-y-5 p-5 sm:p-7">
        <p className="text-xs font-medium uppercase tracking-wider text-charcoal/45">{t('q.stepOf', { n: step, total: QUESTIONNAIRE_STEPS })}</p>

        {step === 1 && (
          <fieldset>
            <legend className="mb-3 font-display text-2xl text-charcoal">{t('q.status.question')}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {(['STUDYING', 'APPLYING'] as const).map((s) => (
                <button key={s} type="button" aria-pressed={q.status === s} onClick={() => patch({ status: s, institutionType: null, institution: null, institutionUndecided: false })}
                  className={cx('flex items-start gap-3 rounded-control border p-4 text-left transition', q.status === s ? 'border-forest bg-sage/60 shadow-lift' : 'border-charcoal/12 bg-ivory/60 hover:border-forest/50')}>
                  <span className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full', q.status === s ? 'bg-forest text-ivory' : 'bg-sage text-forest')}><Icon name={STATUS_ICON[s]} className="h-4 w-4" /></span>
                  <span>
                    <span className="block text-base font-semibold text-charcoal">{t(`q.status.${s}`)}</span>
                    <span className="mt-0.5 block text-xs text-charcoal/60">{t(`q.status.${s}Hint`)}</span>
                  </span>
                </button>
              ))}
            </div>
            {err('status')}
          </fieldset>
        )}

        {step === 2 && (
          <>
            <ChipGroup label={t('q.institutionType')} required options={types.map((x) => ({ id: x, label: t(`inst.type.${x}`) }))} value={q.institutionType}
              onChange={(v) => patch({ institutionType: v as InstitutionType, institution: null, course: null })} error={err('institutionType')} />

            {q.institutionType && (
              <div>
                <div className="mb-1.5 flex items-baseline justify-between gap-3">
                  <label htmlFor="q-institution" className="text-xs font-medium text-charcoal/70">{t('q.institution')}<span className="ml-0.5 text-champagne">*</span></label>
                  {!studying && (
                    <label className="flex cursor-pointer items-center gap-2 text-xs text-charcoal/70">
                      <input type="checkbox" className="h-4 w-4 accent-forest" checked={q.institutionUndecided} onChange={(e) => patch({ institutionUndecided: e.target.checked, institution: null })} />
                      {t('q.institutionUndecided')}
                    </label>
                  )}
                </div>
                {!q.institutionUndecided && (
                  <InstitutionSearch id="q-institution" list={INSTITUTION_REGISTRY} type={q.institutionType} value={q.institution} invalid={!!errors.institution} onChange={(v) => set('institution', v)} />
                )}
                {err('institution')}
              </div>
            )}

            {studying && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t(school ? 'q.grade' : 'q.course')} required>
                  <Select value={q.course ?? ''} onChange={(e) => set('course', e.target.value ? Number(e.target.value) : null)} aria-invalid={!!errors.course} className={q.course ? undefined : 'text-charcoal/40'}>
                    <option value="" disabled>{t('q.choose')}</option>
                    {Array.from({ length: maxCourse(q.institutionType) }, (_, i) => i + 1).map((n) => <option key={n} value={n} className="text-charcoal">{n}</option>)}
                  </Select>
                  {err('course')}
                </Field>
                <YearField label={t('q.graduationYear')} value={q.graduationYear} from={year} to={year + 12} onChange={(v) => set('graduationYear', v)} error={err('graduationYear')} />
              </div>
            )}
            {!studying && (
              <YearField label={t('q.admissionYear')} value={q.admissionYear} from={year} to={year + 6} onChange={(v) => set('admissionYear', v)} error={err('admissionYear')} />
            )}

            <div>
              <label htmlFor="q-direction" className="mb-1.5 flex items-baseline justify-between gap-3 text-xs font-medium text-charcoal/70">
                <span>{t(studying && school ? 'q.directionSchool' : 'q.direction')}{!(studying && school) && <span className="ml-0.5 text-champagne">*</span>}</span>
                {studying && school && <span className="text-[11px] font-normal text-charcoal/45">{t('q.optional')}</span>}
              </label>
              <DirectionField id="q-direction" value={q.direction} invalid={!!errors.direction} onChange={(v) => set('direction', v)} />
              {err('direction')}
            </div>

            {!(studying && school) && (
              <ChipGroup label={t(studying ? 'q.studyForm' : 'q.plannedForm')} required
                options={(studying ? ['GRANT', 'CONTRACT'] : ['GRANT', 'CONTRACT', 'UNKNOWN']).map((x) => ({ id: x, label: t(`q.form.${x as PlannedStudyForm}`) }))}
                value={q.studyForm} onChange={(v) => patch({ studyForm: v as PlannedStudyForm, contractSum: v === 'CONTRACT' || !studying ? q.contractSum : null })} error={err('studyForm')} />
            )}

            {((studying && !school && q.studyForm === 'CONTRACT') || (!studying && q.studyForm !== 'GRANT' && q.studyForm !== null)) && (
              <Field label={t(studying ? 'q.contractSum' : 'q.contractSumOptional')} required={studying}>
                <Input inputMode="numeric" placeholder="12 000 000" value={groupThousands(q.contractSum)} onChange={(e) => set('contractSum', digits(e.target.value) ? Number(digits(e.target.value).slice(0, 12)) : null)} aria-invalid={!!errors.contractSum} className="tabular-nums" />
                {err('contractSum')}
              </Field>
            )}
          </>
        )}

        {step === 3 && (
          <>
            <Field label={t('q.fullName')} required>
              <Input autoComplete="name" maxLength={120} placeholder={t('auth.fullNamePlaceholder')} value={q.fullName} onChange={(e) => set('fullName', e.target.value)} aria-invalid={!!errors.fullName} />
              {err('fullName')}
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('q.birthDate')} required>
                <Input type="date" autoComplete="bday" max={today.toISOString().slice(0, 10)} value={q.birthDate} onChange={(e) => set('birthDate', e.target.value)} aria-invalid={!!errors.birthDate} />
                {err('birthDate')}
              </Field>
              <Field label={t('auth.phone')} required>
                <Input type="tel" autoComplete="tel" maxLength={20} placeholder="+998 90 123 45 67" value={q.phone} onChange={(e) => set('phone', e.target.value)} aria-invalid={!!errors.phone} />
                {err('phone')}
              </Field>
            </div>
            <RegionDistrictField region={q.region} district={q.district} onRegion={(v) => set('region', v)} onDistrict={(v) => set('district', v)}
              regionError={errors.region && t(errors.region)} districtError={errors.district && t(errors.district)} />
            <Field label={t('q.email')} hint={t('q.optional')}>
              <Input type="email" autoComplete="email" maxLength={120} value={q.email} onChange={(e) => set('email', e.target.value)} aria-invalid={!!errors.email} />
              {err('email')}
            </Field>
            <Field label={t('q.about')} hint={t('q.count', { n: q.about.length, max: ABOUT_MAX })}>
              <Textarea rows={4} maxLength={ABOUT_MAX} placeholder={t('q.aboutPlaceholder')} value={q.about} onChange={(e) => set('about', e.target.value)} aria-invalid={!!errors.about} />
              {err('about')}
            </Field>
            {minor && (
              <section className="space-y-4 rounded-control border border-champagne/50 bg-champagne/10 p-4" aria-labelledby="q-guardian">
                <div>
                  <h2 id="q-guardian" className="font-body text-sm font-semibold text-charcoal">{t('q.guardianTitle')}</h2>
                  <p className="mt-1 text-xs leading-relaxed text-charcoal/65">{t('q.guardianHint')}</p>
                </div>
                <Field label={t('q.guardianName')} required>
                  <Input maxLength={120} value={q.guardianName} onChange={(e) => set('guardianName', e.target.value)} aria-invalid={!!errors.guardianName} />
                  {err('guardianName')}
                </Field>
                <Field label={t('q.guardianPhone')} required>
                  <Input type="tel" maxLength={20} placeholder="+998 90 123 45 67" value={q.guardianPhone} onChange={(e) => set('guardianPhone', e.target.value)} aria-invalid={!!errors.guardianPhone} />
                  {err('guardianPhone')}
                </Field>
                <label className="flex cursor-pointer items-start gap-3 text-[13px] text-charcoal/80">
                  <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-forest" checked={q.guardianConsent} onChange={(e) => set('guardianConsent', e.target.checked)} aria-invalid={!!errors.guardianConsent} />
                  <span>{t('q.guardianConsent')}<span className="text-red-700"> *</span></span>
                </label>
                {err('guardianConsent')}
              </section>
            )}
          </>
        )}

        {step === 4 && (
          <fieldset className="space-y-3">
            <legend className="mb-1 text-sm text-charcoal/70">{t('q.consentsIntro')}</legend>
            {STUDENT_CONSENTS.length === 0
              ? <Notice>{t('q.consentsSoon')}</Notice>
              : STUDENT_CONSENTS.map((c) => (
                <label key={c.key} className="flex cursor-pointer items-start gap-3 text-[13px] leading-relaxed text-charcoal/80">
                  <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-forest" checked={!!q.consents[c.key]} onChange={(e) => set('consents', { ...q.consents, [c.key]: e.target.checked })} />
                  <span>{t(c.label)}{c.required && <span className="text-red-700"> *</span>}</span>
                </label>
              ))}
            {err('consents')}
            {saveError && <Notice tone="warn">{saveError}</Notice>}
          </fieldset>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-charcoal/8 pt-5">
          {step > 1
            ? <Button type="button" variant="ghost" onClick={() => goTo(step - 1)}><Icon name="arrowLeft" className="h-4 w-4" />{t('common.back')}</Button>
            : <LinkButton to="/student" variant="ghost">{t('q.later')}</LinkButton>}
          <Button type="button" onClick={() => void next()} disabled={saving}>
            {saving ? <Icon name="refresh" className="h-4 w-4 animate-spin" /> : null}
            {step < QUESTIONNAIRE_STEPS ? t('common.next') : t('q.finish')}
            {step < QUESTIONNAIRE_STEPS && <Icon name="arrowRight" className="h-4 w-4" />}
          </Button>
        </div>
      </Card>
    </div>
  )
}

function ChipGroup({ label, options, value, onChange, required, error }: { label: string; options: { id: string; label: string }[]; value: string | null; onChange: (v: string) => void; required?: boolean; error?: ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-1.5 text-xs font-medium text-charcoal/70">{label}{required && <span className="ml-0.5 text-champagne">*</span>}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button key={o.id} type="button" aria-pressed={value === o.id} onClick={() => onChange(o.id)}
            className={cx('min-h-[40px] rounded-control border px-4 py-2 text-sm font-medium transition', value === o.id ? 'border-forest bg-forest text-ivory' : 'border-charcoal/15 bg-paper text-charcoal/75 hover:border-forest/50')}>
            {o.label}
          </button>
        ))}
      </div>
      {error}
    </fieldset>
  )
}

function YearField({ label, value, from, to, onChange, error }: { label: string; value: number | null; from: number; to: number; onChange: (v: number | null) => void; error?: ReactNode }) {
  const { t } = useT()
  return (
    <Field label={label} required>
      <Select value={value ?? ''} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)} className={value ? undefined : 'text-charcoal/40'}>
        <option value="" disabled>{t('q.choose')}</option>
        {Array.from({ length: to - from + 1 }, (_, i) => from + i).map((y) => <option key={y} value={y} className="text-charcoal">{y}</option>)}
      </Select>
      {error}
    </Field>
  )
}

function Summary({ q, confirmed, onEdit }: { q: Questionnaire; confirmed: 'CONFIRMED' | 'PENDING' | 'REJECTED' | null; onEdit: () => void }) {
  const { t, lang } = useT()
  const region = (id: string) => UZ_REGIONS.find((r) => r.id === id)?.name[lang] ?? id
  const studying = q.status === 'STUDYING'
  const rows: [string, ReactNode][] = [
    [t('q.step.status'), q.status && t(`q.status.${q.status}`)],
    [t('q.institutionType'), q.institutionType && t(`inst.type.${q.institutionType}`)],
    [t('q.institution'), q.institutionUndecided ? t('q.institutionUndecided') : q.institution && (
      <span key="institution">{q.institution.name} <span className="text-charcoal/50">· {region(q.institution.region)}</span>
        {studying && confirmed === 'CONFIRMED' && <Badge tone="forest" className="ml-2"><Icon name="check" className="mr-1 inline h-3 w-3" />{t('q.confirmed')}</Badge>}
        {studying && confirmed === 'PENDING' && <Badge tone="muted" className="ml-2">{t('q.awaitingConfirm')}</Badge>}
      </span>
    )],
    [t(q.institutionType === 'SCHOOL' ? 'q.grade' : 'q.course'), studying ? q.course : null],
    [t(studying ? 'q.graduationYear' : 'q.admissionYear'), studying ? q.graduationYear : q.admissionYear],
    [t('q.direction'), q.direction?.name],
    [t(studying ? 'q.studyForm' : 'q.plannedForm'), q.studyForm && t(`q.form.${q.studyForm}`)],
    [t('q.contractSum'), q.contractSum ? `${groupThousands(q.contractSum)} ${lang === 'ru' ? 'сум' : lang === 'en' ? 'so‘m' : 'söm'}` : null],
    [t('q.fullName'), q.fullName],
    [t('q.birthDate'), q.birthDate],
    [t('auth.org.region'), q.region && `${region(q.region)}${q.district ? `, ${q.district}` : ''}`],
    [t('auth.phone'), q.phone],
    [t('q.email'), q.email],
    [t('q.about'), q.about],
    [t('q.guardianTitle'), q.guardianName && `${q.guardianName} · ${q.guardianPhone}`],
  ]
  return (
    <div className="mx-auto max-w-2xl">
      <PageTitle eyebrow={t('dash.studentSpace')} title={t('q.title')} subtitle={t('q.subtitle')} action={<Button variant="secondary" onClick={onEdit}><Icon name="edit" className="h-4 w-4" />{t('common.edit')}</Button>} />
      <Card className="p-5 sm:p-7">
        <dl className="divide-y divide-charcoal/8">
          {rows.filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => (
            <div key={k} className="grid gap-1 py-2.5 text-sm sm:grid-cols-[12rem_1fr] sm:gap-4">
              <dt className="text-charcoal/55">{k}</dt>
              <dd className="min-w-0 break-words font-medium text-charcoal">{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  )
}
