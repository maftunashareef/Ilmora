'use client'
import { isOnlineCourse, isSafeExternalUrl, MAX_CART_COURSES } from '@ilmora/shared'
import { CourseCard } from '../../components/course/CourseCard'
import { Button, EmptyState, Icon, LinkButton, Notice, PageTitle } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { useNavigate } from '../../lib/router'
import { useCanSaveCourses, useCurrentStudent, useHydrated } from '../../store/selectors'
import { useStore, type BuilderResult } from '../../store/useStore'
import type { Course } from '../../types'

/**
 * Saved courses with "remove" and "add to cart". Saving is never a purchase: adding to the cart only fills the same
 * draft the builder uses, so the existing validation (seats, schedule overlaps, duplicates, limits) applies.
 */
export function SavedCourseGrid() {
  const { t } = useT()
  const nav = useNavigate()
  const student = useCurrentStudent()
  const courses = useStore((s) => s.courses)
  const toggleSaved = useStore((s) => s.toggleSavedCourse)
  const addBuilderGroup = useStore((s) => s.addBuilderGroup)
  const notify = useStore((s) => s.notify)
  const hydrated = useHydrated()
  if (!student || !hydrated) return null

  const saved = courses.filter((c) => student.savedCourseIds.includes(c.id))
  if (saved.length === 0) {
    return <EmptyState title={t('student.saved.empty')} body={t('favorites.empty')} action={<LinkButton to="/courses">{t('common.courses')}</LinkButton>} />
  }

  const failure = (reason: Extract<BuilderResult, { ok: false }>['reason']) =>
    ({
      'no-package': t('builder.pickPackageFirst'),
      limit: student.builder.packageId ? t('builder.limitReached') : t('builder.customLimit', { n: MAX_CART_COURSES }),
      duplicate: t('builder.duplicate'),
      conflict: `${t('builder.conflict')}: ${t('builder.conflictHint')}`,
      disabled: t('builder.packageDisabled'),
      full: `${t('capacity.full')} — ${t('capacity.fullHint')}`,
    })[reason]

  const addToCart = (c: Course) => {
    // A course with several groups needs the builder's group picker; a single group can be added right here.
    if (c.groups.length !== 1) {
      nav(`/builder?add=${encodeURIComponent(c.id)}`)
      return
    }
    const r = addBuilderGroup(student.id, c.groups[0].id)
    if (r.ok) notify(t('courses.inPlan'))
    else notify(failure(r.reason), 'warn')
  }

  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {saved.map((c) => {
        const inCart = student.builder.groupIds.some((id) => c.groups.some((g) => g.id === id))
        return (
          <div key={c.id}>
            <CourseCard course={c} />
            <div className="mt-3 flex gap-2">
              {isOnlineCourse(c) ? (
                // Online courses have no groups and never enter the cart: they open on the provider's site.
                isSafeExternalUrl(c.externalUrl) ? (
                  <LinkButton to={c.externalUrl as string} external size="sm" className="flex-1">
                    {t('online.open')}
                    <Icon name="external" className="h-3.5 w-3.5" />
                  </LinkButton>
                ) : (
                  <span className="flex-1" />
                )
              ) : inCart ? (
                <Button size="sm" variant="secondary" className="flex-1" onClick={() => nav('/builder')}>
                  <Icon name="check" className="h-3.5 w-3.5" />
                  {t('favorites.inCart')}
                </Button>
              ) : (
                <Button size="sm" className="flex-1" onClick={() => addToCart(c)}>
                  <Icon name="cart" className="h-3.5 w-3.5" />
                  {t('favorites.addToCart')}
                </Button>
              )}
              <Button size="sm" variant="ghost" aria-label={t('favorites.remove')} onClick={() => toggleSaved(student.id, c.id)}>
                <Icon name="x" className="h-3.5 w-3.5" />
                {t('common.remove')}
              </Button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** Public page: works for visitors (saved locally) and for signed-in students (saved on the account). */
export function FavoritesPage() {
  const { t } = useT()
  const canSave = useCanSaveCourses()
  return (
    <div className="container-x py-12 lg:py-16">
      <PageTitle eyebrow={t('nav.favorites')} title={t('favorites.title')} subtitle={t('favorites.subtitle')} />
      {canSave ? <SavedCourseGrid /> : <Notice tone="warn">{t('dash.moduleDisabled')}</Notice>}
    </div>
  )
}
