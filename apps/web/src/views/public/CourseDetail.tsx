import { isOnlineCourse, isSafeExternalUrl, MAX_CART_COURSES } from '@ilmora/shared'
import { Link, useNavigate, useParams } from '@/lib/router'
import { AccessDenied, NotFound } from '../../components/AccessGate'
import { AccessBadge, LevelBadge, StatusBadge, VisibilityBadge } from '../../components/course/badges'
import { CoursePrice, FormatBadge, ScheduleChips } from '../../components/course/CourseCard'
import { getCoursePhotoUrl } from '../../components/course/courseImage'
import { getTeacherAvatarUrl } from '../../components/teacher/teacherImage'
import { ArtCover, Avatar, Badge, Button, Card, cx, Eyebrow, Icon, LinkButton, Notice } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { checkAccess } from '../../lib/access'
import { enrolledCount, isGroupFull } from '../../lib/enrollment'
import { formatDuration } from '../../lib/format'
import { useCanSaveCourses, useCurrentStudent, useHydrated, useViewer } from '../../store/selectors'
import { useStore } from '../../store/useStore'

export function CourseDetailPage() {
  const { id } = useParams()
  const { t, tr } = useT()
  const nav = useNavigate()
  const viewer = useViewer()
  const course = useStore((s) => s.courses.find((c) => c.id === id))
  const teacher = useStore((s) => s.teachers.find((x) => x.id === course?.teacherId))
  const center = useStore((s) => s.centers.find((x) => x.id === course?.centerId))
  const category = useStore((s) => s.categories.find((x) => x.id === course?.categoryId))
  const videos = useStore((s) => s.videos.filter((v) => v.courseId === id))
  const resources = useStore((s) => s.resources.filter((r) => r.courseId === id))
  const student = useCurrentStudent()
  const students = useStore((s) => s.students)
  const addBuilderGroup = useStore((s) => s.addBuilderGroup)
  const toggleSaved = useStore((s) => s.toggleSavedCourse)
  const notify = useStore((s) => s.notify)
  const canSave = useCanSaveCourses()
  const hydrated = useHydrated()
  const channelsOn = useStore((s) => s.site.features.teacherChannels)

  if (!course) return <NotFound />
  const access = checkAccess(course, viewer)
  if (!access.allowed) return <AccessDenied result={access} backTo={{ to: '/courses', label: t('common.courses') }} />

  const inPlan = student?.builder.groupIds.find((gid) => course.groups.some((g) => g.id === gid))
  const enrolled = student?.subscription.status === 'active' && student.subscription.groupIds.some((gid) => course.groups.some((g) => g.id === gid))
  const saved = hydrated && !!student?.savedCourseIds.includes(course.id)
  const online = isOnlineCourse(course)

  const add = (groupId: string) => {
    if (!student) return
    const r = addBuilderGroup(student.id, groupId)
    if (r.ok) notify(t('courses.inPlan'))
    else if (r.reason === 'limit') notify(student.builder.packageId ? t('builder.limitReached') : t('builder.customLimit', { n: MAX_CART_COURSES }), 'warn')
    else if (r.reason === 'duplicate') notify(t('builder.duplicate'), 'warn')
    else if (r.reason === 'conflict') notify(`${t('builder.conflict')}: ${t('builder.conflictHint')}`, 'warn')
    else if (r.reason === 'disabled') notify(t('builder.packageDisabled'), 'warn')
    else if (r.reason === 'full') notify(`${t('capacity.full')} — ${t('capacity.fullHint')}`, 'warn')
    else notify(t('builder.pickPackageFirst'), 'warn')
  }

  const visibleVideos = videos.filter((v) => checkAccess(v, viewer).allowed)
  const visibleResources = resources.filter((r) => checkAccess(r, viewer).allowed)

  return (
    <article className="animate-fade">
      <div className="container-x pt-8">
        <Link to="/courses" className="inline-flex items-center gap-1 text-xs text-charcoal/55 hover:text-forest"><Icon name="arrowLeft" className="h-3.5 w-3.5" />{t('common.courses')}</Link>
      </div>
      <div className="container-x grid gap-10 py-8 lg:grid-cols-[1.2fr_0.8fr] lg:py-12">
        <div>
          <ArtCover seed={course.coverSeed} imageUrl={course.imageUpload?.previewUrl || course.imageUrl || getCoursePhotoUrl(course)} alt={tr(course.title)} tone={center?.tone} className="aspect-[16/8] w-full rounded-card" label={course.id === 'c-bazis' ? 'B' : undefined} />
          <div className="mt-8 flex flex-wrap items-center gap-2">
            <FormatBadge course={course} />
            {category && <Badge tone="sage">{tr(category.name)}</Badge>}
            <LevelBadge level={course.level} />
            {course.featured && <Badge tone="champagne"><Icon name="star" className="h-3 w-3" />{t('common.featured')}</Badge>}
            {(viewer.role === 'admin' || viewer.role === 'teacher') && (<><StatusBadge status={course.status} /><VisibilityBadge visibility={course.visibility} /></>)}
            <AccessBadge reason={access.reason} />
          </div>
          <h1 className="mt-4 font-display text-5xl leading-[1.02] text-charcoal md:text-6xl">{tr(course.title)}</h1>
          <p className="mt-4 max-w-2xl text-lg leading-relaxed text-charcoal/70">{tr(course.summary)}</p>

          <section className="mt-12">
            <Eyebrow className="mb-3">{t('courses.aboutCourse')}</Eyebrow>
            <p className="prose-soft max-w-2xl text-[15px] leading-relaxed text-charcoal/75">{tr(course.description)}</p>
          </section>

          <section className="mt-12">
            <Eyebrow className="mb-4">{t('courses.whatYouLearn')}</Eyebrow>
            <ol className="grid gap-2 sm:grid-cols-2">
              {course.curriculum.map((item, i) => (
                <li key={i} className="flex gap-3 rounded-control border border-charcoal/10 bg-paper px-4 py-3 text-sm text-charcoal/80">
                  <span className="font-display text-lg leading-none text-champagne">{String(i + 1).padStart(2, '0')}</span>
                  {tr(item)}
                </li>
              ))}
            </ol>
          </section>

          {(visibleVideos.length > 0 || visibleResources.length > 0) && (
            <section className="mt-12 grid gap-8 md:grid-cols-2">
              {visibleVideos.length > 0 && (
                <div>
                  <Eyebrow className="mb-4">{t('courses.relatedVideos')}</Eyebrow>
                  <ul className="space-y-2">
                    {visibleVideos.map((v) => {
                      const a = checkAccess(v, viewer)
                      return (
                        <li key={v.id}>
                          <Link to={`/videos/${v.id}`} className="card flex items-center gap-3 p-3 transition hover:shadow-lift">
                            <ArtCover seed={v.coverSeed} className="h-12 w-20 shrink-0 rounded-control" imageUrl={v.thumbnailUpload?.previewUrl || v.thumbnailUrl} />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium text-charcoal">{tr(v.title)}</div>
                              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-charcoal/50">{formatDuration(v.durationSec)}{a.allowed && a.reason !== 'public' && <VisibilityBadge visibility={v.visibility} />}</div>
                            </div>
                            <Icon name="play" className="h-4 w-4 text-forest" />
                          </Link>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
              {visibleResources.length > 0 && (
                <div>
                  <Eyebrow className="mb-4">{t('courses.relatedResources')}</Eyebrow>
                  <ul className="space-y-2">
                    {visibleResources.map((r) => (
                      <li key={r.id}>
                        <Link to={`/resources/${r.id}`} className="card flex items-center gap-3 p-3 transition hover:shadow-lift">
                          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-control bg-sage text-forest"><Icon name="file" className="h-5 w-5" /></span>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium text-charcoal">{tr(r.title)}</div>
                            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-charcoal/50">{t(`kind.${r.kind}`)}{r.visibility === 'private' && <VisibilityBadge visibility="private" />}</div>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          {online && (
            <>
              <Card className="p-6 md:p-7">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="eyebrow">{t('format.onlineHint')}</div>
                    <div className="mt-1 font-display text-4xl text-forest">{t('online.free')}</div>
                  </div>
                  {canSave && student && (
                    <Button variant="ghost" size="sm" aria-pressed={saved} onClick={() => toggleSaved(student.id, course.id)}>
                      <Icon name={saved ? 'bookmarkFill' : 'bookmark'} className="h-4 w-4" />{saved ? t('channel.saved') : t('channel.save')}
                    </Button>
                  )}
                </div>
                <dl className="mt-5 grid grid-cols-2 gap-3 text-xs">
                  {course.providerName && <div className="col-span-2"><dt className="text-charcoal/50">{t('online.provider')}</dt><dd className="mt-0.5 font-medium text-charcoal">{course.providerName}</dd></div>}
                  {course.instructorName && <div className="col-span-2"><dt className="text-charcoal/50">{t('online.instructor')}</dt><dd className="mt-0.5 font-medium text-charcoal">{course.instructorName}</dd></div>}
                  {course.durationText && tr(course.durationText) && <div className="col-span-2"><dt className="text-charcoal/50">{t('common.duration')}</dt><dd className="mt-0.5 font-medium text-charcoal">{tr(course.durationText)}</dd></div>}
                  <div><dt className="text-charcoal/50">{t('common.level')}</dt><dd className="mt-0.5 font-medium text-charcoal">{t(`level.${course.level}`)}</dd></div>
                  <div><dt className="text-charcoal/50">{t('online.certificate')}</dt><dd className="mt-0.5 font-medium text-charcoal">{t(`online.cert.${course.certificate ?? 'NONE'}` as 'online.cert.NONE')}</dd></div>
                </dl>
                {isSafeExternalUrl(course.externalUrl) && (
                  <LinkButton to={course.externalUrl as string} external size="lg" className="mt-6 w-full justify-center">
                    {t('online.open')}<Icon name="external" className="h-4 w-4" />
                  </LinkButton>
                )}
                <p className="mt-4 text-[11px] leading-relaxed text-charcoal/50">{t('online.externalNote')}</p>
                <p className="mt-2 text-[11px] leading-relaxed text-charcoal/50">{t('online.notSubscription')}</p>
              </Card>
              <Card className="mt-4 p-6">
                <div className="eyebrow mb-3">{t('courses.providedBy')}</div>
                <div className="font-display text-xl text-charcoal">{course.providerName}</div>
                {course.instructorName && (
                  <div className="mt-5 flex items-center gap-3 border-t border-charcoal/10 pt-5">
                    <Avatar name={course.instructorName} seed={course.coverSeed} size={44} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-charcoal">{course.instructorName}</div>
                      <div className="truncate text-xs text-charcoal/55">{t('online.instructor')}</div>
                    </div>
                  </div>
                )}
              </Card>
            </>
          )}
          {!online && (
          <>
          <Card className="p-6 md:p-7">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="eyebrow">{t('courses.monthlyPrice')}</div>
                <CoursePrice course={course} emphasis className="mt-1" />
              </div>
              {canSave && student && (
                <Button variant="ghost" size="sm" aria-pressed={saved} onClick={() => toggleSaved(student.id, course.id)}>
                  <Icon name={saved ? 'bookmarkFill' : 'bookmark'} className="h-4 w-4" />{saved ? t('channel.saved') : t('channel.save')}
                </Button>
              )}
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-3 text-xs">
              <div><dt className="text-charcoal/50">{t('common.duration')}</dt><dd className="mt-0.5 font-medium text-charcoal">{course.durationMonths} {t('common.months')}</dd></div>
              <div><dt className="text-charcoal/50">{t('common.level')}</dt><dd className="mt-0.5 font-medium text-charcoal">{t(`level.${course.level}`)}</dd></div>
            </dl>
            <div className="mt-6 border-t border-charcoal/10 pt-5">
              <div className="eyebrow mb-3">{t('courses.groupsAndSchedule')}</div>
              <ul className="space-y-2">
                {course.groups.map((g) => {
                  const chosen = inPlan === g.id
                  const full = isGroupFull(g, students, student?.id)
                  return (
                    <li key={g.id} className={cx('rounded-control border p-3', chosen ? 'border-forest bg-sage/50' : 'border-charcoal/10')}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-charcoal">{g.name}</span>
                        <span className={cx('text-[11px]', full ? 'text-amber-800' : 'text-charcoal/50')}>{t('capacity.students', { n: enrolledCount(students, g.id), max: g.capacity })}</span>
                      </div>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <ScheduleChips group={g} />
                        <span className="text-[11px] text-charcoal/45">{t('common.room')} {g.room}</span>
                      </div>
                      <Button size="sm" variant={chosen ? 'secondary' : 'primary'} className="mt-3 w-full" disabled={full && !chosen} onClick={() => (chosen ? nav('/builder') : add(g.id))}>
                        {chosen ? <><Icon name="check" className="h-3.5 w-3.5" />{t('courses.inPlan')}</> : full ? t('capacity.full') : t('courses.addToPlan')}
                      </Button>
                    </li>
                  )
                })}
              </ul>
              {enrolled && <Notice tone="ok" className="mt-3 text-xs">{t('student.myGroup')} · {t('preview.renewalNote')}</Notice>}
              <p className="mt-4 text-[11px] leading-relaxed text-charcoal/50">{t('courses.enrollNote')}</p>
            </div>
          </Card>

          <Card className="mt-4 p-6">
            <div className="eyebrow mb-3">{t('courses.providedBy')}</div>
            {center && (
              <div className="flex items-start gap-3">
                <span className="mt-1 h-9 w-1 rounded-full" style={{ background: center.tone }} />
                <div>
                  <Link to={`/centers/${center.slug ?? center.id}`} className="font-display text-xl text-charcoal hover:text-forest">{center.name}</Link>
                  <div className="text-xs text-charcoal/55">{tr(center.district)}</div>
                </div>
              </div>
            )}
            {teacher && (
              <div className="mt-5 flex items-center gap-3 border-t border-charcoal/10 pt-5">
                <Avatar name={teacher.name} seed={teacher.avatarSeed} size={44} url={getTeacherAvatarUrl(teacher)} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-charcoal">{teacher.name}</div>
                  <div className="truncate text-xs text-charcoal/55">{tr(teacher.title)}</div>
                </div>
                {channelsOn && teacher.channelActive && <Link to={`/teachers/${teacher.id}`} className="text-xs font-medium text-forest">{t('courses.seeChannel')} →</Link>}
              </div>
            )}
          </Card>
          </>
          )}
        </aside>
      </div>
    </article>
  )
}
