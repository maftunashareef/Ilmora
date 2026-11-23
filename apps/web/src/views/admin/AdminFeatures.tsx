import { Card, Eyebrow, PageTitle, Toggle } from '../../components/ui'
import { useT } from '../../i18n/useT'
import type { TKey } from '../../i18n/translations'
import { useStore } from '../../store/useStore'
import type { Features } from '../../types'

const FEATURES: (keyof Features)[] = ['teacherChannels', 'savedItems', 'centerInquiry', 'scrollVideo', 'threeD', 'announcements', 'faq', 'publicSearch']
const STUDENT_MODULES: Record<string, TKey> = { overview: 'dash.overview', subscription: 'student.subscription', courses: 'student.courses', timetable: 'student.timetable', videos: 'student.videos', resources: 'student.resources', attendance: 'student.attendance', saved: 'student.saved', profile: 'student.profile' }
const TEACHER_MODULES: Record<string, TKey> = { overview: 'dash.overview', subjects: 'studio.subjects', videos: 'studio.videos', playlists: 'studio.playlists', resources: 'studio.resources', groups: 'studio.groups', channel: 'studio.channel', visibility: 'studio.visibility' }

export function AdminFeatures() {
  const { t } = useT()
  const features = useStore((s) => s.site.features)
  const dashboards = useStore((s) => s.site.dashboards)
  const patchSite = useStore((s) => s.patchSite)
  const setFeature = (k: keyof Features, v: boolean) => patchSite((s) => ({ ...s, features: { ...s.features, [k]: v } }))
  const setModule = (dash: 'student' | 'teacher', id: string, v: boolean) => patchSite((s) => ({ ...s, dashboards: { ...s.dashboards, [dash]: s.dashboards[dash].map((m) => (m.id === id ? { ...m, enabled: v } : m)) } }))
  return (
    <div>
      <PageTitle eyebrow={t('dash.admin')} title={t('admin.features')} subtitle={t('admin.features.hint')} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <Eyebrow className="mb-4">{t('admin.features')}</Eyebrow>
          <div className="divide-y divide-charcoal/10">
            {FEATURES.map((k) => <div key={k} className="py-3"><Toggle checked={features[k]} onChange={(v) => setFeature(k, v)} label={t(`feature.${k}` as TKey)} /></div>)}
          </div>
        </Card>
        <div className="space-y-6">
          <Card>
            <Eyebrow className="mb-1">{t('admin.dashboards')} · {t('dash.studentSpace')}</Eyebrow>
            <p className="mb-3 text-xs text-charcoal/50">{t('admin.dash.hint')}</p>
            <div className="divide-y divide-charcoal/10">
              {dashboards.student.map((m) => <div key={m.id} className="py-2.5"><Toggle checked={m.enabled} disabled={m.id === 'overview'} onChange={(v) => setModule('student', m.id, v)} label={t(STUDENT_MODULES[m.id] ?? 'dash.overview')} /></div>)}
            </div>
          </Card>
          <Card>
            <Eyebrow className="mb-3">{t('admin.dashboards')} · {t('dash.teacherStudio')}</Eyebrow>
            <div className="divide-y divide-charcoal/10">
              {dashboards.teacher.map((m) => <div key={m.id} className="py-2.5"><Toggle checked={m.enabled} disabled={m.id === 'overview'} onChange={(v) => setModule('teacher', m.id, v)} label={t(TEACHER_MODULES[m.id] ?? 'dash.overview')} /></div>)}
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}
