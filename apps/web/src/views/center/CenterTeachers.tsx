'use client'
import { useCallback, useEffect, useState } from 'react'
import { countLabel, NOUNS } from '@ilmora/shared'
import { getTeacherAvatarUrl } from '../../components/teacher/teacherImage'
import { Avatar, Badge, Button, EmptyState, Field, Icon, Input, LField, Modal, Notice, PageTitle } from '../../components/ui'
import { emptyL, useT } from '../../i18n/useT'
import { api, isApiError } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import { useStore } from '../../store/useStore'
import type { L } from '../../types'
import { useCenterScope, type CenterTeacher } from './centerApi'

type Draft = { id?: string; name: string; title: L; bio: L; expertise: string; login: string }
const blank = (): Draft => ({ name: '', title: emptyL(), bio: emptyL(), expertise: '', login: '' })

/** Teachers of the center: profiles, linked accounts, courses; add (optionally linking a registered teacher), edit, remove. */
export function CenterTeachers() {
  const scope = useCenterScope()
  const { t, tr, lang } = useT()
  const notify = useStore((s) => s.notify)
  const [list, setList] = useState<CenterTeacher[] | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const load = useCallback(() => api<CenterTeacher[]>(`${scope.base}/teachers`).then(setList).catch(() => setFailed(true)), [scope.base])
  useEffect(() => { void load() }, [load])

  const fail = (err: unknown) => notify(isApiError(err) ? apiErrorText(err, lang) : t('center.loadError'), 'warn')
  const save = async () => {
    if (!draft || draft.name.trim().length < 1) return
    setBusy(true)
    try {
      const body = { name: draft.name.trim(), title: draft.title, bio: draft.bio, expertise: draft.expertise.split(',').map((x) => x.trim()).filter(Boolean) }
      if (draft.id) await api(`${scope.base}/teachers/${draft.id}`, { method: 'PATCH', body })
      else if (draft.login.trim()) {
        // A registered teacher is invited, not linked: they join after accepting. The answer never says whether the login exists.
        await api(`${scope.base}/teachers`, { method: 'POST', body: { ...body, login: draft.login.trim() } })
        notify(t('center.inviteSent'))
        setDraft(null)
        await load()
        return
      } else await api(`${scope.base}/teachers`, { method: 'POST', body })
      notify(t('common.saved'))
      setDraft(null)
      await load()
    } catch (err) { fail(err) } finally { setBusy(false) }
  }
  const remove = async (id: string) => {
    if (!confirm(t('common.confirmDelete'))) return
    setBusy(true)
    try { await api(`${scope.base}/teachers/${id}`, { method: 'DELETE' }); notify(t('common.saved')); await load() } catch (err) { fail(err) } finally { setBusy(false) }
  }

  return (
    <div>
      <PageTitle eyebrow={t('dash.center')} title={t('center.teachers')} action={<Button onClick={() => setDraft(blank())}><Icon name="plus" className="h-4 w-4" />{t('center.addTeacher')}</Button>} />
      {failed && <Notice tone="warn">{t('center.loadError')}</Notice>}
      {list && list.length === 0 && <EmptyState title={t('center.noTeachers')} body={t('center.needTeacherFirst')} />}
      {list && list.length > 0 && (
        <ul className="space-y-2">
          {list.map((te) => (
            <li key={te.id} className="card flex items-center gap-3 p-3">
              <Avatar name={te.name || '?'} seed={te.avatarSeed} size={40} url={getTeacherAvatarUrl(te)} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><span className="truncate text-sm font-medium text-charcoal">{te.name}</span>{te.account ? <Badge tone="sage">{t('center.teacherLinked')}{te.account.login ? ` · @${te.account.login}` : ''}</Badge> : <Badge tone="muted">{t('center.teacherUnlinked')}</Badge>}</div>
                <div className="truncate text-xs text-charcoal/55">{tr(te.title)}{te.expertise.length ? ` · ${te.expertise.join(', ')}` : ''} · {countLabel(lang, te.courses, NOUNS.course)}</div>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setDraft({ id: te.id, name: te.name, title: te.title, bio: te.bio, expertise: te.expertise.join(', '), login: '' })} aria-label={t('common.edit')}><Icon name="edit" className="h-3.5 w-3.5" /></Button>
              <Button size="sm" variant="danger" disabled={busy || te.courses > 0} title={te.courses > 0 ? t('center.err.inUse') : t('center.removeTeacher')} onClick={() => void remove(te.id)}><Icon name="x" className="h-3.5 w-3.5" /></Button>
            </li>
          ))}
        </ul>
      )}
      <Modal open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? t('center.editTeacher') : t('center.addTeacher')} footer={<><Button variant="ghost" onClick={() => setDraft(null)}>{t('common.cancel')}</Button><Button disabled={busy || !draft?.name.trim()} onClick={() => void save()}>{t('common.save')}</Button></>}>
        {draft && (
          <div className="space-y-4">
            <Field label={t('common.name')} required><Input maxLength={120} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
            {!draft.id && (
              <Field label={t('center.linkLogin')} hint={t('center.linkLoginHint')}><Input autoCapitalize="none" spellCheck={false} maxLength={32} value={draft.login} onChange={(e) => setDraft({ ...draft, login: e.target.value })} /></Field>
            )}
            <LField label={t('studio.channel.titleField')} value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} />
            <LField label={t('studio.channel.bio')} multiline value={draft.bio} onChange={(v) => setDraft({ ...draft, bio: v })} />
            <Field label={t('studio.channel.expertise')}><Input value={draft.expertise} onChange={(e) => setDraft({ ...draft, expertise: e.target.value })} /></Field>
          </div>
        )}
      </Modal>
    </div>
  )
}
