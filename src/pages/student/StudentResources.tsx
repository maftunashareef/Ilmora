import { useState } from 'react'
import { EmptyState, Notice, PageTitle, Segmented } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { checkAccess } from '../../lib/access'
import { resolveGroups } from '../../lib/schedule'
import { useCurrentStudent, useViewer } from '../../store/selectors'
import { useStore } from '../../store/useStore'
import { ResourceRow } from '../public/TeacherChannel'

type Filter = 'mine' | 'assigned' | 'all'

export function StudentResources() {
  const { t } = useT()
  const student = useCurrentStudent()
  const viewer = useViewer()
  const s = useStore()
  const [filter, setFilter] = useState<Filter>('mine')
  if (!student) return null
  const groups = resolveGroups(student.subscription.status === 'active' ? student.subscription.groupIds : [], s.courses)
  const myTeacherIds = new Set(groups.map((g) => s.courses.find((c) => c.id === g.courseId)?.teacherId))
  const list = s.resources.filter((r) => {
    const a = checkAccess(r, viewer)
    if (!a.allowed) return false
    if (filter === 'assigned') return a.reason === 'assigned-group' || a.reason === 'assigned-student'
    if (filter === 'mine') return a.reason !== 'public' || myTeacherIds.has(r.teacherId)
    return true
  })
  return (
    <div>
      <PageTitle eyebrow={t('dash.studentSpace')} title={t('student.resources')} action={<Segmented<Filter> size="sm" value={filter} onChange={setFilter} options={[{ id: 'mine', label: t('student.ownMaterials') }, { id: 'assigned', label: t('student.assignedOnly') }, { id: 'all', label: t('common.all') }]} />} />
      {!s.site.permissions.student.downloadResources && <Notice tone="warn" className="mb-4 text-xs">{t('studio.lockedByAdmin')}: {t('perm.student.downloadResources')}</Notice>}
      {list.length === 0 ? <EmptyState title={t('student.resources.empty')} /> : <div className="grid gap-3 md:grid-cols-2">{list.map((r) => <ResourceRow key={r.id} r={r} />)}</div>}
      <p className="mt-6 text-xs text-charcoal/45">{t('channel.demoFile')}</p>
    </div>
  )
}
