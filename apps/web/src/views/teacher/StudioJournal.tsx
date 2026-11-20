'use client'
import { JournalGrid } from '../../components/attendance/JournalGrid'
import { Icon, PageTitle } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { Link } from '../../lib/router'
import { useParams } from '../../lib/routerHooks'

/** The teacher's journal of one group (ТЗ 2026-11-18, 5); ownership is checked by the API. */
export function StudioJournal() {
  const { groupId = '' } = useParams<{ groupId: string }>()
  const { t } = useT()
  return (
    <div>
      <Link to={`/teacher/groups/${groupId}`} className="mb-3 inline-flex items-center gap-1 text-xs text-charcoal/55 hover:text-forest"><Icon name="arrowLeft" className="h-3.5 w-3.5" />{t('group.details')}</Link>
      <PageTitle eyebrow={t('dash.teacherStudio')} title={t('journal.title')} />
      {groupId && <JournalGrid groupId={groupId} />}
    </div>
  )
}
