import { isOnlineCourse, isSafeExternalUrl } from '@ilmora/shared'
import { Link } from '@/lib/router'
import { FormatBadge } from '../../components/course/CourseCard'
import { getCoursePhotoUrl } from '../../components/course/courseImage'
import { ArtCover, Card, Eyebrow, Icon, LinkButton } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { checkAccess } from '../../lib/access'
import { useCurrentStudent, useViewer } from '../../store/selectors'
import { useStore } from '../../store/useStore'

/**
 * The student's saved online courses, with a button that opens each one on the provider's own site. Online courses are
 * free and have no groups, so they are not part of the subscription: saving is how a student "selects" one.
 */
export function OnlineCoursesSection() {
  const { t, tr } = useT()
  const student = useCurrentStudent()
  const viewer = useViewer()
  const courses = useStore((s) => s.courses)
  const categories = useStore((s) => s.categories)
  if (!student) return null
  const mine = courses.filter((c) => isOnlineCourse(c) && student.savedCourseIds.includes(c.id) && checkAccess(c, viewer).allowed)

  return (
    <section className="mt-10">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
        <div>
          <Eyebrow>{t('student.online.title')}</Eyebrow>
          <p className="mt-1 text-xs text-charcoal/55">{t('student.online.hint')}</p>
        </div>
        <Link to="/courses?format=online" className="text-xs font-medium text-forest">{t('student.online.browse')} →</Link>
      </div>
      {mine.length === 0 ? (
        <Card className="border-dashed border-charcoal/15 bg-paper/60 p-5 text-sm text-charcoal/60">{t('student.online.empty')}</Card>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {mine.map((c) => (
            <li key={c.id} className="card flex flex-col gap-3 p-4">
              <div className="flex items-start gap-3">
                <ArtCover seed={c.coverSeed} imageUrl={getCoursePhotoUrl(c)} className="h-16 w-24 shrink-0 rounded-control" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <FormatBadge course={c} />
                    <span className="truncate text-[11px] text-charcoal/50">{tr(categories.find((x) => x.id === c.categoryId)?.name)}</span>
                  </div>
                  <Link to={`/courses/${c.id}`} className="mt-1 block font-medium text-charcoal hover:text-forest">{tr(c.title)}</Link>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-charcoal/55">
                    {c.providerName && <span>{c.providerName}</span>}
                    {c.instructorName && <span>{c.instructorName}</span>}
                    {c.durationText && tr(c.durationText) && <span>{tr(c.durationText)}</span>}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isSafeExternalUrl(c.externalUrl) && (
                  <LinkButton to={c.externalUrl as string} external size="sm">
                    {t('online.open')}<Icon name="external" className="h-3.5 w-3.5" />
                  </LinkButton>
                )}
                <LinkButton to={`/courses/${c.id}`} variant="secondary" size="sm">{t('common.view')}</LinkButton>
                {c.certificate && c.certificate !== 'NONE' && <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-charcoal/55"><Icon name="check" className="h-3 w-3 text-forest" />{t(`online.cert.${c.certificate}` as 'online.cert.FREE')}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
