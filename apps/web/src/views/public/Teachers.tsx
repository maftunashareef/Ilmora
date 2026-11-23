'use client'
import { countLabel, foldForSearch, ilmoraUz, NOUNS } from '@ilmora/shared'
import { useMemo, useState } from 'react'
import { Link } from '@/lib/router'
import { Avatar, Badge, Button, Icon, Input, Notice, PageTitle, Select } from '../../components/ui'
import { getTeacherAvatarUrl } from '../../components/teacher/teacherImage'
import { useT } from '../../i18n/useT'
import { isPublicListed } from '../../lib/access'
import { useStore } from '../../store/useStore'

export function TeachersPage() {
  const { t, tr, lang } = useT()
  const enabled = useStore((s) => s.site.features.teacherChannels)
  const teachers = useStore((s) => s.teachers)
  const centers = useStore((s) => s.centers)
  const courses = useStore((s) => s.courses)
  const videos = useStore((s) => s.videos)
  const subjects = useStore((s) => s.subjects)

  const [q, setQ] = useState('')
  const [selectedSubject, setSelectedSubject] = useState<string>('all')

  // Collect available subjects for filtering (from both defined subjects and teacher courses)
  const availableSubjects = useMemo(() => {
    const map = new Map<string, string>()
    for (const sub of subjects) {
      const label = tr(sub.name)
      if (label && !map.has(sub.id)) {
        map.set(sub.id, label)
      }
    }
    // Also include subjects referenced by courses
    for (const c of courses) {
      if (c.subjectId && !map.has(c.subjectId)) {
        const found = subjects.find((s) => s.id === c.subjectId)
        if (found) map.set(found.id, tr(found.name))
      }
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
  }, [subjects, courses, tr])

  const ql = foldForSearch(q.trim())

  const list = useMemo(() => {
    return teachers.filter((te) => {
      if (!te.channelActive) return false

      // Subject filter
      if (selectedSubject !== 'all') {
        const teachesSubject = courses.some(
          (c) => c.teacherId === te.id && c.subjectId === selectedSubject
        ) || subjects.some(
          (s) => s.teacherId === te.id && s.id === selectedSubject
        )
        if (!teachesSubject) return false
      }

      // Search query (teacher name, title, expertise, center)
      if (ql) {
        const center = centers.find((c) => c.id === te.centerId)
        const haystack = foldForSearch([te.name, tr(te.title), tr(te.tagline), ...te.expertise, center?.name ?? ''].join(' '))
        if (!haystack.includes(ql)) return false
      }

      return true
    })
  }, [teachers, selectedSubject, ql, courses, subjects, centers, tr])

  const isFiltered = q !== '' || selectedSubject !== 'all'

  const resetFilters = () => {
    setQ('')
    setSelectedSubject('all')
  }

  return (
    <div className="container-x py-12 lg:py-16">
      <PageTitle
        eyebrow={t('common.teachers')}
        title={t('teachers.title')}
        subtitle={t('teachers.subtitle')}
        action={
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
            {/* Subject filter */}
            {availableSubjects.length > 0 && (
              <div className="w-full sm:w-48">
                <Select
                  aria-label={t('teachers.filterBySubject')}
                  value={selectedSubject}
                  onChange={(e) => setSelectedSubject(e.target.value)}
                  className="bg-paper"
                >
                  <option value="all">{t('teachers.allSubjects')}</option>
                  {availableSubjects.map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      {sub.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            {/* Search input */}
            <div className="relative w-full sm:w-72">
              <Icon
                name="search"
                className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-charcoal/40"
              />
              <Input
                aria-label={t('common.search')}
                className="pl-10"
                placeholder={t('teachers.searchPlaceholder')}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {q && (
                <button
                  type="button"
                  onClick={() => setQ('')}
                  aria-label={t('common.remove')}
                  className="absolute right-3 top-3 text-charcoal/40 hover:text-charcoal"
                >
                  <Icon name="x" className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        }
      />

      {!enabled && (
        <Notice tone="warn" className="mb-6">
          {t('teachers.channelsDisabled')}
        </Notice>
      )}

      {list.length === 0 ? (
        <div className="mt-8 rounded-card border border-charcoal/10 bg-paper/50 p-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-sage text-forest">
            <Icon name="search" className="h-6 w-6" />
          </div>
          <h2 className="mt-4 font-display text-2xl text-charcoal">
            {isFiltered ? t('teachers.noResults') : t('common.empty')}
          </h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-charcoal/60">
            {isFiltered
              ? t('teachers.noResultsHint')
              : !enabled
                ? t('teachers.channelsDisabled')
                : t('teachers.noResultsHint')}
          </p>
          {isFiltered && (
            <div className="mt-5">
              <Button variant="secondary" onClick={resetFilters}>
                <Icon name="x" className="h-4 w-4" />
                {t('teachers.resetFilters')}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="reveal-stagger grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((te) => {
            const center = centers.find((c) => c.id === te.centerId)
            const nCourses = courses.filter((c) => c.teacherId === te.id && isPublicListed(c)).length
            const nVideos = videos.filter((v) => v.teacherId === te.id && isPublicListed(v)).length
            const photoUrl = getTeacherAvatarUrl(te)
            const bannerBg = te.bannerUpload?.previewUrl
              ? `url(${te.bannerUpload.previewUrl}) center/cover`
              : te.bannerUrl
              ? `url(${te.bannerUrl}) center/cover`
              : `linear-gradient(120deg, ${te.bannerTone}, ${te.bannerTone}cc 60%, #CA9A3655)`

            const Wrapper = enabled ? Link : 'div'

            return (
              <Wrapper
                key={te.id}
                to={`/teachers/${te.id}`}
                className="reveal card group overflow-hidden p-0 transition-all duration-300 hover:-translate-y-1 hover:shadow-lift focus:outline-none focus-visible:ring-2 focus-visible:ring-forest focus-visible:ring-offset-2"
              >
                <div
                  className="h-24 transition duration-500 group-hover:brightness-105"
                  style={{ background: bannerBg }}
                />
                <div className="-mt-9 px-5 pb-5">
                  <div className="relative inline-block">
                    <Avatar
                      name={te.name}
                      seed={te.avatarSeed}
                      size={68}
                      url={photoUrl}
                      alt={te.name}
                      className="ring-4 ring-paper transition-transform duration-300 group-hover:scale-105"
                    />
                  </div>
                  <div className="mt-3 font-display text-2xl text-charcoal transition-colors duration-300 group-hover:text-forest">
                    {te.name}
                  </div>
                  <div className="text-xs font-medium text-charcoal/60">
                    {tr(te.title)}
                  </div>
                  {te.tagline && (
                    <p className="mt-2 line-clamp-2 text-xs italic text-charcoal/50">
                      “{tr(te.tagline)}”
                    </p>
                  )}
                  {te.expertise.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {te.expertise.slice(0, 3).map((e) => (
                        <Badge key={e} tone="muted">
                          {lang === 'uz' ? ilmoraUz(e) : e}
                        </Badge>
                      ))}
                      {te.expertise.length > 3 && (
                        <span className="self-center text-[11px] text-charcoal/45">
                          +{te.expertise.length - 3}
                        </span>
                      )}
                    </div>
                  )}
                  <div className="mt-4 flex items-center justify-between border-t border-charcoal/10 pt-3 text-[11px] text-charcoal/50">
                    <span className="truncate">{center?.name}</span>
                    <span className="shrink-0 font-medium text-charcoal/65">
                      {countLabel(lang, nCourses, NOUNS.course)} ·{' '}
                      {countLabel(lang, nVideos, NOUNS.video)}
                    </span>
                  </div>
                </div>
              </Wrapper>
            )
          })}
        </div>
      )}
    </div>
  )
}
