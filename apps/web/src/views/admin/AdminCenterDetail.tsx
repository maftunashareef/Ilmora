'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { CenterStatus } from '@ilmora/shared'
import { Badge, Button, Icon, LinkButton, Notice, Tabs } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { api, isApiError } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import { Link, useParams, useSearchParams } from '../../lib/router'
import { useStore } from '../../store/useStore'
import { CenterAttendance } from '../center/CenterAttendance'
import { CenterCourses } from '../center/CenterCourses'
import { CenterOverview } from '../center/CenterOverview'
import { CenterSettings } from '../center/CenterSettings'
import { CenterStudents } from '../center/CenterStudents'
import { CenterTeachers } from '../center/CenterTeachers'
import { CenterScopeContext, type CenterOverview as Overview, type CenterScope, type CenterSection } from '../center/centerApi'
import { CenterAdminsModal } from './CenterAdmins'

/** The public site, for links that leave the admin surface (empty locally, where both share one origin). */
const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? '').replace(/\/$/, '')
const SECTIONS: CenterSection[] = ['overview', 'courses', 'teachers', 'attendance', 'students', 'settings']
const LABEL = { overview: 'dash.overview', courses: 'center.courses', teachers: 'center.teachers', attendance: 'center.attendance', students: 'center.students', settings: 'center.settings' } as const

/**
 * Super Admin: one center's workspace exactly as its administrators see it (the same views, pointed at
 * `/admin/centers/:id`), plus approval, blocking, the center's administrators and its public page.
 */
export function AdminCenterDetail() {
  const { id = '' } = useParams<{ id: string }>()
  const { t, tr, lang } = useT()
  const notify = useStore((s) => s.notify)
  const [params, setParams] = useSearchParams()
  const tab = (SECTIONS.includes(params.get('tab') as CenterSection) ? params.get('tab') : 'overview') as CenterSection
  const [center, setCenter] = useState<Overview['center'] | null>(null)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [adminsOpen, setAdminsOpen] = useState(false)
  const base = `/admin/centers/${id}`
  const scope = useMemo<CenterScope>(() => ({ base, admin: true, links: (s) => (s === 'overview' ? base : `${base}?tab=${s}`) }), [base])
  const load = useCallback(() => api<Overview>(`${base}/overview`).then((d) => setCenter(d.center)).catch(() => setFailed(true)), [base])
  useEffect(() => { void load() }, [load])

  const setStatus = async (status: CenterStatus) => {
    const reason = status === 'BLOCKED' ? (prompt(t('admin.centers.reason')) ?? undefined) : undefined
    setBusy(true)
    try {
      await api(`${base}/status`, { method: 'PATCH', body: { status, ...(reason ? { reason } : {}) } })
      notify(t('admin.centers.statusChanged'))
      await load()
    } catch (err) { notify(isApiError(err) ? apiErrorText(err, lang) : String(err), 'warn') } finally { setBusy(false) }
  }
  const tone = (st: CenterStatus) => (st === 'ACTIVE' ? 'forest' : st === 'PENDING' ? 'champagne' : 'danger')

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3 border-b border-charcoal/10 pb-4">
        <Link to="/admin/centers" className="text-xs font-medium text-forest underline">← {t('admin.centers')}</Link>
        {center && (
          <>
            <span className="h-6 w-1 rounded-full" style={{ background: center.tone }} />
            <span className="font-display text-xl text-charcoal">{center.name}</span>
            <Badge tone={tone(center.status)}>{t(`center.status.${center.status}`)}</Badge>
            <span className="text-xs text-charcoal/50">{tr(center.district)}</span>
            <div className="ml-auto flex flex-wrap gap-2">
              {center.status !== 'ACTIVE' && <Button size="sm" disabled={busy} onClick={() => void setStatus('ACTIVE')}><Icon name="check" className="h-3.5 w-3.5" />{center.status === 'BLOCKED' ? t('admin.centers.unblock') : t('admin.centers.approve')}</Button>}
              {center.status !== 'BLOCKED' && <Button size="sm" variant="danger" disabled={busy} onClick={() => void setStatus('BLOCKED')}><Icon name="lock" className="h-3.5 w-3.5" />{t('admin.centers.block')}</Button>}
              <Button size="sm" variant="secondary" onClick={() => setAdminsOpen(true)}><Icon name="users" className="h-3.5 w-3.5" />{t('admin.centerAdmins')}</Button>
              {center.status === 'ACTIVE' && <LinkButton size="sm" variant="secondary" external to={`${SITE_URL}/${lang}/centers/${center.slug}`}><Icon name="external" className="h-3.5 w-3.5" />{t('admin.centers.publicPage')}</LinkButton>}
            </div>
          </>
        )}
      </div>
      {failed && <Notice tone="warn" className="mb-4">{t('center.loadError')}</Notice>}
      {center?.blockReason && <Notice tone="warn" className="mb-4">{center.blockReason}</Notice>}
      <Notice tone="info" className="mb-4 text-xs">{t('admin.centers.oversightHint')}</Notice>
      <Tabs tabs={SECTIONS.map((s) => ({ id: s, label: t(LABEL[s]) }))} value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })} className="mb-6" />
      <CenterScopeContext.Provider value={scope}>
        <div key={`${id}:${tab}`}>
          {tab === 'overview' && <CenterOverview />}
          {tab === 'courses' && <CenterCourses />}
          {tab === 'teachers' && <CenterTeachers />}
          {tab === 'attendance' && <CenterAttendance />}
          {tab === 'students' && <CenterStudents />}
          {tab === 'settings' && <CenterSettings />}
        </div>
      </CenterScopeContext.Provider>
      <CenterAdminsModal center={adminsOpen && center ? { id: center.id, slug: center.slug, name: center.name, district: center.district, description: center.description, tone: center.tone } : null} onClose={() => setAdminsOpen(false)} />
    </div>
  )
}
