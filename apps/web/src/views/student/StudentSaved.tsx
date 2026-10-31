import { Link } from '@/lib/router'
import { SavedCourseGrid } from '../public/Favorites'
import { Avatar, Button, EmptyState, Eyebrow, Icon, Notice, PageTitle } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { useCurrentStudent } from '../../store/selectors'
import { useStore } from '../../store/useStore'

export function StudentSaved() {
  const { t, tr } = useT()
  const student = useCurrentStudent()
  const s = useStore()
  if (!student) return null
  const enabled = s.site.features.savedItems && s.site.permissions.student.saveItems
  const courses = s.courses.filter((c) => student.savedCourseIds.includes(c.id))
  const teachers = s.teachers.filter((x) => student.savedTeacherIds.includes(x.id))
  return (
    <div>
      <PageTitle eyebrow={t('dash.studentSpace')} title={t('student.saved')} />
      {!enabled && <Notice tone="warn" className="mb-6">{t('dash.moduleDisabled')}</Notice>}
      {courses.length === 0 && teachers.length === 0 ? <EmptyState title={t('student.saved.empty')} /> : (
        <div className="space-y-10">
          {courses.length > 0 && <section><Eyebrow className="mb-4">{t('student.saved.courses')}</Eyebrow><SavedCourseGrid /></section>}
          {teachers.length > 0 && <section><Eyebrow className="mb-4">{t('student.saved.teachers')}</Eyebrow><ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{teachers.map((te) => (
            <li key={te.id} className="card flex items-center gap-3 p-4"><Avatar name={te.name} seed={te.avatarSeed} size={44} url={te.avatarUrl || te.avatarUpload?.previewUrl} alt={te.name} /><div className="min-w-0 flex-1"><Link to={`/teachers/${te.id}`} className="truncate font-medium text-charcoal hover:text-forest">{te.name}</Link><div className="truncate text-xs text-charcoal/55">{tr(te.title)}</div></div><Button size="sm" variant="ghost" aria-label={t('common.remove')} onClick={() => s.toggleSavedTeacher(student.id, te.id)}><Icon name="x" className="h-3.5 w-3.5" /></Button></li>
          ))}</ul></section>}
        </div>
      )}
    </div>
  )
}
