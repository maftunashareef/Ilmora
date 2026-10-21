import { useState } from 'react'
import { Link } from '@/lib/router'
import { Avatar, Badge, EmptyState, Icon, Input, Notice, PageTitle } from '../../components/ui'
import { useT } from '../../i18n/useT'
import { isPublicListed } from '../../lib/access'
import { useStore } from '../../store/useStore'

export function TeachersPage() {
  const { t, tr } = useT()
  const enabled = useStore((s) => s.site.features.teacherChannels)
  const teachers = useStore((s) => s.teachers)
  const centers = useStore((s) => s.centers)
  const courses = useStore((s) => s.courses)
  const videos = useStore((s) => s.videos)
  const [q, setQ] = useState('')
  const ql = q.trim().toLowerCase()
  const list = teachers.filter((te) => te.channelActive && (!ql || [te.name, tr(te.title), ...te.expertise, centers.find((c) => c.id === te.centerId)?.name ?? ''].join(' ').toLowerCase().includes(ql)))

  return (
    <div className="container-x py-12 lg:py-16">
      <PageTitle eyebrow={t('common.teachers')} title={t('teachers.title')} subtitle={t('teachers.subtitle')} action={
        <div className="relative w-72 max-w-full">
          <Icon name="search" className="pointer-events-none absolute left-3.5 top-3 h-4 w-4 text-charcoal/40" />
          <Input aria-label={t('common.search')} className="pl-10" placeholder={t('teachers.searchPlaceholder')} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      } />
      {!enabled && <Notice tone="warn" className="mb-6">{t('teachers.channelsDisabled')}</Notice>}
      {list.length === 0 ? <EmptyState title={t('common.noResults')} /> : (
        <div className="reveal-stagger grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((te) => {
            const center = centers.find((c) => c.id === te.centerId)
            const nCourses = courses.filter((c) => c.teacherId === te.id && isPublicListed(c)).length
            const nVideos = videos.filter((v) => v.teacherId === te.id && isPublicListed(v)).length
            const Wrapper = enabled ? Link : 'div'
            return (
              <Wrapper key={te.id} to={`/teachers/${te.id}`} className="reveal card group overflow-hidden p-0 transition hover:-translate-y-0.5 hover:shadow-lift">
                <div className="h-20" style={{ background: te.bannerUpload?.previewUrl ? `url(${te.bannerUpload.previewUrl}) center/cover` : `linear-gradient(120deg, ${te.bannerTone}, ${te.bannerTone}cc 60%, #C8AD7F55)` }} />
                <div className="-mt-8 px-5 pb-5">
                  <Avatar name={te.name} seed={te.avatarSeed} size={64} url={te.avatarUpload?.previewUrl} className="ring-4 ring-paper" />
                  <div className="mt-3 font-display text-2xl text-charcoal group-hover:text-forest">{te.name}</div>
                  <div className="text-xs text-charcoal/55">{tr(te.title)}</div>
                  <div className="mt-3 flex flex-wrap gap-1">{te.expertise.slice(0, 3).map((e) => <Badge key={e} tone="muted">{e}</Badge>)}</div>
                  <div className="mt-4 flex items-center justify-between border-t border-charcoal/10 pt-3 text-[11px] text-charcoal/50">
                    <span className="truncate">{center?.name}</span>
                    <span className="shrink-0">{nCourses} {t('common.courses').toLowerCase()} · {nVideos} {t('common.videos').toLowerCase()}</span>
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
