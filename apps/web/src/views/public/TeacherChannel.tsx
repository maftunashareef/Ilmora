import { foldForSearch } from '@ilmora/shared'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from '@/lib/router'
import { NotFound } from '../../components/AccessGate'
import { VisibilityBadge } from '../../components/course/badges'
import { CourseCard } from '../../components/course/CourseCard'
import { getTeacherAvatarUrl } from '../../components/teacher/teacherImage'
import { ArtCover, Avatar, Badge, Button, Card, EmptyState, Eyebrow, Icon, Input, Tabs } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { checkAccess } from '../../lib/access'
import { formatDuration } from '../../lib/format'
import { useCurrentStudent, useViewer } from '../../store/selectors'
import { useStore } from '../../store/useStore'
import type { Playlist, Resource, Video } from '../../types'

type Tab = 'home' | 'courses' | 'videos' | 'playlists' | 'resources' | 'about'
const TABS: Tab[] = ['home', 'courses', 'videos', 'playlists', 'resources', 'about']

export function TeacherChannelPage() {
  const { id: param } = useParams()
  const { t, tr } = useT()
  const [params, setParams] = useSearchParams()
  const tab = (TABS.includes(params.get('tab') as Tab) ? params.get('tab') : 'home') as Tab
  const viewer = useViewer()
  const enabled = useStore((s) => s.site.features.teacherChannels)
  // The address may carry the id or the slug (the canonical URL and the sitemap use the slug).
  const teacher = useStore((s) => s.teachers.find((x) => x.id === param || x.slug === param))
  const id = teacher?.id
  const center = useStore((s) => s.centers.find((x) => x.id === teacher?.centerId))
  const allCourses = useStore((s) => s.courses.filter((c) => c.teacherId === id))
  const allVideos = useStore((s) => s.videos.filter((v) => v.teacherId === id))
  const allPlaylists = useStore((s) => s.playlists.filter((p) => p.teacherId === id))
  const allResources = useStore((s) => s.resources.filter((r) => r.teacherId === id))
  const student = useCurrentStudent()
  const toggleSavedTeacher = useStore((s) => s.toggleSavedTeacher)
  const savedOn = useStore((s) => s.site.features.savedItems && s.site.permissions.student.saveItems)
  const [q, setQ] = useState('')

  const isOwner = viewer.role === 'teacher' && viewer.teacherId === id
  const canSeeInactive = isOwner || viewer.role === 'admin'
  const ql = foldForSearch(q.trim())
  const match = (s: string) => !ql || foldForSearch(s).includes(ql)
  // Plain derivations (cheap) — keeps hook order stable regardless of the early returns below.
  const courses = allCourses.filter((c) => checkAccess(c, viewer).allowed && match(tr(c.title) + tr(c.summary)))
  const videos = allVideos.filter((v) => checkAccess(v, viewer).allowed && match(tr(v.title) + tr(v.description)))
  const playlists = allPlaylists.filter((p) => checkAccess(p, viewer).allowed && match(tr(p.title)))
  const resources = allResources.filter((r) => checkAccess(r, viewer).allowed && match(tr(r.title)))
  if (!teacher || !enabled) return <NotFound />
  if (!teacher.channelActive && !canSeeInactive) return <NotFound />

  const featured = teacher.featured
    ? teacher.featured.type === 'course' ? courses.find((c) => c.id === teacher.featured!.id) : playlists.find((p) => p.id === teacher.featured!.id)
    : undefined
  const saved = student?.savedTeacherIds.includes(teacher.id)
  const setTab = (v: Tab) => { const p = new URLSearchParams(params); p.set('tab', v); setParams(p, { replace: true }) }

  return (
    <div className="animate-fade">
      {/* Banner */}
      <div className="relative h-44 md:h-64" style={{ background: teacher.bannerUpload?.previewUrl ? `url(${teacher.bannerUpload.previewUrl}) center/cover` : teacher.bannerUrl ? `url(${teacher.bannerUrl}) center/cover` : `linear-gradient(110deg, ${teacher.bannerTone} 0%, ${teacher.bannerTone}dd 55%, #C8AD7F66 100%)` }}>
        <svg className="absolute inset-0 h-full w-full opacity-30" viewBox="0 0 800 200" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => <path key={i} d={`M -20 ${30 + i * 32} C 200 ${i * 20}, 500 ${120 + i * 10}, 820 ${20 + i * 30}`} fill="none" stroke="#F7F5F0" strokeWidth="0.7" />)}
        </svg>
        {!teacher.channelActive && <div className="absolute left-4 top-4"><Badge tone="warn">{t('teachers.channelInactive')}</Badge></div>}
      </div>
      <div className="container-x">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
            <Avatar name={teacher.name} seed={teacher.avatarSeed} size={96} url={getTeacherAvatarUrl(teacher)} alt={teacher.name} className="-mt-12 ring-4 ring-ivory" />
            <div className="pb-1">
              <h1 className="font-display text-4xl text-charcoal md:text-5xl">{teacher.name}</h1>
              <div className="mt-1 text-sm text-charcoal/65">{tr(teacher.title)}{center && <> · <span className="text-charcoal/50">{center.name}</span></>}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 pb-1">
            {savedOn && viewer.role === 'student' && student && (
              <Button variant={saved ? 'secondary' : 'primary'} onClick={() => toggleSavedTeacher(student.id, teacher.id)} aria-pressed={saved}>
                <Icon name={saved ? 'bookmarkFill' : 'bookmark'} className="h-4 w-4" />{saved ? t('channel.saved') : t('channel.save')}
              </Button>
            )}
            {isOwner && <Link to="/teacher/channel" className="inline-flex items-center gap-1.5 rounded-control border border-charcoal/15 px-4 py-2.5 text-sm font-medium hover:border-forest/50"><Icon name="edit" className="h-4 w-4" />{t('studio.channel')}</Link>}
          </div>
        </div>
        <p className="mt-5 max-w-2xl font-display text-xl italic text-charcoal/70">“{tr(teacher.tagline)}”</p>

        <div className="mt-8 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <Tabs<Tab> value={tab} onChange={setTab} className="flex-1" tabs={[
            { id: 'home', label: t('channel.tab.home') },
            { id: 'courses', label: t('channel.tab.courses'), count: courses.length },
            { id: 'videos', label: t('channel.tab.videos'), count: videos.length },
            { id: 'playlists', label: t('channel.tab.playlists'), count: playlists.length },
            { id: 'resources', label: t('channel.tab.resources'), count: resources.length },
            { id: 'about', label: t('channel.tab.about') },
          ]} />
          <div className="relative w-full md:w-64">
            <Icon name="search" className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-charcoal/40" />
            <Input aria-label={t('common.search')} className="pl-10" placeholder={t('channel.searchIn')} value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        {viewer.role === 'student' && <p className="mt-3 text-xs text-charcoal/50">{t('channel.privateHint')}</p>}

        <div className="py-10">
          {tab === 'home' && (
            <div className="space-y-14">
              {featured && (
                <section>
                  <Eyebrow className="mb-4">{t('channel.featured')}</Eyebrow>
                  {'price' in featured ? (
                    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
                      <Link to={`/courses/${featured.id}`} className="block"><ArtCover seed={featured.coverSeed} imageUrl={featured.imageUpload?.previewUrl || featured.imageUrl} tone={center?.tone} className="aspect-[16/9] w-full rounded-card" /></Link>
                      <div className="flex flex-col justify-center">
                        <h2 className="font-display text-4xl text-charcoal">{tr(featured.title)}</h2>
                        <p className="mt-3 text-charcoal/65">{tr(featured.summary)}</p>
                        <Link to={`/courses/${featured.id}`} className="mt-5 inline-flex items-center gap-1 text-sm font-medium text-forest">{t('common.view')} <Icon name="arrowRight" className="h-4 w-4" /></Link>
                      </div>
                    </div>
                  ) : (
                    <PlaylistCard p={featured as Playlist} videos={allVideos} big />
                  )}
                </section>
              )}
              <section>
                <div className="mb-4 flex items-center justify-between"><Eyebrow>{t('channel.latest')}</Eyebrow><Button variant="ghost" size="sm" onClick={() => setTab('videos')}>{t('common.all')} →</Button></div>
                {videos.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{videos.slice(0, 4).map((v) => <VideoCard key={v.id} v={v} />)}</div> : <EmptyState title={t('common.empty')} />}
              </section>
              <section>
                <div className="mb-4 flex items-center justify-between"><Eyebrow>{t('channel.tab.courses')}</Eyebrow><Button variant="ghost" size="sm" onClick={() => setTab('courses')}>{t('common.all')} →</Button></div>
                {courses.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{courses.slice(0, 3).map((c) => <CourseCard key={c.id} course={c} compact showInternal={canSeeInactive} />)}</div> : <EmptyState title={t('common.empty')} />}
              </section>
            </div>
          )}
          {tab === 'courses' && (courses.length ? <div className="reveal-stagger grid gap-5 sm:grid-cols-2 lg:grid-cols-3">{courses.map((c) => <div key={c.id} className="reveal"><CourseCard course={c} showInternal={canSeeInactive} /></div>)}</div> : <EmptyState title={t('common.noResults')} />)}
          {tab === 'videos' && (videos.length ? <div className="reveal-stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{videos.map((v) => <div key={v.id} className="reveal"><VideoCard v={v} /></div>)}</div> : <EmptyState title={t('common.noResults')} />)}
          {tab === 'playlists' && (playlists.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{playlists.map((p) => <PlaylistCard key={p.id} p={p} videos={allVideos} />)}</div> : <EmptyState title={t('common.noResults')} />)}
          {tab === 'resources' && (resources.length ? <div className="grid gap-3 md:grid-cols-2">{resources.map((r) => <ResourceRow key={r.id} r={r} />)}</div> : <EmptyState title={t('common.noResults')} />)}
          {tab === 'about' && (
            <div className="grid gap-8 lg:grid-cols-[1.2fr_0.8fr]">
              <Card>
                <Eyebrow className="mb-3">{t('channel.tab.about')}</Eyebrow>
                <p className="text-[15px] leading-relaxed text-charcoal/75">{tr(teacher.bio)}</p>
                <div className="mt-6 flex flex-wrap gap-1.5">{teacher.expertise.map((e) => <Badge key={e} tone="sage">{e}</Badge>)}</div>
              </Card>
              <Card>
                <Eyebrow className="mb-3">{t('teachers.affiliation')}</Eyebrow>
                {center && (<><div className="font-display text-2xl text-charcoal">{center.name}</div><div className="text-sm text-charcoal/55">{tr(center.district)}</div><p className="mt-3 text-sm text-charcoal/65">{tr(center.description)}</p></>)}              </Card>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function VideoCard({ v, playlistId }: { v: Video; playlistId?: string }) {
  const { tr } = useT()
  const viewer = useViewer()
  const a = checkAccess(v, viewer)
  return (
    <Link to={`/videos/${v.id}${playlistId ? `?playlist=${playlistId}` : ''}`} className="card group overflow-hidden p-0 transition hover:-translate-y-0.5 hover:shadow-lift">
      <div className="relative">
        <ArtCover seed={v.coverSeed} imageUrl={v.thumbnailUpload?.previewUrl || v.thumbnailUrl} className="zoom-media aspect-video w-full" />
        <span className="absolute bottom-2 right-2 rounded-sm bg-charcoal/80 px-1.5 py-0.5 text-[10px] text-ivory">{formatDuration(v.durationSec)}</span>
        <span className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100"><span className="flex h-11 w-11 items-center justify-center rounded-full bg-ivory/90 text-forest"><Icon name="play" className="h-5 w-5" /></span></span>
      </div>
      <div className="p-3.5">
        <div className="line-clamp-2 text-sm font-medium leading-snug text-charcoal group-hover:text-forest">{tr(v.title)}</div>
        <div className="mt-2 flex flex-wrap gap-1">
          {v.visibility === 'private' && <VisibilityBadge visibility="private" />}
          {a.allowed && (a.reason === 'owner' || a.reason === 'admin') && v.status !== 'published' && <Badge tone="warn">{v.status}</Badge>}
        </div>
      </div>
    </Link>
  )
}

export function PlaylistCard({ p, videos, big }: { p: Playlist; videos: Video[]; big?: boolean }) {
  const { t, tr } = useT()
  const first = videos.find((v) => v.id === p.videoIds[0])
  return (
    <Link to={`/playlists/${p.id}`} className={`card group overflow-hidden p-0 transition hover:-translate-y-0.5 hover:shadow-lift ${big ? 'grid md:grid-cols-[1.2fr_1fr]' : ''}`}>
      <div className="relative">
        <ArtCover seed={p.coverSeed} imageUrl={first?.thumbnailUpload?.previewUrl || first?.thumbnailUrl} className={big ? 'zoom-media aspect-[16/9] h-full w-full' : 'zoom-media aspect-video w-full'} />
        <span className="absolute bottom-0 right-0 flex h-full w-24 flex-col items-center justify-center gap-1 bg-charcoal/70 text-ivory">
          <Icon name="list" className="h-5 w-5" /><span className="text-[11px]">{p.videoIds.length} {t('channel.lessonsCount')}</span>
        </span>
      </div>
      <div className={big ? 'flex flex-col justify-center p-7' : 'p-3.5'}>
        <div className={`font-medium text-charcoal group-hover:text-forest ${big ? 'font-display text-3xl' : 'text-sm'}`}>{tr(p.title)}</div>
        {big && <p className="mt-3 text-sm text-charcoal/65">{tr(p.description)}</p>}
        <div className="mt-2 flex gap-1">{p.visibility === 'private' && <VisibilityBadge visibility="private" />}</div>
      </div>
    </Link>
  )
}

export function ResourceRow({ r }: { r: Resource }) {
  const { t, tr } = useT()
  return (
    <Link to={`/resources/${r.id}`} className="card flex items-center gap-4 p-4 transition hover:shadow-lift">
      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-control bg-sage text-forest"><Icon name={r.kind === 'link' ? 'external' : 'file'} className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-charcoal">{tr(r.title)}</div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-charcoal/50">{t(`kind.${r.kind}`)}{r.pages && <span>· {r.pages} {t('common.pages')}</span>}{r.visibility === 'private' && <VisibilityBadge visibility="private" />}</div>
      </div>
      <Icon name="arrowRight" className="h-4 w-4 text-charcoal/40" />
    </Link>
  )
}
