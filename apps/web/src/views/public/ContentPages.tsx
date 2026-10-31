import { Link, useParams, useSearchParams } from '@/lib/router'
import { AccessDenied, NotFound } from '../../components/AccessGate'
import { AccessBadge, StatusBadge, VisibilityBadge } from '../../components/course/badges'
import { ArtCover, Avatar, Badge, Card, cx, Eyebrow, Icon, LinkButton, Notice } from '../../components/ui'
import { getTeacherAvatarUrl } from '../../components/teacher/teacherImage'
import { useT } from '../../i18n/useT'
import { checkAccess } from '../../lib/access'
import { formatBytes, formatDuration } from '../../lib/format'
import { useViewer } from '../../store/selectors'
import { useStore } from '../../store/useStore'
import type { Video } from '../../types'
import { VideoCard } from './TeacherChannel'

function embedFor(url: string): { kind: 'iframe' | 'video' | 'none'; src: string } {
  try {
    const u = new URL(url)
    if (/youtube\.com|youtu\.be/.test(u.hostname)) {
      const id = u.hostname.includes('youtu.be') ? u.pathname.slice(1) : u.searchParams.get('v') ?? u.pathname.split('/').pop() ?? ''
      return { kind: 'iframe', src: `https://www.youtube-nocookie.com/embed/${id}` }
    }
    if (/vimeo\.com/.test(u.hostname)) return { kind: 'iframe', src: `https://player.vimeo.com/video/${u.pathname.split('/').filter(Boolean).pop()}` }
    if (/\.(mp4|webm|ogg)(\?|$)/i.test(u.pathname)) return { kind: 'video', src: url }
  } catch { /* not a URL */ }
  return { kind: 'none', src: url }
}

function Player({ v }: { v: Video }) {
  const { t, tr } = useT()
  if (v.source.kind === 'upload') {
    return v.source.file.previewUrl ? (
      <video src={v.source.file.previewUrl} controls className="aspect-video w-full rounded-card bg-charcoal" />
    ) : (
      <div className="relative aspect-video w-full overflow-hidden rounded-card">
        <ArtCover seed={v.coverSeed} className="absolute inset-0" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-charcoal/55 p-6 text-center text-ivory">
          <Icon name="file" className="h-8 w-8" />
          <div className="text-sm font-medium">{v.source.file.name} · {formatBytes(v.source.file.size)}</div>
          <p className="max-w-md text-xs text-ivory/75">{t('channel.previewLost')}</p>
        </div>
      </div>
    )
  }
  const e = embedFor(v.source.url)
  if (e.kind === 'iframe') return <iframe src={e.src} title={tr(v.title) || t('common.video')} className="aspect-video w-full rounded-card bg-charcoal" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen loading="lazy" />
  if (e.kind === 'video') return <video src={e.src} controls className="aspect-video w-full rounded-card bg-charcoal" />
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-card">
      <ArtCover seed={v.coverSeed} className="absolute inset-0" />
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-charcoal/50 p-6 text-center text-ivory">
        <p className="text-sm">{t('channel.noEmbed')}</p>
        <LinkButton to={v.source.url} external variant="champagne" size="sm">{t('channel.openExternal')} <Icon name="external" className="h-3.5 w-3.5" /></LinkButton>
      </div>
    </div>
  )
}

export function VideoPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const { t, tr } = useT()
  const viewer = useViewer()
  const video = useStore((s) => s.videos.find((v) => v.id === id))
  const teacher = useStore((s) => s.teachers.find((x) => x.id === video?.teacherId))
  const course = useStore((s) => s.courses.find((c) => c.id === video?.courseId))
  const playlist = useStore((s) => s.playlists.find((p) => p.id === params.get('playlist')))
  const allVideos = useStore((s) => s.videos)
  if (!video) return <NotFound />
  const access = checkAccess(video, viewer)
  if (!access.allowed) return <AccessDenied result={access} backTo={teacher ? { to: `/teachers/${teacher.id}?tab=videos`, label: t('courses.seeChannel') } : undefined} />
  const plVideos = playlist ? playlist.videoIds.map((vid) => allVideos.find((v) => v.id === vid)).filter((v): v is Video => !!v && checkAccess(v, viewer).allowed) : []

  return (
    <div className="container-x grid gap-10 py-10 lg:grid-cols-[1.4fr_0.6fr] lg:py-14">
      <div className="animate-fade">
        <Player v={video} />
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <VisibilityBadge visibility={video.visibility} />
          <AccessBadge reason={access.reason} />
          {(access.reason === 'owner' || access.reason === 'admin') && <StatusBadge status={video.status} />}
          <Badge tone="muted"><Icon name="clock" className="h-3 w-3" />{formatDuration(video.durationSec)}</Badge>
        </div>
        <h1 className="mt-3 font-display text-4xl leading-tight text-charcoal md:text-5xl">{tr(video.title)}</h1>
        <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-charcoal/70">{tr(video.description)}</p>
        <Notice tone="info" className="mt-6 text-xs">{t('channel.demoVideoNote')}</Notice>
        {teacher && (
          <Link to={`/teachers/${teacher.id}`} className="mt-8 flex items-center gap-3 rounded-card border border-charcoal/10 bg-paper p-4 transition hover:shadow-soft">
            <Avatar name={teacher.name} seed={teacher.avatarSeed} size={44} url={getTeacherAvatarUrl(teacher)} />
            <div className="min-w-0 flex-1"><div className="font-medium text-charcoal">{teacher.name}</div><div className="text-xs text-charcoal/55">{tr(teacher.title)}</div></div>
            <Icon name="arrowRight" className="h-4 w-4 text-charcoal/40" />
          </Link>
        )}
        {course && (
          <Card className="mt-4 flex items-center gap-4">
            <div className="min-w-0 flex-1"><Eyebrow>{t('channel.relatedCourse')}</Eyebrow><div className="mt-1 font-display text-2xl text-charcoal">{tr(course.title)}</div></div>
            <LinkButton to={`/courses/${course.id}`} variant="secondary" size="sm">{t('common.view')}</LinkButton>
          </Card>
        )}
        <p className="mt-6 text-xs text-charcoal/45">{t('vis.enrollmentNote')}</p>
      </div>
      <aside>
        {playlist && plVideos.length > 0 ? (
          <Card className="p-4">
            <Eyebrow className="mb-1">{t('channel.inPlaylist')}</Eyebrow>
            <Link to={`/playlists/${playlist.id}`} className="font-display text-xl text-charcoal hover:text-forest">{tr(playlist.title)}</Link>
            <ol className="mt-4 space-y-1.5">
              {plVideos.map((v, i) => (
                <li key={v.id}>
                  <Link to={`/videos/${v.id}?playlist=${playlist.id}`} className={cx('flex items-center gap-3 rounded-control p-2 text-sm transition', v.id === video.id ? 'bg-sage text-forest' : 'hover:bg-ivory')}>
                    <span className="w-5 text-right text-[11px] text-charcoal/40">{i + 1}</span>
                    <ArtCover seed={v.coverSeed} className="h-10 w-16 shrink-0 rounded-[6px]" imageUrl={v.thumbnailUpload?.previewUrl || v.thumbnailUrl} />
                    <span className="line-clamp-2 flex-1 leading-snug">{tr(v.title)}</span>
                  </Link>
                </li>
              ))}
            </ol>
          </Card>
        ) : (
          <div>
            <Eyebrow className="mb-4">{t('channel.latest')}</Eyebrow>
            <div className="grid gap-4">
              {allVideos.filter((v) => v.teacherId === video.teacherId && v.id !== video.id && checkAccess(v, viewer).allowed).slice(0, 3).map((v) => <VideoCard key={v.id} v={v} />)}
            </div>
          </div>
        )}
      </aside>
    </div>
  )
}

export function PlaylistPage() {
  const { id } = useParams()
  const { t, tr } = useT()
  const viewer = useViewer()
  const playlist = useStore((s) => s.playlists.find((p) => p.id === id))
  const teacher = useStore((s) => s.teachers.find((x) => x.id === playlist?.teacherId))
  const allVideos = useStore((s) => s.videos)
  if (!playlist) return <NotFound />
  const access = checkAccess(playlist, viewer)
  if (!access.allowed) return <AccessDenied result={access} backTo={teacher ? { to: `/teachers/${teacher.id}?tab=playlists`, label: t('courses.seeChannel') } : undefined} />
  const videos = playlist.videoIds.map((vid) => allVideos.find((v) => v.id === vid)).filter((v): v is Video => !!v && checkAccess(v, viewer).allowed)
  return (
    <div className="container-x py-10 lg:py-14">
      <div className="grid gap-10 lg:grid-cols-[0.8fr_1.2fr]">
        <div className="animate-fade">
          <ArtCover seed={playlist.coverSeed} className="aspect-[4/3] w-full rounded-card" />
          <div className="mt-5 flex flex-wrap gap-2"><VisibilityBadge visibility={playlist.visibility} /><AccessBadge reason={access.reason} />{(access.reason === 'owner' || access.reason === 'admin') && <StatusBadge status={playlist.status} />}</div>
          <h1 className="mt-3 font-display text-4xl text-charcoal">{tr(playlist.title)}</h1>
          <p className="mt-3 text-charcoal/65">{tr(playlist.description)}</p>
          <div className="mt-3 text-xs text-charcoal/50">{videos.length} {t('channel.lessonsCount')}</div>
          {teacher && <Link to={`/teachers/${teacher.id}`} className="mt-5 inline-flex items-center gap-2 text-sm text-forest"><Avatar name={teacher.name} seed={teacher.avatarSeed} size={28} url={teacher.avatarUrl || teacher.avatarUpload?.previewUrl} alt={teacher.name} />{teacher.name}</Link>}
        </div>
        <ol className="space-y-2">
          {videos.map((v, i) => (
            <li key={v.id}>
              <Link to={`/videos/${v.id}?playlist=${playlist.id}`} className="card flex items-center gap-4 p-3 transition hover:shadow-lift">
                <span className="w-6 text-center font-display text-xl text-champagne">{i + 1}</span>
                <ArtCover seed={v.coverSeed} className="h-16 w-28 shrink-0 rounded-control" imageUrl={v.thumbnailUpload?.previewUrl || v.thumbnailUrl} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium text-charcoal">{tr(v.title)}</div>
                  <div className="mt-0.5 flex items-center gap-2 text-[11px] text-charcoal/50">{formatDuration(v.durationSec)}{v.visibility === 'private' && <VisibilityBadge visibility="private" />}</div>
                </div>
                <Icon name="play" className="h-4 w-4 text-forest" />
              </Link>
            </li>
          ))}
          {videos.length === 0 && <Notice tone="info">{t('common.empty')}</Notice>}
        </ol>
      </div>
    </div>
  )
}

export function ResourcePage() {
  const { id } = useParams()
  const { t, tr } = useT()
  const viewer = useViewer()
  const r = useStore((s) => s.resources.find((x) => x.id === id))
  const teacher = useStore((s) => s.teachers.find((x) => x.id === r?.teacherId))
  const course = useStore((s) => s.courses.find((c) => c.id === r?.courseId))
  const canDownload = useStore((s) => s.site.permissions.student.downloadResources)
  if (!r) return <NotFound />
  const access = checkAccess(r, viewer)
  if (!access.allowed) return <AccessDenied result={access} backTo={teacher ? { to: `/teachers/${teacher.id}?tab=resources`, label: t('courses.seeChannel') } : undefined} />
  const downloadable = r.file?.previewUrl && (viewer.role !== 'student' || canDownload)
  return (
    <div className="container-x py-10 lg:py-14">
      <div className="mx-auto max-w-3xl animate-fade">
        <div className="flex flex-wrap gap-2"><Badge tone="sage">{t(`kind.${r.kind}`)}</Badge><VisibilityBadge visibility={r.visibility} /><AccessBadge reason={access.reason} />{(access.reason === 'owner' || access.reason === 'admin') && <StatusBadge status={r.status} />}</div>
        <h1 className="mt-4 font-display text-4xl text-charcoal md:text-5xl">{tr(r.title)}</h1>
        <p className="mt-4 text-[15px] leading-relaxed text-charcoal/70">{tr(r.description)}</p>
        <Card className="mt-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
            <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-card bg-sage text-forest"><Icon name={r.kind === 'link' ? 'external' : 'file'} className="h-8 w-8" /></span>
            <div className="min-w-0 flex-1">
              {r.file && (<><div className="truncate font-medium text-charcoal">{r.file.name}</div><div className="mt-1 text-xs text-charcoal/55">{r.file.mime} · {formatBytes(r.file.size)}{r.pages ? ` · ${r.pages} ${t('common.pages')}` : ''}</div></>)}
              {r.url && <a href={r.url} target="_blank" rel="noopener noreferrer" className="truncate text-sm text-forest underline">{r.url}</a>}
            </div>
            <div className="flex flex-col gap-2">
              {r.url && <LinkButton to={r.url} external variant="primary" size="sm">{t('channel.openExternal')} <Icon name="external" className="h-3.5 w-3.5" /></LinkButton>}
              {r.file && (downloadable ? (
                <a href={r.file.previewUrl} download={r.file.name} className="inline-flex items-center justify-center gap-2 rounded-control bg-forest px-4 py-2 text-sm font-medium text-ivory">{t('common.download')} <Icon name="download" className="h-3.5 w-3.5" /></a>
              ) : (
                <span className="inline-flex items-center gap-2 rounded-control border border-charcoal/15 px-4 py-2 text-sm text-charcoal/50"><Icon name="lock" className="h-3.5 w-3.5" />{t('common.download')}</span>
              ))}
            </div>
          </div>
          {r.file && !r.file.previewUrl && <Notice tone="info" className="mt-5 text-xs">{t('channel.demoFile')}</Notice>}
          {r.file && viewer.role === 'student' && !canDownload && <Notice tone="warn" className="mt-3 text-xs">{t('studio.lockedByAdmin')}: {t('perm.student.downloadResources')}</Notice>}
        </Card>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          {teacher && (
            <Link to={`/teachers/${teacher.id}`} className="card flex items-center gap-3 p-4 transition hover:shadow-soft">
              <Avatar name={teacher.name} seed={teacher.avatarSeed} size={40} url={getTeacherAvatarUrl(teacher)} />
              <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-charcoal">{teacher.name}</div><div className="truncate text-xs text-charcoal/55">{tr(teacher.title)}</div></div>
            </Link>
          )}
          {course && (
            <Link to={`/courses/${course.id}`} className="card flex items-center gap-3 p-4 transition hover:shadow-soft">
              <div className="min-w-0 flex-1"><Eyebrow>{t('channel.relatedCourse')}</Eyebrow><div className="truncate font-display text-xl text-charcoal">{tr(course.title)}</div></div>
              <Icon name="arrowRight" className="h-4 w-4 text-charcoal/40" />
            </Link>
          )}
        </div>
        <p className="mt-8 text-xs text-charcoal/45">{t('access.securityNote')}</p>
      </div>
    </div>
  )
}
