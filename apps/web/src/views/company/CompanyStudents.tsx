'use client'
import { useEffect, useState, type ReactNode } from 'react'
import { STUDENTS_PAGE_SIZE, type CompanyStudentCardDto, type CompanyStudentsPageDto, type DirectionChoice, type MatchStatus, type StudentsBlockDto } from '@ilmora/shared'
import { DirectionField } from '../../components/DirectionField'
import { Badge, Button, Card, EmptyState, Icon, Notice, PageTitle, Select } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { apiErrorText } from '../../lib/apiErrors'
import { useSearchParams } from '../../lib/router'
import { companyApi, emptyStudentsFilters, studentsQuery, type StudentsFilters } from '../../services/companyCabinet'
import { INSTITUTION_TYPES } from '../../services/ministry'
import { useRegions } from '../../services/registry'
import { useStore } from '../../store/useStore'
import { Pager } from '../ministry/common'
import { CompanyClosed } from './common'
import { useCompany } from './companyStore'

const TONE: Record<MatchStatus, 'champagne' | 'forest' | 'danger' | 'muted'> = { PENDING: 'champagne', ACCEPTED: 'forest', DECLINED: 'danger', WITHDRAWN: 'muted' }
const YEAR = new Date().getFullYear()

/**
 * «Студенты» (ТЗ «Студенты у компании, Вакансии у учреждения», 2): institutions with students of the company's
 * industries who study there (confirmed) and agreed to be shown to companies of their industry; one institution's
 * cards a page at a time; «Запросить контакты» — the student decides. Nothing can be downloaded. `?i=` opens an institution.
 */
export function CompanyStudents() {
  const { t, tr, lang } = useT()
  const { profile } = useCompany()
  const open = !!profile?.workspaceOpen
  const regions = useRegions()
  const [sp, setSp] = useSearchParams()
  const selected = sp.get('i')
  const [filters, setFilters] = useState<StudentsFilters>(emptyStudentsFilters)
  const [direction, setDirection] = useState<DirectionChoice | null>(null)
  const key = studentsQuery(filters)
  const [answer, setAnswer] = useState<{ key: string; list?: StudentsBlockDto[]; error?: unknown } | null>(null)
  useEffect(() => {
    if (!open || selected) return
    let live = true
    companyApi.studentBlocks(filters).then((list) => { if (live) setAnswer({ key, list }) }, (error) => { if (live) setAnswer({ key, error }) })
    return () => { live = false }
  }, [open, selected, filters, key])

  if (profile && !open) return <div><PageTitle eyebrow={t('dash.company')} title={t('co.st.title')} /><CompanyClosed /></div>
  const set = (k: keyof StudentsFilters, v: string) => setFilters({ ...filters, [k]: v })
  const filterBar = (
    <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <div className="sm:col-span-2 lg:col-span-1">
        <DirectionField value={direction} placeholder={t('co.st.anyDirection')} onChange={(v) => { setDirection(v); set('direction', v?.id ?? '') }} />
      </div>
      <Select aria-label={t('rev.type')} value={filters.type} onChange={(e) => set('type', e.target.value)}>
        <option value="">{t('co.st.anyType')}</option>
        {INSTITUTION_TYPES.map((x) => <option key={x} value={x}>{t(`inst.type.${x}`)}</option>)}
      </Select>
      <Select aria-label={t('min.filter.region')} value={filters.region} onChange={(e) => set('region', e.target.value)}>
        <option value="">{t('min.filter.allRegions')}</option>
        {regions.map((r) => <option key={r.id} value={r.slug ?? r.id}>{tr(r.name)}</option>)}
      </Select>
      <Select aria-label={t('co.st.course')} value={filters.course} onChange={(e) => set('course', e.target.value)}>
        <option value="">{t('co.st.anyCourse')}</option>
        {Array.from({ length: 11 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{t('co.st.courseN', { n })}</option>)}
      </Select>
      <Select aria-label={t('co.st.graduation')} value={filters.graduationYear} onChange={(e) => set('graduationYear', e.target.value)}>
        <option value="">{t('co.st.anyGraduation')}</option>
        {Array.from({ length: 7 }, (_, i) => YEAR + i).map((y) => <option key={y} value={y}>{y}</option>)}
      </Select>
    </div>
  )

  if (selected) return <InstitutionStudents institutionId={selected} filters={filters} filterBar={filterBar} onBack={() => setSp({})} />
  const current = answer?.key === key ? answer : null
  return (
    <div>
      <PageTitle eyebrow={t('dash.company')} title={t('co.st.title')} subtitle={t('co.st.hint')} />
      {filterBar}
      {current?.error != null && <Notice tone="warn">{apiErrorText(current.error, lang)}</Notice>}
      {!current && <p className="text-sm text-charcoal/55" role="status">{t('common.loading')}</p>}
      {current?.list && current.list.length === 0 && <EmptyState icon={<Icon name="users" className="h-6 w-6" />} title={t('co.st.empty')} body={t('co.st.emptyHint')} />}
      <ul className="grid gap-3 md:grid-cols-2">
        {current?.list?.map((b) => (
          <li key={b.institution.id}>
            <Card className="flex h-full flex-wrap items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <div className="font-medium text-charcoal">{b.institution.name}</div>
                <div className="mt-0.5 text-xs text-charcoal/60">{t(`inst.type.${b.institution.type}`)}{b.institution.region && <> · <Icon name="pin" className="mr-0.5 inline h-3 w-3" />{tr(b.institution.region.name)}</>}</div>
              </div>
              <div className="flex items-center gap-3">
                <Badge tone="sage">{t('co.st.count', { n: b.students })}</Badge>
                <Button size="sm" variant="secondary" onClick={() => setSp({ i: b.institution.id }, { replace: false })}>{t('inst.g.open')}<Icon name="arrowRight" className="h-3.5 w-3.5" /></Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  )
}

function InstitutionStudents({ institutionId, filters, filterBar, onBack }: { institutionId: string; filters: StudentsFilters; filterBar: ReactNode; onBack: () => void }) {
  const { t, lang } = useT()
  // The page goes back to 1 when the filters change.
  const query = studentsQuery(filters)
  const [paging, setPaging] = useState({ query, page: 1 })
  const page = paging.query === query ? paging.page : 1
  const setPage = (p: number) => setPaging({ query, page: p })
  const key = `${institutionId}|${studentsQuery(filters, page)}`
  const [answer, setAnswer] = useState<{ key: string; data?: CompanyStudentsPageDto; error?: unknown } | null>(null)
  useEffect(() => {
    let live = true
    companyApi.studentsPage(institutionId, filters, page).then((data) => { if (live) setAnswer({ key, data }) }, (error) => { if (live) setAnswer({ key, error }) })
    return () => { live = false }
  }, [institutionId, filters, page, key])
  const current = answer?.key === key ? answer : null
  const institution = current?.data?.items[0]?.institution
  const replace = (card: CompanyStudentCardDto) => setAnswer((a) => (a?.data ? { ...a, data: { ...a.data, items: a.data.items.map((x) => (x.cardId === card.cardId ? card : x)) } } : a))

  return (
    <div>
      <button type="button" onClick={onBack} className="mb-4 inline-flex items-center gap-1.5 text-sm text-charcoal/60 hover:text-forest"><Icon name="arrowLeft" className="h-4 w-4" />{t('co.st.back')}</button>
      <PageTitle eyebrow={t('co.st.title')} title={institution?.name ?? t('co.st.title')} subtitle={current?.data ? t('co.st.count', { n: current.data.total }) : undefined} />
      {filterBar}
      {current?.error != null && <Notice tone="warn">{apiErrorText(current.error, lang)}</Notice>}
      {!current && <p className="text-sm text-charcoal/55" role="status">{t('common.loading')}</p>}
      {current?.data && current.data.items.length === 0 && <EmptyState icon={<Icon name="users" className="h-6 w-6" />} title={t('co.st.empty')} />}
      <ul className="space-y-3">
        {current?.data?.items.map((s) => <li key={s.cardId}><StudentCardView card={s} institutionId={institutionId} onChange={replace} /></li>)}
      </ul>
      {current?.data && <Pager page={current.data.page} total={current.data.total} pageSize={current.data.pageSize || STUDENTS_PAGE_SIZE} onPage={setPage} />}
    </div>
  )
}

function StudentCardView({ card: s, institutionId, onChange }: { card: CompanyStudentCardDto; institutionId: string; onChange: (c: CompanyStudentCardDto) => void }) {
  const { t, tr, lang } = useT()
  const notify = useStore((st) => st.notify)
  const [busy, setBusy] = useState(false)
  const ask = async () => {
    setBusy(true)
    try { onChange(await companyApi.requestStudent(institutionId, s.cardId)); notify(t('co.g.invited')) } catch (e) { notify(apiErrorText(e, lang), 'warn') } finally { setBusy(false) }
  }
  const study = [s.direction?.name, s.course ? t('co.st.courseN', { n: s.course }) : null, s.graduationYear ? t('inst.s.graduation', { year: s.graduationYear }) : null, s.region ? tr(s.region.name) : null].filter(Boolean).join(' · ')
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-charcoal">{s.name}</div>
          <div className="mt-0.5 text-xs text-charcoal/60">{study}</div>
        </div>
        <Badge tone="sage"><Icon name="check" className="h-3 w-3" />{t('co.g.confirmed')}</Badge>
      </div>
      {s.about && <p className="mt-2 text-sm text-charcoal/75">{s.about}</p>}
      {s.certificates.length > 0 && <p className="mt-1 text-xs text-charcoal/60">{t('co.g.certificates', { list: s.certificates.join(', ') })}</p>}
      {s.ilmoraCourses.length > 0 && <p className="mt-1 text-xs text-charcoal/60">{t('co.g.ilmoraCourses', { list: s.ilmoraCourses.map((c) => tr(c)).join(', ') })}</p>}
      <div className="mt-3 flex justify-end">
        {s.contactRequest ? <Badge tone={TONE[s.contactRequest]}>{t(`co.g.request.${s.contactRequest}`)}</Badge>
          : <Button size="sm" disabled={busy} onClick={() => void ask()}><Icon name="user" className="h-3.5 w-3.5" />{t('co.g.invite')}</Button>}
      </div>
    </Card>
  )
}
