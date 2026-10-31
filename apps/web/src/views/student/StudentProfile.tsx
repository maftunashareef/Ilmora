import { useEffect, useState } from 'react'
import { Button, Card, Field, Input, Notice, PageTitle, Select, Toggle } from '../../components/ui'
import { LANGS } from '../../i18n/translations'
import { useT } from '../../i18n/useT'
import { useCurrentStudent } from '../../store/selectors'
import { useStore } from '../../store/useStore'
import type { Lang, StudentProfile as Profile } from '../../types'

export function StudentProfile() {
  const { t } = useT()
  const student = useCurrentStudent()
  const { updateProfile, setLang, notify } = useStore()
  const [draft, setDraft] = useState<Profile | null>(student?.profile ?? null)
  useEffect(() => { setDraft(student?.profile ?? null) }, [student?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!student || !draft) return null
  const dirty = JSON.stringify(draft) !== JSON.stringify(student.profile)
  return (
    <div>
      <PageTitle eyebrow={t('dash.studentSpace')} title={t('student.profile')} subtitle={t('student.profile.privacy')} />
      <Card className="max-w-xl space-y-5 p-7">
        <Field label={t('student.profile.displayName')} required><Input value={draft.displayName} onChange={(e) => setDraft({ ...draft, displayName: e.target.value })} /></Field>
        <Field label={t('student.profile.district')}><Input value={draft.district} onChange={(e) => setDraft({ ...draft, district: e.target.value })} /></Field>
        <Field label={t('student.profile.lang')}><Select value={draft.preferredLang} onChange={(e) => setDraft({ ...draft, preferredLang: e.target.value as Lang })}>{LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</Select></Field>
        <Toggle checked={draft.reminders} onChange={(v) => setDraft({ ...draft, reminders: v })} label={t('student.profile.reminders')} />
        <div className="flex items-center justify-between gap-3 border-t border-charcoal/10 pt-5">
          <span className="text-xs text-charcoal/50">{dirty ? t('common.unsaved') : t('common.saved')}</span>
          <Button disabled={!dirty || !draft.displayName.trim()} onClick={() => { updateProfile(student.id, draft); setLang(draft.preferredLang); notify(t('common.saved')) }}>{t('common.saveChanges')}</Button>
        </div>
      </Card>
      <Notice tone="info" className="mt-6 max-w-xl text-xs">{t('dash.demoNotice')}</Notice>
    </div>
  )
}
