import { useEffect, useState } from 'react'
import { Button, EmptyState, Icon, Input, Modal, Notice } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { api } from '../../lib/api'
import { apiErrorText } from '../../lib/apiErrors'
import { withCenterAdmin, withoutCenterAdmin } from '../../lib/centerAdmins'
import { useStore } from '../../store/useStore'
import type { Center } from '../../types'

type Person = { id: string; login: string | null; phoneMasked: string | null; displayName: string; roles: string[]; centerId: string | null }
const REASON = 'Center administrator role changed by the Super Admin'

/** Super Admin: who administers a center. Center administrators can manage discounts for their own center's courses only. */
export function CenterAdminsModal({ center, onClose }: { center: Center | null; onClose: () => void }) {
  const { t } = useT()
  return (
    <Modal open={!!center} onClose={onClose} title={center ? `${t('admin.centerAdmins')} — ${center.name}` : ''}>
      {center && <CenterAdminsPanel key={center.id} center={center} />}
    </Modal>
  )
}

function CenterAdminsPanel({ center }: { center: Center }) {
  const { t, lang } = useT()
  const notify = useStore((s) => s.notify)
  const [admins, setAdmins] = useState<Person[] | null>(null)
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<Person[] | null>(null)
  const [busy, setBusy] = useState(false)

  const loadAdmins = () =>
    api<{ items: Person[] }>('/admin/users?role=CENTER_ADMIN&pageSize=200')
      .then((r) => setAdmins(r.items.filter((u) => u.centerId === center.id)))
      .catch((err) => notify(apiErrorText(err, lang), 'warn'))

  useEffect(() => {
    void loadAdmins()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once when the panel opens
  }, [])

  const search = async () => {
    const q = query.trim()
    if (!q) return
    try {
      const r = await api<{ items: Person[] }>(`/admin/users?search=${encodeURIComponent(q)}&pageSize=10`)
      setFound(r.items.filter((u) => !(u.roles.includes('CENTER_ADMIN') && u.centerId === center.id)))
    } catch (err) {
      notify(apiErrorText(err, lang), 'warn')
    }
  }

  const change = async (person: Person, add: boolean) => {
    setBusy(true)
    try {
      await api(`/admin/users/${person.id}/roles`, {
        method: 'PUT',
        body: { roles: add ? withCenterAdmin(person.roles) : withoutCenterAdmin(person.roles), ...(add ? { centerId: center.id } : {}), reason: REASON },
      })
      notify(add ? t('admin.centerAdmins.assigned') : t('admin.centerAdmins.removed'))
      if (add) { setFound(null); setQuery('') }
      await loadAdmins()
    } catch (err) {
      notify(apiErrorText(err, lang), 'warn')
    } finally {
      setBusy(false)
    }
  }

  const who = (p: Person) => `${p.displayName}${p.login ? ` · @${p.login}` : p.phoneMasked ? ` · ${p.phoneMasked}` : ''}`

  return (
    <div className="space-y-5">
      <p className="text-sm text-charcoal/65">{t('admin.centerAdmins.hint')}</p>
      {admins && admins.length === 0 && <EmptyState title={t('admin.centerAdmins.none')} />}
      {admins && admins.length > 0 && (
        <ul className="space-y-2">
          {admins.map((p) => (
            <li key={p.id} className="card flex items-center justify-between gap-3 p-3">
              <span className="min-w-0 truncate text-sm text-charcoal">{who(p)}</span>
              <Button size="sm" variant="danger" disabled={busy} onClick={() => void change(p, false)}><Icon name="x" className="h-3.5 w-3.5" />{t('admin.centerAdmins.remove')}</Button>
            </li>
          ))}
        </ul>
      )}
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void search() }}>
        <Input aria-label={t('admin.centerAdmins.search')} placeholder={t('admin.centerAdmins.search')} value={query} onChange={(e) => setQuery(e.target.value)} />
        <Button type="submit" variant="secondary"><Icon name="search" className="h-4 w-4" />{t('common.search')}</Button>
      </form>
      {found && found.length === 0 && <p className="text-sm text-charcoal/55">{t('admin.centerAdmins.noResults')}</p>}
      {found && found.length > 0 && (
        <ul className="space-y-2">
          {found.map((p) => (
            <li key={p.id} className="card flex items-center justify-between gap-3 p-3">
              <span className="min-w-0 truncate text-sm text-charcoal">{who(p)}</span>
              <Button size="sm" disabled={busy} onClick={() => void change(p, true)}><Icon name="plus" className="h-3.5 w-3.5" />{t('admin.centerAdmins.add')}</Button>
            </li>
          ))}
        </ul>
      )}
      <Notice tone="info" className="text-xs">{t('admin.centerAdmins.relogin')}</Notice>
    </div>
  )
}
