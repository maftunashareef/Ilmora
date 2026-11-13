import { useT } from '../i18n/useT'
import type { TKey } from '../i18n/translations'
import { useStore } from '../store/useStore'
import type { Audience, Status, Visibility } from '../types'
import { Notice, Segmented } from './ui'
import { VisibilityControl } from './VisibilityControl'

export interface PublishDraft { status: Status; visibility: Visibility | null; audience: Audience }

/** Who is editing: the Super Admin, a teacher (subject to the teacher switches) or a center (publishes its own courses directly). */
export type PublishMode = 'admin' | 'teacher' | 'center'

/** Status (draft/published/archived) + required Public/Private choice with audience selector. */
export function PublishFields({ value, onChange, teacherId, mode }: { value: PublishDraft; onChange: (v: PublishDraft) => void; teacherId: string; mode: PublishMode }) {
  const { t } = useT()
  const perms = useStore((s) => s.site.permissions.teacher)
  const canPublish = mode !== 'teacher' || perms.publishDirectly
  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 text-sm font-medium text-charcoal">{t('common.status')}</div>
        <Segmented<Status> value={value.status} onChange={(status) => onChange({ ...value, status })} options={[
          { id: 'draft', label: t('status.draft') },
          { id: 'published', label: canPublish ? t('status.published') : t('studio.submitReview') },
          { id: 'archived', label: t('status.archived') },
        ]} />
        <p className="mt-2 text-xs text-charcoal/55">{t(`status.${value.status}Hint` as TKey)}</p>
        {value.status === 'published' && !canPublish && <Notice tone="warn" className="mt-2">{t('studio.reviewNote')}</Notice>}
      </div>
      <VisibilityControl value={value.visibility} audience={value.audience} teacherId={teacherId} onChange={(visibility, audience) => onChange({ ...value, visibility, audience })} />
    </div>
  )
}

