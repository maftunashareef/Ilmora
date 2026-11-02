'use client'
import { useEffect, useState } from 'react'
import { Badge, EmptyState, Notice, PageTitle } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { api } from '../../lib/api'
import type { CenterStudent } from './centerApi'

/** Students enrolled at the center: groups, subscription state and attendance totals. */
export function CenterStudents() {
  const { t, tr } = useT()
  const [list, setList] = useState<CenterStudent[] | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => { api<CenterStudent[]>('/center/students').then(setList).catch(() => setFailed(true)) }, [])

  const subscriptionBadge = (s: CenterStudent['subscription']) => {
    if (!s) return <Badge tone="muted">{t('admin.people.noSub')}</Badge>
    if (s.blocked) return <Badge tone="danger">{t('student.sub.blocked')}</Badge>
    if (s.kind === 'LESSONS' && s.remainingLessons != null) return <Badge tone="forest">{t('student.sub.remainingLessons', { n: s.remainingLessons })}</Badge>
    if (s.remainingDays != null) return <Badge tone="forest">{t('student.sub.remainingDays', { n: s.remainingDays })}</Badge>
    return <Badge tone="forest">{t('common.enabled')}</Badge>
  }

  return (
    <div>
      <PageTitle eyebrow={t('dash.center')} title={t('center.students')} subtitle={t('admin.people.privacy')} />
      {failed && <Notice tone="warn">{t('center.loadError')}</Notice>}
      {list && list.length === 0 && <EmptyState title={t('center.noStudents')} />}
      {list && list.length > 0 && (
        <>
          <div className="card hidden overflow-hidden p-0 md:block">
            <table className="w-full text-sm">
              <thead className="bg-ivory/70 text-left text-[11px] uppercase tracking-wider text-charcoal/50"><tr><th className="px-4 py-3">{t('common.student')}</th><th className="px-3 py-3">{t('common.groups')}</th><th className="px-3 py-3">{t('student.subscription')}</th><th className="px-3 py-3 text-right">{t('center.attendance')}</th></tr></thead>
              <tbody className="divide-y divide-charcoal/8">
                {list.map((st) => (
                  <tr key={st.id} className="hover:bg-ivory/40">
                    <td className="px-4 py-2.5"><div className="font-medium text-charcoal">{st.displayName}</div><div className="text-xs text-charcoal/50">{[st.district, st.phoneMasked].filter(Boolean).join(' · ')}</div></td>
                    <td className="px-3 py-2.5 text-charcoal/70">{st.groups.map((g) => `${tr(g.courseTitle)} · ${g.name}`).join(', ')}</td>
                    <td className="px-3 py-2.5">{subscriptionBadge(st.subscription)}</td>
                    <td className="px-3 py-2.5 text-right text-charcoal/70">{t('center.attendanceTotals', { present: st.attendance.present, absent: st.attendance.absent })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-2 md:hidden">
            {list.map((st) => (
              <li key={st.id} className="card p-4">
                <div className="flex items-center justify-between gap-2"><span className="font-medium text-charcoal">{st.displayName}</span>{subscriptionBadge(st.subscription)}</div>
                <div className="mt-1 text-xs text-charcoal/55">{st.groups.map((g) => `${tr(g.courseTitle)} · ${g.name}`).join(', ')}</div>
                <div className="mt-1 text-xs text-charcoal/55">{t('center.attendanceTotals', { present: st.attendance.present, absent: st.attendance.absent })}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
