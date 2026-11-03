'use client'
import { countLabel, NOUNS } from '@ilmora/shared'
import { NotFound } from '../../components/AccessGate'
import { CourseCard } from '../../components/course/CourseCard'
import { getTeacherAvatarUrl } from '../../components/teacher/teacherImage'
import { Avatar, Card, EmptyState, Eyebrow, Icon, LinkButton, Stat } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { isPublicListed } from '../../lib/access'
import { Link, useParams } from '../../lib/router'
import { useViewer } from '../../store/selectors'
import { useStore } from '../../store/useStore'

/** Public page of an Educational Center: who they are, where they are, their directions, teachers and open courses. */
export function CenterPage() {
  const { id = '' } = useParams<{ id: string }>()
  const { t, tr, lang } = useT()
  const viewer = useViewer()
  const user = useStore((s) => s.auth.user)
  const center = useStore((s) => s.centers.find((c) => c.slug === id || c.id === id))
  const courses = useStore((s) => s.courses.filter((c) => c.centerId === center?.id && isPublicListed(c)))
  const teachers = useStore((s) => s.teachers.filter((x) => x.centerId === center?.id))
  const categories = useStore((s) => s.categories)
  if (!center) return <NotFound />
  const cats = categories.filter((cat) => courses.some((c) => c.categoryId === cat.id))
  const ownWorkspace = viewer.role === 'center' && user?.centerId === center.id
  const hasContact = !!(center.address || center.phone)

  return (
    <div className="container-x py-10 lg:py-14">
      <Link to="/centers" className="text-xs font-medium text-forest underline">← {t('center.page.allCenters')}</Link>
      <header className="mt-4 flex flex-wrap items-start gap-4">
        <span className="mt-2 h-14 w-1.5 shrink-0 rounded-full" style={{ background: center.tone }} />
        <div className="min-w-0 flex-1">
          <Eyebrow>{t('common.centers')}</Eyebrow>
          <h1 className="mt-1 font-display text-4xl text-charcoal md:text-5xl">{center.name}</h1>
          <div className="mt-2 text-sm text-charcoal/60">{tr(center.district)}{center.address ? ` · ${center.address}` : ''}</div>
        </div>
        {(viewer.role === 'admin' || ownWorkspace) && (
          <div className="flex flex-wrap gap-2">
            {viewer.role === 'admin' && <LinkButton to={`/admin/centers/${center.id}`} variant="secondary" size="sm"><Icon name="shield" className="h-3.5 w-3.5" />{t('center.page.openAdmin')}</LinkButton>}
            {ownWorkspace && <LinkButton to="/center" variant="secondary" size="sm"><Icon name="building" className="h-3.5 w-3.5" />{t('center.page.openWorkspace')}</LinkButton>}
          </div>
        )}
      </header>
      <div className="reveal-stagger mt-8 grid gap-4 sm:grid-cols-3">
        <Stat label={t('common.courses')} value={courses.length} />
        <Stat label={t('common.teachers')} value={teachers.length} />
        <Stat label={t('common.categories')} value={cats.length} />
      </div>
      <div className="mt-10 grid gap-8 lg:grid-cols-[1.4fr_1fr]">
        <section>
          <Eyebrow className="mb-3">{t('center.page.about')}</Eyebrow>
          <Card className="p-6">
            <p className="text-sm leading-relaxed text-charcoal/75">{tr(center.description) || '—'}</p>
            {cats.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {cats.map((cat) => <span key={cat.id} className="rounded-full border border-charcoal/10 px-3 py-1 text-xs text-charcoal/70">{cat.glyph} {tr(cat.name)}</span>)}
              </div>
            )}
          </Card>
        </section>
        <section>
          <Eyebrow className="mb-3">{t('center.page.contact')}</Eyebrow>
          <Card className="p-6 text-sm">
            {hasContact ? (
              <dl className="space-y-3">
                <div><dt className="text-xs text-charcoal/50">{t('centers.form.district')}</dt><dd className="mt-0.5 text-charcoal">{tr(center.district) || '—'}</dd></div>
                {center.address && <div><dt className="text-xs text-charcoal/50">{t('center.address')}</dt><dd className="mt-0.5 text-charcoal">{center.address}</dd></div>}
                {center.phone && <div><dt className="text-xs text-charcoal/50">{t('center.phone')}</dt><dd className="mt-0.5"><a href={`tel:${center.phone}`} className="font-medium text-forest hover:underline">{center.phone}</a></dd></div>}
              </dl>
            ) : <p className="text-charcoal/55">{t('center.page.noContact')}</p>}
          </Card>
        </section>
      </div>
      <section className="mt-10">
        <Eyebrow className="mb-3">{t('common.teachers')} · {teachers.length}</Eyebrow>
        {teachers.length === 0 ? <EmptyState title={t('center.page.noTeachers')} /> : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {teachers.map((te) => (
              <li key={te.id}>
                <Link to={`/teachers/${te.id}`} className="card flex items-center gap-3 p-3 transition hover:-translate-y-0.5">
                  <Avatar name={te.name} seed={te.avatarSeed} size={44} url={getTeacherAvatarUrl(te)} />
                  <div className="min-w-0"><div className="truncate text-sm font-medium text-charcoal">{te.name}</div><div className="truncate text-xs text-charcoal/55">{tr(te.title)} · {countLabel(lang, courses.filter((c) => c.teacherId === te.id).length, NOUNS.course)}</div></div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="mt-10">
        <Eyebrow className="mb-3">{t('common.courses')} · {courses.length}</Eyebrow>
        {courses.length === 0 ? <EmptyState title={t('center.page.noCourses')} /> : (
          <div className="reveal-stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{courses.map((c) => <CourseCard key={c.id} course={c} />)}</div>
        )}
      </section>
    </div>
  )
}
