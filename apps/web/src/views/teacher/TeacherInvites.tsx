'use client'
import { useEffect, useState } from 'react'
import { Button, Card, Eyebrow, Icon } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { api, isApiError } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import { useStore } from '../../store/useStore'

type Invite = { id: string; centerId: string; centerName: string; centerSlug: string; createdAt: string }

/**
 * Invitations from centers. A center cannot attach a registered teacher by itself: the teacher joins only by accepting
 * here. Shown on the studio overview while there is something to answer.
 */
export function TeacherInvites() {
  const { t, lang } = useT()
  const notify = useStore((s) => s.notify)
  const [list, setList] = useState<Invite[]>([])
  const [busy, setBusy] = useState(false)

  const load = () => api<Invite[]>('/teacher/center-invites').then(setList).catch(() => setList([]))
  useEffect(() => { void load() }, [])

  const answer = async (id: string, accept: boolean) => {
    setBusy(true)
    try {
      await api(`/teacher/center-invites/${id}/${accept ? 'accept' : 'decline'}`, { method: 'POST', body: {} })
      notify(t(accept ? 'teacher.invite.accepted' : 'teacher.invite.declined'))
      // Joining a center changes the account's center: reload so the session and the studio pick it up.
      if (accept) window.location.reload()
      else await load()
    } catch (err) {
      notify(isApiError(err) ? apiErrorText(err, lang) : t('center.loadError'), 'warn')
    } finally { setBusy(false) }
  }

  if (list.length === 0) return null
  return (
    <Card className="mt-6">
      <Eyebrow className="mb-3">{t('teacher.invite.title')}</Eyebrow>
      <ul className="space-y-2">
        {list.map((inv) => (
          <li key={inv.id} className="flex flex-wrap items-center gap-3">
            <span className="min-w-0 flex-1 text-sm text-charcoal">{t('teacher.invite.body', { centerName: inv.centerName })}</span>
            <Button size="sm" disabled={busy} onClick={() => void answer(inv.id, true)}><Icon name="check" className="h-3.5 w-3.5" />{t('teacher.invite.accept')}</Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void answer(inv.id, false)}>{t('teacher.invite.decline')}</Button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
