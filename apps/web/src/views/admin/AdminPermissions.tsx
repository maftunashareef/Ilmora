import { Card, Eyebrow, Icon, Notice, PageTitle, Toggle } from '../../components/ui'
import { useT } from '../../i18n/useT'
import type { TKey } from '../../i18n/translations'
import { useStore } from '../../store/useStore'
import type { Permissions } from '../../types'

const TEACHER: (keyof Permissions['teacher'])[] = ['editCourses', 'editPrices', 'editSchedules', 'manageGroups', 'publishDirectly', 'customizeChannel', 'uploadResources']
const STUDENT: (keyof Permissions['student'])[] = ['saveItems', 'switchGroups', 'downloadResources']

export function AdminPermissions() {
  const { t } = useT()
  const perms = useStore((s) => s.site.permissions)
  const patchSite = useStore((s) => s.patchSite)
  const setT = (k: keyof Permissions['teacher'], v: boolean) => patchSite((s) => ({ ...s, permissions: { ...s.permissions, teacher: { ...s.permissions.teacher, [k]: v } } }))
  const setS = (k: keyof Permissions['student'], v: boolean) => patchSite((s) => ({ ...s, permissions: { ...s.permissions, student: { ...s.permissions.student, [k]: v } } }))
  const matrix: { area: string; admin: boolean; teacher: boolean | 'own'; student: boolean | 'own' }[] = [
    { area: t('admin.pages'), admin: true, teacher: false, student: false },
    { area: t('admin.theme'), admin: true, teacher: false, student: false },
    { area: t('admin.courses'), admin: true, teacher: 'own', student: false },
    { area: t('common.videos') + ' / ' + t('common.playlists') + ' / ' + t('common.resources'), admin: true, teacher: 'own', student: false },
    { area: t('studio.channel'), admin: true, teacher: 'own', student: false },
    { area: t('admin.packages'), admin: true, teacher: false, student: false },
    { area: t('student.subscription') + ' / ' + t('student.profile'), admin: true, teacher: false, student: 'own' },
    { area: t('admin.permissions'), admin: true, teacher: false, student: false },
  ]
  const cell = (v: boolean | 'own') => v === true ? <Icon name="check" className="mx-auto h-4 w-4 text-forest" /> : v === 'own' ? <span className="text-[11px] text-champagne">{t('access.ownerBadge')}</span> : <span className="text-charcoal/25">—</span>
  return (
    <div>
      <PageTitle eyebrow={t('dash.admin')} title={t('admin.permissions')} subtitle={t('admin.perm.hint')} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <Eyebrow className="mb-4">{t('role.teacher')}</Eyebrow>
          <div className="divide-y divide-charcoal/10">{TEACHER.map((k) => <div key={k} className="py-3"><Toggle checked={perms.teacher[k]} onChange={(v) => setT(k, v)} label={t(`perm.teacher.${k}` as TKey)} /></div>)}</div>
        </Card>
        <div className="space-y-6">
          <Card>
            <Eyebrow className="mb-4">{t('role.student')}</Eyebrow>
            <div className="divide-y divide-charcoal/10">{STUDENT.map((k) => <div key={k} className="py-3"><Toggle checked={perms.student[k]} onChange={(v) => setS(k, v)} label={t(`perm.student.${k}` as TKey)} /></div>)}</div>
          </Card>
          <Notice tone="info">{t('perm.superAdminNote')}</Notice>
        </div>
        <Card className="lg:col-span-2 overflow-x-auto p-0">
          <div className="px-5 pt-5"><Eyebrow>{t('perm.roleMatrix')}</Eyebrow></div>
          <table className="mt-3 w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wider text-charcoal/50"><tr><th className="px-5 py-2">—</th><th className="px-3 py-2 text-center">{t('role.admin')}</th><th className="px-3 py-2 text-center">{t('role.teacher')}</th><th className="px-3 py-2 text-center">{t('role.student')}</th></tr></thead>
            <tbody className="divide-y divide-charcoal/8">{matrix.map((m) => <tr key={m.area}><td className="px-5 py-2.5 text-charcoal/80">{m.area}</td><td className="px-3 py-2.5 text-center">{cell(m.admin)}</td><td className="px-3 py-2.5 text-center">{cell(m.teacher)}</td><td className="px-3 py-2.5 text-center">{cell(m.student)}</td></tr>)}</tbody>
          </table>
          <p className="px-5 py-4 text-xs text-charcoal/45">{t('access.securityNote')}</p>
        </Card>
      </div>
    </div>
  )
}
