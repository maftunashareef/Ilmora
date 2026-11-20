'use client'
import { useEffect, useState } from 'react'
import { JournalGrid } from '../../components/attendance/JournalGrid'
import { EmptyState, Field, Notice, PageTitle, Select } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { api } from '../../lib/api'
import { useCenterScope, type CenterCourses } from './centerApi'

/** The center's group journals (ТЗ 2026-11-18, 5): pick a group, then the month's lessons and its students. */
export function CenterJournal() {
  const scope = useCenterScope()
  const { t, tr } = useT()
  const [courses, setCourses] = useState<CenterCourses['courses'] | null>(null)
  const [groupId, setGroupId] = useState('')
  const [failed, setFailed] = useState(false)
  useEffect(() => { api<CenterCourses>(`${scope.base}/courses`).then((d) => setCourses(d.courses.filter((c) => c.learningFormat !== 'ONLINE')), () => setFailed(true)) }, [scope.base])
  const groups = (courses ?? []).flatMap((c) => c.groups.map((g) => ({ id: g.id, label: `${tr(c.title)} · ${g.name}` })))
  // The first group until another is chosen.
  const current = groups.some((g) => g.id === groupId) ? groupId : (groups[0]?.id ?? '')

  return (
    <div>
      <PageTitle eyebrow={t('dash.center')} title={t('journal.title')} />
      {failed && <Notice tone="warn">{t('center.loadError')}</Notice>}
      {courses && groups.length === 0 && <EmptyState title={t('cs.form.noGroups')} />}
      {groups.length > 0 && (
        <>
          <Field label={t('journal.chooseGroup')} className="mb-5 max-w-md">
            <Select value={current} onChange={(e) => setGroupId(e.target.value)}>{groups.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}</Select>
          </Field>
          {current && <JournalGrid key={current} groupId={current} />}
        </>
      )}
    </div>
  )
}
