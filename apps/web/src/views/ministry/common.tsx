'use client'
import type { RegistryInstitutionStatus } from '@ilmora/shared'
import { Badge, Button } from '../../components/ui'
import { useT } from '../../i18n/useT'

const statusTone = (s: RegistryInstitutionStatus) => (s === 'APPROVED' ? 'forest' : s === 'REJECTED' ? 'danger' : s === 'PENDING' ? 'champagne' : 'muted')

export function StatusBadge({ status }: { status: RegistryInstitutionStatus }) {
  const { t } = useT()
  return <Badge tone={statusTone(status)}>{t(`rev.status.${status}`)}</Badge>
}

/** «Найдено: N» above a list and «Страница 2 из 5» with back / next below it. */
export function Pager({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (page: number) => void }) {
  const { t } = useT()
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null
  return (
    <div className="mt-4 flex items-center justify-between text-xs text-charcoal/55">
      <span>{t('rev.page', { page, pages })}</span>
      <div className="flex gap-2">
        <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)}>{t('common.back')}</Button>
        <Button size="sm" variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)}>{t('common.next')}</Button>
      </div>
    </div>
  )
}
