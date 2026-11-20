'use client'
import { useCallback, useEffect, useState } from 'react'
import { studyLabel } from '@ilmora/shared'
import { Badge, Button, EmptyState, Notice, PageTitle } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { apiErrorText } from '../../lib/apiErrors'
import { studentCentersApi, type MyCenter } from '../../services/centerStudents'
import { useStore } from '../../store/useStore'

/** The centers that keep the student on their list (ТЗ 2026-11-18, 4): where they study, the groups, «leave». */
export function StudentCenters() {
  const { t, tr, lang } = useT()
  const notify = useStore((s) => s.notify)
  const [list, setList] = useState<MyCenter[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  const load = useCallback(() => studentCentersApi.mine().then(setList, (e) => setFailed(apiErrorText(e, lang))), [lang])
  useEffect(() => { void load() }, [load])
  const leave = async (c: MyCenter) => {
    if (!confirm(t('mycenters.leaveConfirm'))) return
    try { await studentCentersApi.leave(c.id); notify(t('mycenters.left')); await load() } catch (e) { notify(apiErrorText(e, lang), 'warn') }
  }
  return (
    <div>
      <PageTitle eyebrow={t('dash.studentSpace')} title={t('mycenters.title')} />
      {failed && <Notice tone="warn">{failed}</Notice>}
      {list && list.length === 0 && <EmptyState title={t('mycenters.empty')} />}
      <ul className="space-y-3">
        {list?.map((c) => (
          <li key={c.id} className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium text-charcoal">{c.center.name}</div>
                <div className="mt-0.5 text-sm text-charcoal/65">{studyLabel(lang, { institutionType: c.institution?.type ?? null, institutionName: c.institution?.name ?? null, studyYear: c.studyYear, centerName: c.center.name })}</div>
                {c.groups.length > 0 && <div className="mt-1 text-xs text-charcoal/55">{c.groups.map((g) => `${tr(g.courseTitle)} · ${g.name}`).join(', ')}</div>}
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={c.status === 'STUDYING' ? 'forest' : 'warn'}>{t(`cs.status.${c.status}`)}</Badge>
                {c.source === 'CENTER' && <Button size="sm" variant="ghost" onClick={() => void leave(c)}>{t('mycenters.leave')}</Button>}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
